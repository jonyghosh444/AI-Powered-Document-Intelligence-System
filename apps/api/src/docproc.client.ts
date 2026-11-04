import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { ExtractionResult } from "./merge";

export type ExistingInvoice = {
  document_id: string;
  invoice_number: string | null;
  supplier_name: string | null;
  total: number | null;
  line_items: Array<{ description: string | null; quantity: number | null; unit_price: number | null; amount: number | null }>;
  source_kind: string;
};

@Injectable()
export class DocprocClient {
  private readonly logger = new Logger(DocprocClient.name);

  constructor(private readonly prisma: PrismaService) {}

  baseUrl(): string {
    return process.env.DOCPROC_URL || "http://127.0.0.1:8000";
  }

  async process(input: { filePath: string; filename: string; mime: string; documentId: string }) {
    const existing = await this.existingInvoices(input.documentId);
    return this.post("/process", {
      file_path: input.filePath,
      filename: input.filename,
      mime: input.mime,
      document_id: input.documentId,
      existing_invoices: existing,
    });
  }

  async validate(documentId: string, extraction: ExtractionResult) {
    const existing = await this.existingInvoices(documentId);
    return this.post("/validate", {
      extraction,
      document_id: documentId,
      existing_invoices: existing,
    });
  }

  async embed(text: string): Promise<number[]> {
    const body = await this.post("/embed", { text });
    if (!body.ok || !Array.isArray(body.embedding)) {
      throw new Error(body.error || "Embedding failed");
    }
    return body.embedding.map((value: unknown) => Number(value));
  }

  async existingInvoices(exceptId: string): Promise<ExistingInvoice[]> {
    const rows = await this.prisma.extraction.findMany({
      where: { isCurrent: true, documentId: { not: exceptId } },
      include: { document: { include: { lineItems: { orderBy: { position: "asc" } } } } },
    });
    return rows.map((row) => {
      const result = row.result as ExtractionResult;
      const value = (field: keyof ExtractionResult) => {
        const raw = result?.[field] as { value?: string | number | null } | undefined;
        return raw && typeof raw === "object" && "value" in raw ? raw.value ?? null : null;
      };
      return {
        document_id: row.documentId,
        invoice_number: value("invoice_number") as string | null,
        supplier_name: value("supplier_name") as string | null,
        total: value("total") as number | null,
        line_items: row.document.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          amount: item.amount,
        })),
        source_kind: row.document.mime,
      };
    });
  }

  private async post(pathname: string, payload: unknown): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180000),
      });
    } catch (error) {
      this.logger.error(`Doc service unreachable: ${(error as Error).message}`);
      return { ok: false, error: "Document service is unavailable" };
    }
    try {
      return await response.json();
    } catch {
      return { ok: false, error: `Document service returned HTTP ${response.status}` };
    }
  }
}
