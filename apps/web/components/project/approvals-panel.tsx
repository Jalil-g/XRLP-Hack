import { Check, Clock, KeyRound, ShieldCheck, X } from "lucide-react";
import { PartyAvatar, TxLink } from "@/components/chain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MilestoneView, SignerSlot } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const ROLE_LABEL: Record<SignerSlot["role"], string> = {
  inspector: "Inspector",
  ai_agent: "AI verifier",
  platform: "Platform",
};

export function ApprovalsPanel({ view, className }: { view: MilestoneView; className?: string }) {
  const { quorum, releaseKeyHolder, milestone } = view;
  const released = milestone.status === "released";
  const segments = Array.from({ length: quorum.required }, (_, i) => i < quorum.collected);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="items-center py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <ShieldCheck className="size-4" />
          </span>
          <CardTitle>Release approvals</CardTitle>
        </div>
        <span className={cn("text-[13px] font-medium tabular", quorum.met ? "text-ok" : "text-muted")}>
          {Math.min(quorum.collected, quorum.required)} / {quorum.required} weight
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex gap-1">
            {segments.map((filled, i) => (
              <div key={i} className={cn("h-1.5 flex-1 rounded-full", filled ? (quorum.met ? "bg-ok" : "bg-brand") : "bg-subtle")} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Needs an inspector (weight 2) plus one more signer.{" "}
            {quorum.inspectorsRequired > 1 ? (
              <span className="font-medium text-ink-2">Milestone ≥ 50,000 RLUSD: both inspectors must sign.</span>
            ) : null}{" "}
            Inspectors signed: {quorum.inspectorsSigned}/{quorum.inspectorsRequired}.
          </p>
        </div>

        <ul className="space-y-1">
          {quorum.signers.map((s) => {
            const att = s.attestation;
            const isKey = releaseKeyHolder?.address === s.address;
            const optional = s.role === "inspector" && !isKey && quorum.inspectorsRequired === 1;
            return (
              <li key={s.address} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-subtle/60">
                <PartyAvatar role={s.role} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <span className="truncate">{s.name}</span>
                    {isKey && <KeyRound className="size-3.5 shrink-0 text-amber-600" aria-label="Holds release key" />}
                  </div>
                  <div className="text-xs text-muted">
                    {ROLE_LABEL[s.role]} · weight {s.weight}
                    {optional && " · optional"}
                  </div>
                </div>
                <div className="text-right">
                  {att ? (
                    <>
                      <div className={cn("inline-flex items-center gap-1 text-[13px] font-medium", att.decision === "approve" ? "text-ok" : "text-bad")}>
                        {att.decision === "approve" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                        {att.decision === "approve" ? "Signed" : "Rejected"}
                      </div>
                      <div className="flex items-center justify-end gap-1.5 text-[11px] text-faint">
                        {att.txHash ? <TxLink hash={att.txHash} className="text-[11px]" /> : formatDateTime(att.at)}
                      </div>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[13px] text-faint">
                      <Clock className="size-3.5" />
                      {released ? "Not needed" : "Awaiting"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {releaseKeyHolder && (
          <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <p className="text-[13px] leading-snug text-amber-900">
              <span className="font-semibold">Release key held by {releaseKeyHolder.name}.</span> The escrow’s fulfillment was
              generated on the inspector’s side — the platform never sees it and cannot release these funds.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
