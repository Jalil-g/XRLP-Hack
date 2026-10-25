import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Inspector } from "@/lib/types";
import { explorerTxUrl } from "@/lib/utils";

/** VERIFIED_INSPECTOR credential (XLS-70), linked to its CredentialCreate tx when known. */
export function VerifiedInspectorBadge({ inspector }: { inspector: Inspector }) {
  if (!inspector.verified) {
    return (
      <Badge tone="warn">
        <ShieldAlert /> Not verified
      </Badge>
    );
  }
  const badge = (
    <Badge tone="ok" className="font-mono tracking-tight">
      <ShieldCheck /> VERIFIED_INSPECTOR
    </Badge>
  );
  if (!inspector.credentialTx) return badge;
  return (
    <a href={explorerTxUrl(inspector.credentialTx)} target="_blank" rel="noreferrer" title="Credential on XRPL devnet" className="hover:opacity-80">
      {badge}
    </a>
  );
}
