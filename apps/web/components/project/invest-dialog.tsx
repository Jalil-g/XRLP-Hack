"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { TxLink } from "@/components/chain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/form";
import { ApiError, api } from "@/lib/api";
import type { Investment, Party } from "@/lib/contract";
import { formatAmount, formatBps, fromCents, toCents } from "@/lib/utils";

export function InvestDialog({
  projectId,
  projectName,
  remaining,
  rateBps,
  investor,
}: {
  projectId: string;
  projectName: string;
  /** RLUSD left to raise. */
  remaining: string;
  rateBps: number;
  investor: Party;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("10000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Investment | null>(null);

  const cents = toCents(raw.replace(/[^\d.]/g, "") || "0");
  const invalid = cents <= 0 ? "Enter an amount" : cents > toCents(remaining) ? `Only ${formatAmount(remaining)} RLUSD is left to raise` : null;

  const deposit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.invest(projectId, investor.address, fromCents(cents));
      setDone(r.investment);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.txResult === "tecNO_AUTH" ? `${investor.name} needs a KYC credential before depositing. The vault refused it (tecNO_AUTH).` : err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="lg"
        onClick={() => {
          setDone(null);
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
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Invest in {projectName}</DialogTitle>
                <DialogDescription>Deposit RLUSD into the project vault as {investor.name}. You receive vault shares.</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-2">
                <Label htmlFor="amount">Amount (RLUSD)</Label>
                <Input id="amount" inputMode="decimal" autoFocus value={raw} onChange={(e) => setRaw(e.target.value)} className="tabular" aria-invalid={!!invalid && cents > 0} />
                <p className="text-caption text-ink-2">
                  {invalid && cents > 0 ? <span className="text-fail">{invalid}</span> : `${formatBps(rateBps)} a year · ${formatAmount(remaining)} RLUSD left to raise`}
                </p>
                {error && <p className="rounded-control bg-fail-bg px-3 py-2 text-small text-fail">{error}</p>}
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={!!invalid || busy} onClick={deposit}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  Deposit {cents > 0 ? `${formatAmount(cents / 100)} RLUSD` : ""}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
