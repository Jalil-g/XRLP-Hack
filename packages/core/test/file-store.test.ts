import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { FileStore, saveEvidenceBlob } from "../src/file-store.ts";

const exec = promisify(execFile);
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "drawproof-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("independent instances preserve every concurrent update", async (t) => {
  const dir = await fixture(t);
  const stores = [new FileStore(dir), new FileStore(dir)];
  await Promise.all(Array.from({ length: 40 }, (_, i) => stores[i % 2]!.write((db) => {
    db.investors.push({ address: `r${i}`, name: "", createdAt: "" });
  })));
  assert.equal(await stores[0]!.read((db) => db.investors.length), 40);
  assert.deepEqual(await readdir(dir), ["core-db.json"]);
});

test("separate Node processes cannot lose each other's writes", async (t) => {
  const dir = await fixture(t);
  const script = `import { FileStore } from ${JSON.stringify(new URL("../src/file-store.ts", import.meta.url).href)};
    const store = new FileStore(process.argv[1]);
    for (let i = 0; i < 12; i++) await store.write(db => db.investors.push({
      address: process.pid + '-' + i, name: '', createdAt: '' }));`;
  await Promise.all(Array.from({ length: 3 }, () => exec(process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, dir])));
  const rows = await new FileStore(dir).read((db) => db.investors);
  assert.equal(rows.length, 36);
  assert.equal(new Set(rows.map((row) => row.address)).size, 36);
});

test("failed transactions preserve data and release the lock", async (t) => {
  const dir = await fixture(t);
  const store = new FileStore(dir);
  await store.reset();
  const before = await readFile(store.path, "utf8");
  await assert.rejects(store.write((db) => {
    db.investors.push({ address: "rX", name: "", createdAt: "" });
    throw new Error("abort");
  }), /abort/);
  assert.equal(await readFile(store.path, "utf8"), before);
  await store.reset();
  assert.deepEqual(await readdir(dir), ["core-db.json"]);
});

test("held or abandoned locks fail closed instead of being stolen", async (t) => {
  const dir = await fixture(t);
  const store = new FileStore(dir, "core-db.json", 30);
  await writeFile(`${store.path}.lock`, "held");
  await assert.rejects(store.reset(), /Store lock timeout/);
  assert.equal(await readFile(`${store.path}.lock`, "utf8"), "held");
  assert.deepEqual(await readdir(dir), ["core-db.json.lock"]);
});

test("failed rename cleans temporary files and releases the lock", async (t) => {
  const dir = await fixture(t);
  const store = new FileStore(dir);
  await mkdir(store.path);
  await assert.rejects(store.reset());
  assert.deepEqual(await readdir(dir), ["core-db.json"]);
  await rm(store.path, { recursive: true });
  await store.reset();
});

test("corrupt data is reported, never silently replaced", async (t) => {
  const dir = await fixture(t);
  const store = new FileStore(dir);
  await writeFile(store.path, "invalid JSON");
  await assert.rejects(store.write(() => undefined), SyntaxError);
  assert.equal(await readFile(store.path, "utf8"), "invalid JSON");
  assert.deepEqual(await readdir(dir), ["core-db.json"]);
});

test("store and evidence files are private; evidence IDs cannot escape their directory", async (t) => {
  const dir = await fixture(t);
  const store = new FileStore(dir);
  await store.reset();
  const blob = await saveEvidenceBlob(dir, {
    projectId: "maple-st-duplex", milestoneId: "maple-st-duplex:m1", filename: "../photo.jpg", bytes: Buffer.from("photo"),
  });
  if (process.platform !== "win32") {
    assert.equal((await stat(store.path)).mode & 0o777, 0o600);
    assert.equal((await stat(blob.absPath)).mode & 0o777, 0o600);
  }
  assert.equal(await readFile(blob.absPath, "utf8"), "photo");
  for (const bad of ["..", "../outside", "a/b", "a\\b", ""]) {
    await assert.rejects(saveEvidenceBlob(dir, {
      projectId: bad, milestoneId: "foundation", filename: "photo.jpg", bytes: Buffer.from("x"),
    }), /Invalid evidence/);
  }
  assert.throws(() => new FileStore(dir, "../outside.json"), /single file name/);
});
