import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { Inspector } from "@/lib/types";
import { API_MODE } from "@/lib/api";
import { cn, explorerTxUrl } from "@/lib/utils";

/** VERIFIED_INSPECTOR credential (XLS-70) as an inline mark, linked to its CredentialCreate tx when known. */
export function VerifiedInspectorBadge({ inspector, className }: { inspector: Inspector; className?: string }) {
  const mark = inspector.verified ? (
    <span className={cn("inline-flex items-center gap-1 text-pass", className)}>
      <ShieldCheck className="size-3.5" aria-hidden /> Verified inspector
    </span>
  ) : (
    <span className={cn("inline-flex items-center gap-1 text-review", className)}>
      <ShieldAlert className="size-3.5" aria-hidden /> Not verified
    </span>
  );
  if (!inspector.verified || !inspector.credentialTx || API_MODE === "mock") return mark;
  return (
    <a href={explorerTxUrl(inspector.credentialTx)} target="_blank" rel="noreferrer" title="Credential on XRPL devnet" className="hover:underline">
      {mark}
    </a>
  );
}
