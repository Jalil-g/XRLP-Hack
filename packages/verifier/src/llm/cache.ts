import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../hash.ts";
import { sha256Hex } from "../meta.ts";
import { resolveProvider } from "../config.ts";
import { LlmMilestoneOutput, type MilestoneJudgeInput } from "./types.ts";

export function reviewCacheKey(input: MilestoneJudgeInput, model: string, promptVersion: string): string {
  const files = [...input.photos, ...(input.inspectorPhotos ?? []), ...input.documents].map((l) => ({
    id: l.evidence.id, filename: l.evidence.filename, kind: l.evidence.kind, mimeType: l.evidence.mimeType,
    sha256: l.bytes ? sha256Hex(l.bytes) : null, meta: l.meta, text: l.text,
  }));
  return createHash("sha256").update(canonicalJson({ provider: resolveProvider(), promptVersion, model, ctx: input.ctx, timeline: input.timeline, audits: input.audits ?? [], files })).digest("hex");
}
export async function readReviewCache(directory: string | false, key: string): Promise<{ out: LlmMilestoneOutput; model: string } | undefined> {
  if (!directory) return;
  try {
    const cached = JSON.parse(await readFile(join(directory, `${key}.json`), "utf8"));
    if (cached.key !== key || typeof cached.model !== "string") return;
    return { out: LlmMilestoneOutput.parse(cached.out), model: cached.model };
  } catch { return; }
}
export async function writeReviewCache(directory: string | false, key: string, out: LlmMilestoneOutput, model: string): Promise<void> {
  if (!directory) return;
  try {
    await mkdir(directory, { recursive: true });
    const temp = join(directory, `${key}.${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify({ key, model, out }), { mode: 0o600 });
    await rename(temp, join(directory, `${key}.json`));
  } catch { /* cache availability never changes the model verdict */ }
}
