import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { DocumentsService } from "./documents.service";
import { maxUploadBytes, storageDir, storedName } from "./storage";

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get("health")
  health() {
    return { ok: true };
  }

  @Post("documents")
  @UseInterceptors(
    FilesInterceptor("files", 20, {
      limits: { fileSize: maxUploadBytes() },
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, storageDir()),
        filename: (_req, file, cb) => cb(null, storedName(file.originalname || "upload")),
      }),
    }),
  )
  async upload(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException("Choose at least one file");
    const documents = [];
    for (const file of files) {
      documents.push(await this.documents.createFromUpload(file));
    }
    return { documents };
  }

  @Get("documents")
  list(@Query("status") status?: string) {
    return this.documents.list(status);
  }

  @Get("documents/:id")
  get(@Param("id") id: string) {
    return this.documents.get(id);
  }

  @Patch("documents/:id")
  correct(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    if (!body || typeof body !== "object") throw new BadRequestException("Correction body is required");
    return this.documents.correct(id, body);
  }

  @Get("jobs/:id")
  job(@Param("id") id: string) {
    return this.documents.getJob(id);
  }

  @Post("jobs/:id/retry")
  retry(@Param("id") id: string) {
    return this.documents.retry(id);
  }
}
