import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
    await this.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
    await this.$executeRawUnsafe("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector(384)");
  }
}
