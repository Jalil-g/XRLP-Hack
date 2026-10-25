"use client";

// Close (route 8) is only allowed after the vault's SubscriptionDate. Count down to it instead of letting the ledger say tecTOO_SOON.
import { useEffect, useState } from "react";
import { ActionButton } from "@/components/action-button";

function left(to: string) {
  const s = Math.max(0, Math.ceil((Date.parse(to) - Date.now()) / 1000));
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CloseLoanButton({ projectId, actor, opensAt, disabled }: { projectId: string; actor: string; opensAt?: string; disabled?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const waiting = !!opensAt && Date.parse(opensAt) > Date.now();
  return (
    <ActionButton size="sm" disabled={disabled || waiting} action={{ kind: "closeLoan", projectId, actor }}>
      {waiting ? <span className="tabular">Close loan in {left(opensAt!)}</span> : "Close loan"}
    </ActionButton>
  );
}
