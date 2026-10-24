// InspectorAudit: the signed site report a licensed inspector files per milestone (Direction v2).
// Use the shared v2 contract; do not define a competing cross-package schema here.
import { createHash } from "node:crypto";
export { InspectorAudit } from "@xrlp/shared";
import { z } from "zod";

export const ChecklistStatus = z.enum(["done", "partial", "not_done"]);
export type ChecklistStatus = z.infer<typeof ChecklistStatus>;

/**
 * Binds an audit to the exact builder evidence it covers: sha256 over the sorted per-file sha256
 * values joined by "\n". Order-independent, so re-uploading the same files in another order matches.
 */
export function evidenceBundleHash(evidence: readonly { sha256: string }[]): string {
  return createHash("sha256")
    .update([...evidence.map((e) => e.sha256)].sort().join("\n"))
    .digest("hex");
}
