// What the audit form shows when route 10 refuses a submission. Matches core's actual messages (packages/core/src/service.ts
// submitAudit) as well as the mock's, so the recovery actions also appear in http mode.
import { ApiError } from "./api.ts";

export type SubmitErrorView = {
  message: string;
  /** The builder's evidence changed since the form loaded: offer "Reload evidence". */
  stale: boolean;
  /** Core refused an unsigned audit (devnet core requires the inspector's own signature): ask for the key. */
  needsKey: boolean;
};

/** core: "Audit must cover the current builder evidence bundle"; mock: "evidenceBundleHash does not match …". */
const STALE = /evidenceBundleHash|current builder evidence bundle/i;
/** core (any ledger mode but fake): "A signed inspector audit is required outside fake demo mode". */
const NEEDS_SIGNATURE = /signed inspector audit is required/i;

export function submitErrorView(err: unknown, signed: boolean): SubmitErrorView {
  const message = err instanceof Error ? err.message : String(err);
  const api = err instanceof ApiError;
  if (api && err.code === "validation" && STALE.test(message)) return { message, stale: true, needsKey: false };
  if (api && !signed && NEEDS_SIGNATURE.test(message)) {
    return {
      message: "Core requires your own signature on this ledger. Load your inspector key below, then review and sign the audit again.",
      stale: false,
      needsKey: true,
    };
  }
  return { message, stale: false, needsKey: false };
}
