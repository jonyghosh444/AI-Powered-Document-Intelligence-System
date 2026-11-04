import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { ensureStorage } from "./storage";
import { UploadExceptionFilter } from "./upload.filter";

async function bootstrap() {
  await ensureStorage();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN || "http://localhost:3000" });
  app.useGlobalFilters(new UploadExceptionFilter());
  app.useBodyParser("json", { limit: "2mb" });
  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
}

bootstrap();
