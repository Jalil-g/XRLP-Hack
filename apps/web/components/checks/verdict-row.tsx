// The AI verdict over the whole suite: decision, confidence, model, and the attestation recorded before any release.
import { TxLink } from "@/components/chain";
import type { Verdict } from "@/lib/contract";
import { ROW_GRID, StatusIcon } from "./status-icon";

const WORD = { pass: "Pass", fail: "Fail", needs_human: "Needs review" } as const;

export function VerdictRow({ verdict, attestationTx, released }: { verdict: Verdict; attestationTx?: string; released: boolean }) {
  const state = verdict.decision === "pass" ? "pass" : verdict.decision === "fail" ? "fail" : "warn";
  return (
    <div className={`${ROW_GRID} border-t border-line bg-band`}>
      <StatusIcon state={state} className="mt-0.5" />
      <span className="text-small font-medium text-ink">AI verdict</span>
      <span className="text-small text-ink-2">
        <span className="font-medium text-ink">{WORD[verdict.decision]}</span> · confidence{" "}
        <span className="tabular font-medium text-ink">{verdict.confidence.toFixed(2)}</span> · {verdict.model === "mock" ? "mock verifier" : verdict.model}
        <span className="block text-caption">{released ? "Attested on-chain before the escrow was released" : "Attested on-chain"}</span>
      </span>
      <span className="justify-self-end">{attestationTx && <TxLink hash={attestationTx} />}</span>
    </div>
  );
}
