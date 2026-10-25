// CORE-05 · Evidence metadata for HTTP uploads. Files uploaded through route 9 reach the service with `meta: {}` (the HTTP
// layer only stores bytes), so core's FakeVerifier would see no GPS / capture time / pHash / invoice total and could never
// pass. This VerifierPort decorator fills meta from the stored bytes with @xrlp/verifier's extractEvidenceMeta (EXIF,
// 64-bit pHash, text invoice totals) before verifyMilestone. Only `/api/files/<id>` evidence with empty meta is touched;
// seeded demo evidence (data: URLs with meta) is unchanged. Wired for LEDGER_MODE=devnet (fake mode stays as it was).
import { readFile } from "node:fs/promises";
import type { Evidence, VerifierPort, VerifyMilestoneInput } from "@xrlp/shared";
import { extractEvidenceMeta } from "@xrlp/verifier";
import { evidencePath } from "./verifier.ts";

export class UploadedEvidenceMeta implements VerifierPort {
  readonly mode: VerifierPort["mode"];
  private readonly cache = new Map<string, Evidence["meta"]>();
  constructor(
    readonly inner: VerifierPort,
    private readonly dataDir: string,
  ) {
    this.mode = inner.mode;
  }

  private async withMeta<E extends Evidence>(e: E): Promise<E> {
    if (Object.keys(e.meta ?? {}).length) return e;
    const path = evidencePath(e.uri, this.dataDir);
    if (path === e.uri) return e; // not an upload
    let meta = this.cache.get(e.sha256);
    if (!meta) {
      try {
        meta = (await extractEvidenceMeta({ bytes: await readFile(path), mimeType: e.mimeType, filename: e.filename })).meta;
      } catch {
        meta = {}; // unreadable: the checks treat it as missing metadata (warn), never as a pass
      }
      this.cache.set(e.sha256, meta);
    }
    return { ...e, meta };
  }

  async verifyMilestone(input: VerifyMilestoneInput) {
    const [evidence, priorEvidence] = await Promise.all([Promise.all(input.evidence.map((e) => this.withMeta(e))), Promise.all(input.priorEvidence.map((e) => this.withMeta(e)))]);
    return this.inner.verifyMilestone({ ...input, evidence, priorEvidence });
  }
  verifyProject(input: Parameters<VerifierPort["verifyProject"]>[0]) {
    return this.inner.verifyProject(input);
  }
  assignInspector(input: Parameters<VerifierPort["assignInspector"]>[0]) {
    return this.inner.assignInspector(input);
  }
  policyFor(...args: Parameters<VerifierPort["policyFor"]>) {
    return this.inner.policyFor(...args);
  }
  verdictHash(v: Parameters<VerifierPort["verdictHash"]>[0]) {
    return this.inner.verdictHash(v);
  }
}
