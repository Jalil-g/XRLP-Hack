"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { TxLink } from "@/components/chain";
import { InvestmentTransfer } from "@/components/project/investment-transfer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/form";
import { Tag } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
import { errorDescription, errorFeedback } from "@/lib/error-feedback";
import type { Investment, Party } from "@/lib/contract";
import { formatAmount, formatBps, formatDate, fromCents, toCents } from "@/lib/utils";

export function InvestDialog({
  projectId,
  projectName,
  remaining,
  rateBps,
  investor,
  redemptionDate,
}: {
  projectId: string;
  projectName: string;
  /** RLUSD left to raise. */
  remaining: string;
  rateBps: number;
  investor: Party;
  redemptionDate?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const submitting = useRef(false);
  const [raw, setRaw] = useState("10000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Investment | null>(null);

  const validNumber = /^\d+(?:\.\d{0,2})?$/.test(raw.trim());
  const cents = validNumber ? toCents(raw.trim()) : 0;
  const invalid = !validNumber || !Number.isSafeInteger(cents) ? "Enter a valid amount with up to two decimal places" : cents <= 0 ? "Enter an amount" : cents > toCents(remaining) ? `Only ${formatAmount(remaining)} RLUSD is left to raise` : null;

  const changeOpen = (nextOpen: boolean) => {
    if (submitting.current) return;
    setOpen(nextOpen);
    if (!nextOpen && done) router.refresh();
  };

  const deposit = async () => {
    if (submitting.current || invalid || !reviewing) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.invest(projectId, investor.address, fromCents(cents));
      setDone(r.investment);
    } catch (err) {
      const feedback = errorFeedback(err);
      setError(err instanceof ApiError && err.txResult === "tecNO_AUTH" ? `${investor.name} needs a KYC credential first. Issue one from Portfolio.` : `${feedback.title}. ${errorDescription(feedback)}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="lg"
        onClick={() => {
          setDone(null);
          setReviewing(false);
          setError(null);
          setOpen(true);
        }}
      >
        Invest
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent closeDisabled={busy} data-pause-auto-refresh="true">
          {busy || done ? (
            <>
              <DialogHeader>
                <DialogTitle>{done ? "You’re invested" : "Moving your investment"}</DialogTitle>
                <DialogDescription>
                  {done ? `Your deposit in ${projectName} is confirmed.` : `Sending your RLUSD to the ${projectName} vault.`}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <InvestmentTransfer
                  amount={done?.amount ?? fromCents(cents)}
                  investorName={investor.name}
                  investorAddress={investor.address}
                  projectName={projectName}
                  confirmed={!!done}
                />
                {done && <p className="mt-4 border-t border-line pt-4 text-small text-ink-2">VaultDeposit <TxLink hash={done.tx} /></p>}
              </DialogBody>
              <DialogFooter>
                {done ? <Button onClick={() => changeOpen(false)}>Done</Button> : <p className="w-full text-center text-caption text-ink-2">Waiting for the vault to respond.</p>}
              </DialogFooter>
            </>
          ) : reviewing ? (
            <>
              <DialogHeader>
                <DialogTitle>Review your deposit</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <p className="hero-amount !text-[44px]">
                  {formatAmount(cents / 100, { cents: true })}
                  <span>{" "}RLUSD</span>
                </p>
                <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-small">
                  <dt className="text-ink-2">Project</dt>
                  <dd className="font-medium">{projectName}</dd>
                  <dt className="text-ink-2">From</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <span>{investor.name}</span>
                    <Tag tone={investor.kyc ? "pass" : "review"}>{investor.kyc ? "KYC verified" : "KYC required"}</Tag>
                  </dd>
                  <dt className="text-ink-2">Annual rate</dt>
                  <dd>{formatBps(rateBps)}</dd>
                </dl>
                <p className="text-small text-ink-2">You get vault shares. {redemptionDate ? `Withdrawals open ${formatDate(redemptionDate)}, if vault funds allow.` : "Withdrawals open at the vault redemption date, if funds allow."}</p>
                {error && <p role="alert" className="rounded-control bg-fail-bg p-3 text-small text-fail">{error}</p>}
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" disabled={busy} onClick={() => setReviewing(false)}>Edit amount</Button>
                <Button disabled={!!invalid || busy} onClick={deposit}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  {busy ? "Depositing…" : `Deposit ${formatAmount(cents / 100, { cents: true })} RLUSD`}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Invest in {projectName}</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-2">
                <Label htmlFor="amount">Amount (RLUSD)</Label>
                <Input id="amount" inputMode="decimal" autoFocus value={raw} onChange={(e) => setRaw(e.target.value)} className="tabular" aria-invalid={!!invalid} aria-describedby="amount-help" />
                <p id="amount-help" className="text-caption text-ink-2">
                  {invalid ? <span className="text-fail">{invalid}</span> : `${formatAmount(remaining)} RLUSD open`}
                </p>
                {error && <p role="alert" className="rounded-control bg-fail-bg px-3 py-2 text-small text-fail">{error}</p>}
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={!!invalid || busy} onClick={() => setReviewing(true)}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  Review deposit
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
