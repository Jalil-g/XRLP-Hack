"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { TxLink } from "@/components/chain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/form";
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

  const deposit = async () => {
    if (submitting.current || invalid || !reviewing) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.invest(projectId, investor.address, fromCents(cents));
      setDone(r.investment);
      router.refresh();
    } catch (err) {
      const feedback = errorFeedback(err);
      setError(err instanceof ApiError && err.txResult === "tecNO_AUTH" ? `${investor.name} needs a KYC credential before depositing. The vault refused it (tecNO_AUTH).` : `${feedback.title}. ${errorDescription(feedback)}`);
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
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          {done ? (
            <>
              <DialogHeader>
                <DialogTitle>Deposit confirmed</DialogTitle>
                <DialogDescription>
                  {formatAmount(done.amount)} RLUSD is in the {projectName} vault. It is lent to the project when funding closes, then released milestone by milestone.
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="text-small text-ink-2">
                VaultDeposit <TxLink hash={done.tx} />
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : reviewing ? (
            <>
              <DialogHeader>
                <DialogTitle>Review your deposit</DialogTitle>
                <DialogDescription>Step 2 of 2 · Check the project, account, and amount before paying.</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <dl className="space-y-3 text-small">
                  <div><dt className="text-ink-2">Project</dt><dd className="font-medium">{projectName}</dd></div>
                  <div><dt className="text-ink-2">Investor</dt><dd>{investor.name}</dd></div>
                  <div><dt className="text-ink-2">Deposit</dt><dd className="text-heading tabular">{formatAmount(cents / 100, { cents: true })} RLUSD</dd></div>
                  <div><dt className="text-ink-2">Annual rate</dt><dd>{formatBps(rateBps)}</dd></div>
                </dl>
                <p className="rounded-control bg-band p-3 text-small text-ink-2">You receive vault shares. {redemptionDate ? `Withdrawals open from ${formatDate(redemptionDate)}, subject to available vault funds.` : "Withdrawals depend on the vault's redemption date and available funds; this is not an instant-access deposit."}</p>
                {error && <p role="alert" className="rounded-control bg-fail-bg p-3 text-small text-fail">{error}</p>}
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" disabled={busy} onClick={() => setReviewing(false)}>Back to amount</Button>
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
                <DialogDescription>Step 1 of 2 · Choose an amount as {investor.name}. Review the details before paying.</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-2">
                <Label htmlFor="amount">Amount (RLUSD)</Label>
                <Input id="amount" inputMode="decimal" autoFocus value={raw} onChange={(e) => setRaw(e.target.value)} className="tabular" aria-invalid={!!invalid} aria-describedby="amount-help" />
                <p id="amount-help" className="text-caption text-ink-2">
                  {invalid ? <span className="text-fail">{invalid}</span> : `${formatBps(rateBps)} a year · ${formatAmount(remaining)} RLUSD left to raise`}
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
