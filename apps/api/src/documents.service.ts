import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentStatus, JobType, Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { randomUUID } from "crypto";
import { DocprocClient } from "./docproc.client";
import { applyCorrections, ExtractionResult } from "./merge";
import { PrismaService } from "./prisma.service";
import { mimeFor, removeFile, safeOriginalName, sha256File } from "./storage";

const QUEUE = "document-processing";

function nestedValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return nestedValue((value as { value: unknown }).value);
  }
  return value;
}

function textValue(value: unknown): string | null {
  const raw = nestedValue(value);
  if (raw == null || raw === "") return null;
  return String(raw);
}

function numberValue(value: unknown): number | null {
  const raw = nestedValue(value);
  if (raw == null || raw === "") return null;
  const number = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docproc: DocprocClient,
    @InjectQueue(QUEUE) private readonly queue: Queue,
  ) {}

  async createFromUpload(file: Express.Multer.File) {
    const mime = mimeFor(file.originalname);
    if (!mime) {
      await removeFile(file.path);
      throw new BadRequestException(`Unsupported file type: ${file.originalname}`);
    }
    const sha256 = await sha256File(file.path);
    const document = await this.prisma.document.create({
      data: {
        filename: safeOriginalName(file.originalname),
        mime,
        storagePath: file.path,
        sha256,
        status: "queued",
      },
    });
    const job = await this.prisma.job.create({
      data: { documentId: document.id, type: "process", state: "queued" },
    });
    try {
      await this.queue.add("process", { documentId: document.id, jobId: job.id }, { jobId: job.id, attempts: 1, removeOnComplete: 200, removeOnFail: 200 });
    } catch (error) {
      await this.markFailed(document.id, job.id, "Could not queue the document");
      throw error;
    }
    return { documentId: document.id, jobId: job.id, filename: document.filename, status: document.status };
  }

  async list(status?: string) {
    const where = status ? { status: status as DocumentStatus } : {};
    const documents = await this.prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      status: document.status,
      mime: document.mime,
      pageCount: document.pageCount,
      error: document.error,
      createdAt: document.createdAt,
      jobId: document.jobs[0]?.id || null,
    }));
  }

  async get(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: {
        texts: { orderBy: { index: "asc" } },
        extractions: { where: { isCurrent: true }, take: 1 },
        lineItems: { orderBy: { position: "asc" } },
        issues: true,
        corrections: { orderBy: { createdAt: "desc" } },
        jobs: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!document) throw new NotFoundException("Document not found");
    return {
      id: document.id,
      filename: document.filename,
      mime: document.mime,
      status: document.status,
      pageCount: document.pageCount,
      error: document.error,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      texts: document.texts.map((text) => ({ index: text.index, label: text.label, text: text.text })),
      extraction: document.extractions[0]?.result || null,
      provider: document.extractions[0]?.provider || null,
      model: document.extractions[0]?.model || null,
      promptVersion: document.extractions[0]?.promptVersion || null,
      lineItems: document.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        amount: item.amount,
      })),
      issues: document.issues,
      corrections: document.corrections,
      jobs: document.jobs,
    };
  }

  async getJob(id: string) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { document: true } });
    if (!job) throw new NotFoundException("Job not found");
    return {
      id: job.id,
      documentId: job.documentId,
      type: job.type,
      state: job.state,
      attempts: job.attempts,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      documentStatus: job.document.status,
      filename: job.document.filename,
    };
  }

  async retry(jobId: string) {
    const existing = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) throw new NotFoundException("Job not found");
    const job = await this.prisma.job.create({
      data: { documentId: existing.documentId, type: JobType.reprocess, state: "queued" },
    });
    await this.prisma.document.update({
      where: { id: existing.documentId },
      data: { status: "queued", error: null },
    });
    await this.queue.add("process", { documentId: existing.documentId, jobId: job.id }, { jobId: job.id, attempts: 1, removeOnComplete: 200, removeOnFail: 200 });
    return { documentId: existing.documentId, jobId: job.id, status: "queued" };
  }

  async correct(id: string, patch: Record<string, unknown>) {
    const current = await this.prisma.extraction.findFirst({ where: { documentId: id, isCurrent: true } });
    if (!current) throw new BadRequestException("Document has no extraction to correct");
    const { next, changes } = applyCorrections(current.result, patch);
    const validation = await this.docproc.validate(id, next);
    if (!validation.ok) throw new BadRequestException(validation.error || "Validation failed");
    const status = (validation.status || "needs_review") as DocumentStatus;
    await this.prisma.$transaction(async (tx) => {
      if (changes.length) {
        await tx.correction.createMany({
          data: changes.map((change) => ({
            documentId: id,
            fieldPath: change.fieldPath,
            oldValue: change.oldValue,
            newValue: change.newValue,
          })),
        });
      }
      await tx.extraction.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.extraction.create({
        data: {
          documentId: id,
          result: next as unknown as Prisma.InputJsonValue,
          provider: "manual",
          model: current.model,
          promptVersion: current.promptVersion,
          isCurrent: true,
        },
      });
      await tx.lineItem.deleteMany({ where: { documentId: id } });
      await tx.lineItem.createMany({
        data: (next.line_items || []).map((item, position) => ({
          documentId: id,
          position,
          description: textValue(item.description),
          quantity: numberValue(item.quantity),
          unitPrice: numberValue(item.unit_price),
          amount: numberValue(item.amount),
        })),
      });
      await tx.validationIssue.deleteMany({ where: { documentId: id } });
      await tx.validationIssue.createMany({
        data: (validation.validation_issues || []).map((issue: { code: string; field?: string; message: string; severity: string }) => ({
          documentId: id,
          code: issue.code,
          field: issue.field || null,
          message: issue.message,
          severity: issue.severity,
        })),
      });
      await tx.document.update({ where: { id }, data: { status, error: null } });
    });
    await this.refreshSummaryChunk(id, next);
    return this.get(id);
  }

  private async refreshSummaryChunk(documentId: string, extraction: ExtractionResult) {
    const value = (field: keyof ExtractionResult) => {
      const raw = extraction[field] as { value?: string | number | null };
      return raw?.value == null ? "" : String(raw.value);
    };
    const summary = `Invoice ${value("invoice_number")} supplier ${value("supplier_name")} customer ${value("customer_name")} total ${value("total")} ${value("currency")}`.trim();
    try {
      const embedding = await this.docproc.embed(summary);
      if (embedding.some((item) => !Number.isFinite(item))) return;
      const literal = `[${embedding.join(",")}]`;
      const updated = await this.prisma.$executeRawUnsafe(
        `UPDATE chunks SET text = $1, embedding = $2::vector WHERE document_id = $3 AND position = 0`,
        summary,
        literal,
        documentId,
      );
      if (Number(updated) === 0) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO chunks (id, document_id, position, text, embedding, created_at) VALUES ($1, $2, 0, $3, $4::vector, NOW())`,
          randomUUID(),
          documentId,
          summary,
          literal,
        );
      }
    } catch {
      return;
    }
  }

  async markProcessing(documentId: string, jobId: string) {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { state: "processing", attempts: { increment: 1 }, startedAt: new Date(), error: null },
    });
    await this.prisma.document.update({ where: { id: documentId }, data: { status: "processing", error: null } });
  }

  async markFailed(documentId: string, jobId: string, error: string) {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { state: "failed", error, finishedAt: new Date() },
    });
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: "failed", error },
    });
  }

  async saveResult(documentId: string, jobId: string, body: any) {
    const extraction = body.extraction as ExtractionResult;
    const status = body.status as DocumentStatus;
    await this.prisma.$transaction(async (tx) => {
      await tx.documentText.deleteMany({ where: { documentId } });
      await tx.extraction.updateMany({ where: { documentId }, data: { isCurrent: false } });
      await tx.lineItem.deleteMany({ where: { documentId } });
      await tx.validationIssue.deleteMany({ where: { documentId } });
      await tx.chunk.deleteMany({ where: { documentId } });
      await tx.documentText.createMany({
        data: (body.texts || []).map((text: { index: number; label: string; text: string }) => ({
          documentId,
          index: text.index,
          label: text.label,
          text: text.text || "",
        })),
      });
      await tx.extraction.create({
        data: {
          documentId,
          result: extraction as unknown as Prisma.InputJsonValue,
          provider: body.provider || "unknown",
          model: body.model || "unknown",
          promptVersion: body.prompt_version || "v1",
          isCurrent: true,
        },
      });
      await tx.lineItem.createMany({
        data: (body.line_items || []).map((item: { description?: unknown; quantity?: unknown; unit_price?: unknown; amount?: unknown }, position: number) => ({
          documentId,
          position,
          description: textValue(item.description),
          quantity: numberValue(item.quantity),
          unitPrice: numberValue(item.unit_price),
          amount: numberValue(item.amount),
        })),
      });
      await tx.validationIssue.createMany({
        data: (body.validation_issues || []).map((issue: { code: string; field?: string; message: string; severity: string }) => ({
          documentId,
          code: issue.code,
          field: issue.field || null,
          message: issue.message,
          severity: issue.severity,
        })),
      });
      await tx.document.update({
        where: { id: documentId },
        data: { status, pageCount: body.page_count ?? null, error: null },
      });
      await tx.job.update({
        where: { id: jobId },
        data: { state: "completed", finishedAt: new Date(), error: null },
      });
    });
    try {
      await this.saveChunks(documentId, body.chunks || []);
    } catch {
      return;
    }
  }

  private async saveChunks(documentId: string, chunks: Array<{ text: string; embedding: number[] }>) {
    for (const [position, chunk] of chunks.entries()) {
      if (!Array.isArray(chunk.embedding) || chunk.embedding.some((value) => typeof value !== "number")) continue;
      const literal = `[${chunk.embedding.join(",")}]`;
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO chunks (id, document_id, position, text, embedding, created_at) VALUES ($1, $2, $3, $4, $5::vector, NOW())`,
        randomUUID(),
        documentId,
        position,
        chunk.text,
        literal,
      );
    }
  }
}
