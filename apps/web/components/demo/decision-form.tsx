"use client";

// Route 12: the platform operator resolves a needs_human milestone. The reason is required and attested on-chain.
import { useState } from "react";
import { ActionButton } from "@/components/action-button";
import { Input } from "@/components/ui/form";

export function DecisionForm({ projectId, milestoneId, actor, disabled }: { projectId: string; milestoneId: string; actor: string; disabled?: boolean }) {
  const [reason, setReason] = useState("North-side windows confirmed by the inspector's photos.");
  const empty = !reason.trim();
  return (
    <div className="flex w-full max-w-[560px] items-center gap-2">
      <label className="sr-only" htmlFor={`reason-${milestoneId}`}>
        Reason (attested on-chain)
      </label>
      <Input id={`reason-${milestoneId}`} value={reason} onChange={(e) => setReason(e.target.value)} disabled={disabled} className="h-9 text-small" placeholder="Reason, attested on-chain" />
      <ActionButton size="sm" disabled={disabled || empty} action={{ kind: "decide", projectId, milestoneId, actor, decision: "approve", reason }}>
        Approve
      </ActionButton>
      <ActionButton size="sm" variant="danger" disabled={disabled || empty} action={{ kind: "decide", projectId, milestoneId, actor, decision: "reject", reason }}>
        Reject
      </ActionButton>
    </div>
  );
}
