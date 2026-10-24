// JSON-file Store under DATA_DIR (default: <repo root>/.data, gitignored). Atomic writes: temp file + rename.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { emptyDb, normalizeDb, SerialQueue, type DbState, type Store } from "./store.ts";
import { sha256Hex } from "./ids.ts";

/** DATA_DIR env, else `<nearest dir containing pnpm-workspace.yaml>/.data`, else `<cwd>/.data`. */
export function resolveDataDir(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  if (env.DATA_DIR) return resolve(cwd, env.DATA_DIR);
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, ".data");
    const parent = dirname(dir);
    if (parent === dir) return join(resolve(cwd), ".data");
    dir = parent;
  }
}

async function writeAtomic(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

export class FileStore implements Store {
  readonly path: string;
  private queue = new SerialQueue();
  constructor(readonly dataDir: string = resolveDataDir(), filename = "core-db.json") {
    this.path = join(dataDir, filename);
  }
  private async load(): Promise<DbState> {
    try {
      return normalizeDb(JSON.parse(await readFile(this.path, "utf8")) as Partial<DbState>);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
      throw e;
    }
  }
  async read<T>(fn: (db: DbState) => T): Promise<T> {
    return fn(await this.load());
  }
  write<T>(fn: (db: DbState) => T): Promise<T> {
    return this.queue.run(async () => {
      const db = await this.load();
      const out = fn(db);
      await writeAtomic(this.path, JSON.stringify(db, null, 2));
      return out;
    });
  }
  async reset(db: DbState = emptyDb()): Promise<void> {
    await this.queue.run(() => writeAtomic(this.path, JSON.stringify(db, null, 2)));
  }
}

/** Save an uploaded evidence file under DATA_DIR/evidence/<projectId>/<milestoneId>/. Returns uri relative to DATA_DIR. */
export async function saveEvidenceBlob(
  dataDir: string,
  input: { projectId: string; milestoneId: string; filename: string; bytes: Uint8Array },
): Promise<{ uri: string; sha256: string; absPath: string }> {
  const sha256 = sha256Hex(Buffer.from(input.bytes));
  const safe = input.filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const uri = join("evidence", input.projectId, input.milestoneId, `${sha256.slice(0, 12)}-${safe}`);
  const absPath = join(dataDir, uri);
  await writeAtomic(absPath, input.bytes);
  return { uri, sha256, absPath };
}
