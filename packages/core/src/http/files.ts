// Uploaded evidence / audit files under `${DATA_DIR}/files/<fileId>` with a sidecar `<fileId>.json` (StoredFile).
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainError } from "../errors.ts";
import type { StoredFile } from "../api-surface.ts";

export const DEFAULT_MAX_FILE_BYTES = 15 * 1024 * 1024;
const FILE_ID = /^[a-f0-9-]{36}$/;

export class UploadStore {
  readonly dir: string;
  readonly maxBytes: number;
  constructor(dataDir: string, maxBytes = DEFAULT_MAX_FILE_BYTES) {
    this.dir = join(dataDir, "files");
    this.maxBytes = maxBytes;
  }

  async save(file: File): Promise<StoredFile> {
    if (file.size > this.maxBytes) {
      throw new DomainError("VALIDATION", `${file.name}: ${file.size} bytes exceeds the ${this.maxBytes}-byte limit`);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const fileId = randomUUID();
    const stored: StoredFile = {
      fileId,
      filename: file.name || fileId,
      mimeType: file.type || "application/octet-stream",
      uri: `/api/files/${fileId}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, fileId), bytes);
    await writeFile(join(this.dir, `${fileId}.json`), JSON.stringify(stored, null, 2));
    return stored;
  }

  async get(fileId: string): Promise<{ meta: StoredFile; bytes: Buffer } | null> {
    if (!FILE_ID.test(fileId)) return null; // also blocks path traversal
    try {
      const meta = JSON.parse(await readFile(join(this.dir, `${fileId}.json`), "utf8")) as StoredFile;
      return { meta, bytes: await readFile(join(this.dir, fileId)) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
}
