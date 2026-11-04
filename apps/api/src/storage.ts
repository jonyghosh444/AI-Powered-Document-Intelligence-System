import { createHash, randomUUID } from "crypto";
import { createReadStream } from "fs";
import { mkdir, unlink } from "fs/promises";
import path from "path";

export const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
};

export function extensionOf(filename: string): string {
  return path.extname(filename || "").toLowerCase();
}

export function mimeFor(filename: string): string | null {
  return ALLOWED_EXTENSIONS[extensionOf(filename)] || null;
}

export function safeOriginalName(filename: string): string {
  const base = path.basename(filename || "upload").replace(/[^\w.\- ()[\]]+/g, "_");
  return base.slice(0, 180) || "upload";
}

export function storageDir(): string {
  return process.env.STORAGE_DIR || path.resolve(process.cwd(), "../../storage/uploads");
}

export async function ensureStorage(): Promise<void> {
  await mkdir(storageDir(), { recursive: true });
}

export function storedName(original: string): string {
  return `${randomUUID()}${extensionOf(original)}`;
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function removeFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    return;
  }
}

export function maxUploadBytes(): number {
  const raw = Number(process.env.MAX_UPLOAD_BYTES || 26_214_400);
  return Number.isFinite(raw) && raw > 0 ? raw : 26_214_400;
}
