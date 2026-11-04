import "./env";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import path from "path";
import { DocprocClient } from "./docproc.client";
import { DocumentProcessor } from "./document.processor";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { PrismaService } from "./prisma.service";
import { SearchController } from "./search.controller";

function redisConnection() {
  const raw = process.env.REDIS_URL || "redis://localhost:6379";
  const url = new URL(raw);
  return { host: url.hostname, port: Number(url.port || 6379) };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, "../../../.env"), path.resolve(__dirname, "../../.env")],
    }),
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: "document-processing" }),
  ],
  controllers: [DocumentsController, SearchController],
  providers: [PrismaService, DocprocClient, DocumentsService, DocumentProcessor],
})
export class AppModule {}
