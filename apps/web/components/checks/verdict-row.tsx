// The AI verdict over the whole suite: decision and confidence. Model, hash and attestation tx live in Proof.
import type { Verdict } from "@/lib/contract";
import { ROW_GRID, StatusIcon } from "./status-icon";

const WORD = { pass: "Pass", fail: "Fail", needs_human: "Needs review" } as const;

export function VerdictRow({ verdict }: { verdict: Verdict }) {
  const state = verdict.decision === "pass" ? "pass" : verdict.decision === "fail" ? "fail" : "warn";
  return (
    <div className={`${ROW_GRID} border-t border-line`}>
      <StatusIcon state={state} />
      <span className="text-body font-semibold text-ink">AI verdict</span>
      <span className="flex items-baseline gap-3 text-small">
        <span className="font-semibold text-ink">{WORD[verdict.decision]}</span>
        <span className="text-ink-2">
          Confidence <span className="tabular font-semibold text-ink">{verdict.confidence.toFixed(2)}</span>
        </span>
      </span>
      <span />
    </div>
  );
}
