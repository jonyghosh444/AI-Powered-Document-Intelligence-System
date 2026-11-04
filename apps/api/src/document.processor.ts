import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { DocprocClient } from "./docproc.client";
import { DocumentsService } from "./documents.service";
import { PrismaService } from "./prisma.service";

@Processor("document-processing")
export class DocumentProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    private readonly documents: DocumentsService,
    private readonly docproc: DocprocClient,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string; jobId: string }>): Promise<void> {
    const { documentId, jobId } = job.data;
    const record = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!record) {
      this.logger.warn(`Skipping missing document ${documentId}`);
      return;
    }
    await this.documents.markProcessing(documentId, jobId);
    try {
      const result = await this.docproc.process({
        filePath: record.storagePath,
        filename: record.filename,
        mime: record.mime,
        documentId,
      });
      if (!result.ok) {
        await this.documents.markFailed(documentId, jobId, result.error || "Processing failed");
        return;
      }
      await this.documents.saveResult(documentId, jobId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Processing failed";
      this.logger.error(message);
      await this.documents.markFailed(documentId, jobId, message);
    }
  }
}
