// InspectorAudit: the signed site report a licensed inspector files per milestone (Direction v2).
// Shape follows docs/05-api.md. NOTE: this is declared locally until the contract PR (#53) moves it
// into @xrlp/shared; keep the fields identical so the swap is an import change.
import { createHash } from "node:crypto";
import { Evidence, XrplAddress } from "@xrlp/shared";
import { z } from "zod";

export const ChecklistStatus = z.enum(["done", "partial", "not_done"]);
export type ChecklistStatus = z.infer<typeof ChecklistStatus>;

export const InspectorAudit = z.object({
  milestoneId: z.string(),
  inspector: XrplAddress,
  /** evidenceBundleHash(...) of the builder evidence the inspector looked at. */
  evidenceBundleHash: z.string().regex(/^[0-9a-f]{64}$/),
  checklist: z.array(z.object({ sovCode: z.string(), status: ChecklistStatus, note: z.string().optional() })),
  photos: z.array(Evidence),
  notes: z.string(),
  /** Attestation memo tx (kind "audit"). Mock fixtures use a fake hash, labelled in SOURCES.txt. */
  txHash: z.string().optional(),
  at: z.string().datetime(),
});
export type InspectorAudit = z.infer<typeof InspectorAudit>;

/**
 * Binds an audit to the exact builder evidence it covers: sha256 over the sorted per-file sha256
 * values joined by "\n". Order-independent, so re-uploading the same files in another order matches.
 */
export function evidenceBundleHash(evidence: readonly { sha256: string }[]): string {
  return createHash("sha256")
    .update([...evidence.map((e) => e.sha256)].sort().join("\n"))
    .digest("hex");
}
