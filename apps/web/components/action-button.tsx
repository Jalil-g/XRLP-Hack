"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { API_MODE, api } from "@/lib/api";
import { errorDescription, errorFeedback } from "@/lib/error-feedback";
import { cancelFeedback, checksFeedback, decisionFeedback } from "@/lib/action-feedback";
import type { ChainEvent, Rlusd, XrplAddress } from "@/lib/contract";
import { FundsTransfer } from "@/components/project/investment-transfer";
import { ProcessFeedback } from "@/components/process-feedback";
import { TxLink } from "@/components/chain";
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
  context,
}: {
  action: Action;
  context?: string;
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
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const [receipt, setReceipt] = useState<Outcome | null>(null);
  const needsReview = ["payFee", "invest", "repay", "withdraw"].includes(action.kind);

  const showExperience = needsReview || ["verifyProject", "lockTerms", "closeLoan", "runChecks", "decide", "cancelMilestone"].includes(action.kind);
  const finish = () => {
    if (submitting.current) return;
    setReviewing(false);
    if (receipt) {
      if (afterHref) router.replace(afterHref, { scroll: false });
      router.refresh();
    }
  };
  const run = async () => {
    if (submitting.current || disabled) return;
    submitting.current = true;
    setError(undefined);
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
      if (showExperience) setReceipt(out);
      else {
        if (afterHref) router.replace(afterHref, { scroll: false });
        router.refresh();
      }
    } catch (err) {
      const feedback = errorFeedback(err);
      setError(`${feedback.title}. ${errorDescription(feedback)}`);
      toast.error(feedback.title, { description: errorDescription(feedback), duration: 10_000 });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const money = needsReview && ("amount" in action || action.kind === "payFee");
  const amount = "amount" in action ? action.amount : "250";
  const withdrawal = action.kind === "withdraw";
  const fee = action.kind === "payFee";
  const sourceAddress = "investor" in action && !withdrawal ? action.investor : "builder" in action ? action.builder : undefined;
  const note = !needsReview ? "Review the error below before retrying this action." : fee ? "This payment covers project verification. The project review runs next." : withdrawal ? "Your vault shares are redeemed for available funds." : "Funds arrive in the project vault. Builder payouts follow milestone checks.";
  return (
    <>
      <Button variant={variant} size={size} disabled={disabled || busy} onClick={() => {
        setError(undefined);
        setReceipt(null);
        if (showExperience) setReviewing(true);
        if (!needsReview) void run();
      }} className={className} aria-busy={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}{children}
      </Button>
      <Dialog open={reviewing} onOpenChange={(open) => { if (!open) finish(); }}>
        <DialogContent className={money && (busy || receipt) ? "max-w-[540px]" : undefined} closeDisabled={busy} data-pause-auto-refresh="true">
          <DialogHeader><DialogTitle>{receipt ? receipt.message : busy ? money ? "Moving your funds" : "Processing your request" : needsReview ? "Review transaction" : "Try this action again"}</DialogTitle><DialogDescription>{context ?? (busy ? "The result will appear as soon as it is confirmed." : "Check the details for this action.")}</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4 text-small">
            {busy || receipt ? money ? <FundsTransfer amount={amount}
              source={{ label: withdrawal ? "Project vault" : "Your wallet", name: withdrawal ? context ?? "Project vault" : "Selected account", address: sourceAddress, kind: withdrawal ? "vault" : "wallet" }}
              destination={{ label: withdrawal ? "Your wallet" : fee ? "Verification" : "Project vault", name: withdrawal ? "Investor account" : fee ? "Drawproof" : context ?? "Project vault", kind: withdrawal ? "wallet" : "vault" }}
              confirmed={!!receipt} successLabel={receipt?.message ?? "Transfer confirmed"} note={note} />
              : <ProcessFeedback state={busy ? "pending" : receipt?.tone === "error" || receipt?.tone === "info" ? "held" : "complete"} title={busy ? "Checking the request" : receipt?.message ?? "Request complete"} detail={busy ? "Waiting for a result. No changes are confirmed yet." : "The result above reflects the completed request."} />
              : <><p className="text-heading">{children}</p>{"investor" in action && <p className="break-all text-caption text-ink-2">Investor: {action.investor}</p>}{"builder" in action && <p className="break-all text-caption text-ink-2">Builder: {action.builder}</p>}<p className="text-ink-2">{note}</p>{API_MODE === "mock" && <p className="text-caption text-review">Mock data · No real funds move.</p>}</>}
            {receipt && receipt.events.length > 0 && <details className="disclosure"><summary>Transaction receipt <span className="text-caption text-ink-2">{receipt.events.length} recorded</span></summary><div className="disclosure-body space-y-2">{receipt.events.map((event, index) => <p key={`${event.txHash}-${index}`} className="flex flex-wrap justify-between gap-2 text-caption"><span>{event.kind.replaceAll("_", " ")}</span><TxLink hash={event.txHash} /></p>)}</div></details>}
            {error && <p role="alert" className="rounded-control bg-fail-bg p-3 text-fail">{error}</p>}
          </DialogBody>
          <DialogFooter>{receipt ? <Button onClick={finish}>Done</Button> : !busy && <><Button variant="secondary" onClick={finish}>{needsReview ? "Back" : "Close"}</Button><Button onClick={() => void run()}>{needsReview ? children : "Try again"}</Button></>}</DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
