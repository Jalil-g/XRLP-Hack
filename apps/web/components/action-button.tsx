"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { API_MODE, api } from "@/lib/api";
import { errorDescription, errorFeedback } from "@/lib/error-feedback";
import { cancelFeedback, checksFeedback, decisionFeedback } from "@/lib/action-feedback";
import type { ChainEvent, Rlusd, XrplAddress } from "@/lib/contract";
import { shortHash } from "@/lib/utils";

/** Every write the UI can trigger, by route. Serializable so server components can pass it down. */
export type Action =
  | { kind: "payFee"; projectId: string; builder: XrplAddress }
  | { kind: "verifyProject"; projectId: string }
  | { kind: "lockTerms"; projectId: string; actor: XrplAddress }
  | { kind: "invest"; projectId: string; investor: XrplAddress; amount: Rlusd }
  | { kind: "closeLoan"; projectId: string; actor: XrplAddress }
  | { kind: "runChecks"; projectId: string; milestoneId: string }
  | { kind: "decide"; projectId: string; milestoneId: string; actor: XrplAddress; decision: "approve" | "reject"; reason: string }
  | { kind: "cancelMilestone"; projectId: string; milestoneId: string }
  | { kind: "repay"; projectId: string; amount: Rlusd }
  | { kind: "withdraw"; projectId: string; investor: XrplAddress; amount: Rlusd }
  | { kind: "kyc"; investor: XrplAddress }
  | { kind: "resetDemo" }
  | { kind: "keeperTick" }
  | { kind: "tryStealDemo"; projectId: string; milestoneId: string };

type Outcome = { message: string; events: ChainEvent[]; tone?: "success" | "error" | "info" };

async function perform(a: Action): Promise<Outcome> {
  switch (a.kind) {
    case "payFee": {
      const r = await api.payVerificationFee(a.projectId, a.builder);
      return { message: "Verification fee paid", events: r.events };
    }
    case "verifyProject": {
      const r = await api.verifyProject(a.projectId);
      const word = { pass: "Project verified", fail: "Verification failed", needs_human: "Verification needs an inspector visit" }[r.verification.decision];
      return { message: word, events: r.events, tone: r.verification.decision === "pass" ? "success" : "error" };
    }
    case "lockTerms": {
      const r = await api.lockTerms(a.projectId, a.actor);
      return { message: "Terms locked; funding is open", events: r.events };
    }
    case "invest": {
      const r = await api.invest(a.projectId, a.investor, a.amount);
      return { message: "Deposit confirmed", events: r.events };
    }
    case "closeLoan": {
      const r = await api.closeLoan(a.projectId, a.actor);
      return { message: "Loan closed; milestone escrows created", events: r.events };
    }
    case "runChecks": {
      const r = await api.runChecks(a.projectId, a.milestoneId);
      return { ...checksFeedback(r), events: r.events };
    }
    case "decide": {
      const r = await api.decide(a.projectId, a.milestoneId, { actor: a.actor, decision: a.decision, reason: a.reason });
      return { ...decisionFeedback(a.decision, r.milestone), events: r.events };
    }
    case "cancelMilestone": {
      const r = await api.cancelMilestone(a.projectId, a.milestoneId);
      return { ...cancelFeedback(r.milestone), events: r.events };
    }
    case "repay": {
      const r = await api.repay(a.projectId, a.amount);
      return { message: "Repayment sent to the vault", events: r.events };
    }
    case "withdraw": {
      const r = await api.withdraw(a.projectId, a.investor, a.amount);
      return { message: "Withdrawal sent", events: r.events };
    }
    case "kyc": {
      const r = await api.kycInvestor(a.investor);
      return { message: "KYC credential issued", events: r.events };
    }
    case "resetDemo": {
      await api.resetDemo();
      return { message: "Demo reset", events: [] };
    }
    case "keeperTick": {
      const r = await api.keeperTick();
      return { message: r.events.length ? "Keeper updates recorded; check the project timeline" : "No keeper updates recorded", events: r.events, tone: "info" };
    }
    case "tryStealDemo": {
      const r = await api.tryStealDemo(a.projectId, a.milestoneId);
      return {
        message: `Ledger refused: ${r.result}`,
        events: [{ projectId: a.projectId, milestoneId: a.milestoneId, kind: "release_refused", txHash: r.txHash, explorerUrl: r.explorerUrl, at: new Date().toISOString() }],
        tone: "error",
      };
    }
  }
}

export function ActionButton({
  action,
  children,
  variant = "primary",
  size = "md",
  disabled,
  className,
  afterHref,
}: {
  action: Action;
  /** Navigate here (replace, no scroll) on success instead of a plain refresh, e.g. to pin ?m= to the milestone just run. */
  afterHref?: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const out = await perform(action);
      const last = out.events[out.events.length - 1];
      const description = last ? `${out.events.length} transaction${out.events.length === 1 ? "" : "s"} · last ${shortHash(last.txHash)}` : undefined;
      const opts = {
        description,
        action: last && API_MODE === "http" ? { label: "Explorer", onClick: () => window.open(last.explorerUrl, "_blank", "noreferrer") } : undefined,
      };
      if (out.tone === "error") toast.error(out.message, opts);
      else if (out.tone === "info") toast.info(out.message, opts);
      else toast.success(out.message, opts);
      if (afterHref) router.replace(afterHref, { scroll: false });
      router.refresh();
    } catch (err) {
      const feedback = errorFeedback(err);
      toast.error(feedback.title, { description: errorDescription(feedback), duration: 10_000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant={variant} size={size} disabled={disabled || busy} onClick={run} className={className} aria-busy={busy}>
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
