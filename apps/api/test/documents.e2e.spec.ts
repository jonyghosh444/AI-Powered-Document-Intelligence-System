import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";

const live = process.env.RUN_E2E === "1";
const describeLive = live ? describe : describe.skip;

describeLive("documents API", () => {
  let app: INestApplication;
  let stub: Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    stub = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        res.setHeader("content-type", "application/json");
        if (req.url === "/embed") {
          res.end(JSON.stringify({ ok: true, embedding: Array(384).fill(0.01), backend: "test" }));
          return;
        }
        if (req.url === "/validate") {
          res.end(JSON.stringify({ ok: true, status: "completed", validation_issues: [], line_items: body.extraction.line_items || [] }));
          return;
        }
        res.end(
          JSON.stringify({
            ok: true,
            page_count: 1,
            texts: [{ index: 0, label: "page-1", text: "Invoice Number: INV-E2E Supplier: Acme" }],
            extraction: {
              invoice_number: { value: "INV-E2E", confidence: 0.9 },
              invoice_date: { value: "2024-03-01", confidence: 0.9 },
              supplier_name: { value: "Acme", confidence: 0.9 },
              customer_name: { value: "Northwind", confidence: 0.9 },
              subtotal: { value: 100, confidence: 0.9 },
              tax: { value: 10, confidence: 0.9 },
              total: { value: 110, confidence: 0.9 },
              currency: { value: "USD", confidence: 0.9 },
              line_items: [{ description: "Widget", quantity: 1, unit_price: 100, amount: 100 }],
            },
            line_items: [{ description: "Widget", quantity: 1, unit_price: 100, amount: 100 }],
            validation_issues: [],
            status: "completed",
            chunks: [{ text: "Acme invoice", embedding: Array(384).fill(0.02) }],
            provider: "fixture",
            model: "test",
            prompt_version: "v1",
          }),
        );
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const address = stub.address() as AddressInfo;
    process.env.DOCPROC_URL = `http://127.0.0.1:${address.port}`;
    process.env.STORAGE_DIR = "/tmp/docintel-e2e";
    const { mkdir } = await import("fs/promises");
    await mkdir(process.env.STORAGE_DIR, { recursive: true });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (stub) await new Promise((resolve) => stub.close(resolve));
  });

  async function waitFor(documentId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const body = await request(app.getHttpServer()).get(`/documents/${documentId}`);
      if (!["queued", "processing"].includes(body.body.status)) return body.body;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("timed out waiting for processing");
  }

  it("uploads, processes, corrects, retries, and searches", async () => {
    const uploaded = await request(app.getHttpServer())
      .post("/documents")
      .attach("files", Buffer.from("Invoice Number: INV-E2E\n"), "invoice.csv");
    expect(uploaded.status).toBe(201);
    const documentId = uploaded.body.documents[0].documentId;
    const jobId = uploaded.body.documents[0].jobId;
    const processed = await waitFor(documentId);
    expect(processed.status).toBe("completed");
    expect(processed.extraction.invoice_number.value).toBe("INV-E2E");

    const job = await request(app.getHttpServer()).get(`/jobs/${jobId}`);
    expect(job.body.state).toBe("completed");

    const corrected = await request(app.getHttpServer()).patch(`/documents/${documentId}`).send({ customer_name: "Contoso" });
    expect(corrected.status).toBe(200);
    expect(corrected.body.extraction.customer_name.value).toBe("Contoso");
    expect(corrected.body.corrections.length).toBeGreaterThan(0);

    const retried = await request(app.getHttpServer()).post(`/jobs/${jobId}/retry`);
    expect(retried.status).toBe(201);
    const again = await waitFor(documentId);
    expect(["completed", "needs_review"]).toContain(again.status);

    const keyword = await request(app.getHttpServer()).get("/search").query({ invoice_number: "INV-E2E" });
    expect(keyword.status).toBe(200);
    expect(keyword.body.results.some((row: { id: string }) => row.id === documentId)).toBe(true);

    const semantic = await request(app.getHttpServer()).post("/search/semantic").send({ query: "Acme invoice" });
    expect(semantic.status).toBe(200);
    expect(semantic.body.results.length).toBeGreaterThan(0);

    await prisma.document.delete({ where: { id: documentId } });
  });

  it("rejects an unsupported upload", async () => {
    const response = await request(app.getHttpServer()).post("/documents").attach("files", Buffer.from("hello"), "notes.txt");
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
