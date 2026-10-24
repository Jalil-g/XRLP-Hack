"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CheckCircle2, Coins, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { explorerTxUrl } from "@xrlp/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/form";
import { client } from "@/lib/client";
import type { InvestResult, Party } from "@/lib/types";
import { cn, formatAmount, formatBps, fromCents, shortHash, toCents } from "@/lib/utils";

type Step = "amount" | "review" | "submitting" | "done";

export function InvestDialog({
  projectId,
  projectName,
  sharePrice,
  remaining,
  rateBps,
  investor,
  defaultOpen,
  label = "Invest",
  size = "lg",
  className,
}: {
  projectId: string;
  projectName: string;
  sharePrice: string;
  /** RLUSD left to raise. */
  remaining: string;
  rateBps: number;
  investor: Party;
  defaultOpen?: boolean;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!defaultOpen);
  const [step, setStep] = useState<Step>("amount");
  const [raw, setRaw] = useState("10000");
  const [result, setResult] = useState<InvestResult | null>(null);

  const cents = toCents(raw.replace(/[^\d.]/g, "") || "0");
  const maxCents = toCents(remaining);
  const price = Number(sharePrice) || 1;
  const shares = cents / 100 / price;
  const invalid = cents <= 0 ? "Enter an amount" : cents > maxCents ? `Only ${formatAmount(remaining)} RLUSD left to raise` : null;
  const annual = (cents / 100) * (rateBps / 10_000);

  const reset = () => {
    setStep("amount");
    setResult(null);
  };

  const confirm = async () => {
    setStep("submitting");
    try {
      const res = await client.invest(projectId, investor.address, fromCents(cents));
      setResult(res);
      setStep("done");
      toast.success(`Deposited ${formatAmount(res.investment.amount)} RLUSD into ${projectName}`, {
        description: `VaultDeposit ${shortHash(res.event.txHash)}`,
        action: { label: "View tx", onClick: () => window.open(explorerTxUrl(res.event.txHash), "_blank") },
      });
      router.refresh();
    } catch (err) {
      setStep("review");
      toast.error(err instanceof Error ? err.message : "Deposit failed");
    }
  };

  return (
    <>
      <Button
        variant="brand"
        size={size}
        className={className}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Coins /> {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => (step === "submitting" ? null : setOpen(o))}>
        <DialogContent>
          {step === "done" && result ? (
            <>
              <DialogBody className="pt-8 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-ok-bg text-ok">
                  <CheckCircle2 className="size-6" />
                </div>
                <DialogTitle className="mt-4">Deposit confirmed</DialogTitle>
                <DialogDescription>
                  {formatAmount(result.investment.amount)} RLUSD is in the {projectName} vault. You hold{" "}
                  <span className="font-medium text-ink">{Number(result.sharesIssued).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> vault
                  shares.
                </DialogDescription>
                <a
                  href={explorerTxUrl(result.event.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1 font-mono text-[13px] text-brand hover:underline"
                >
                  {shortHash(result.event.txHash)} <ArrowRight className="size-3.5" />
                </a>
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
                <DialogDescription>Deposit RLUSD into the project vault and receive vault share tokens.</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                {step === "amount" ? (
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount</Label>
                    <div className="relative">
                      <Input
                        id="amount"
                        inputMode="decimal"
                        autoFocus
                        value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                        className="tabular h-12 pr-20 text-lg font-medium"
                      />
                      <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm font-medium text-muted">RLUSD</span>
                    </div>
                    <div className="flex gap-1.5">
                      {[5_000, 10_000, 25_000].map((v) => (
                        <button
                          key={v}
                          onClick={() => setRaw(String(v))}
                          className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:bg-subtle"
                        >
                          {formatAmount(v)}
                        </button>
                      ))}
                      <button
                        onClick={() => setRaw(remaining)}
                        className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:bg-subtle"
                      >
                        Max
                      </button>
                    </div>
                    {invalid && cents > 0 && <p className="text-xs text-bad">{invalid}</p>}
                  </div>
                ) : (
                  <div className="rounded-lg border border-line bg-subtle/50 px-4 py-3">
                    <div className="text-xs text-muted">You deposit</div>
                    <div className="tabular text-2xl font-semibold">{formatAmount(cents / 100, { cents: true })} RLUSD</div>
                  </div>
                )}

                <dl className="divide-y divide-line rounded-lg border border-line text-[13px]">
                  <Row label="Vault shares you receive" value={shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} strong icon={<Coins className="size-3.5" />} />
                  <Row label="Share price" value={`${sharePrice} RLUSD`} mono />
                  <Row label="Target yield" value={`${formatBps(rateBps)} APR · ~${formatAmount(annual)} RLUSD / yr`} />
                  <Row label="From" value={investor.name} />
                </dl>

                <p className="flex gap-2 text-xs text-muted">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
                  Funds stay in the vault until the loan closes, then move only into milestone escrows released on verified proof.
                </p>
              </DialogBody>
              <DialogFooter>
                {step === "amount" ? (
                  <>
                    <Button variant="ghost" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button disabled={!!invalid} onClick={() => setStep("review")}>
                      Review deposit <ArrowRight />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" disabled={step === "submitting"} onClick={() => setStep("amount")}>
                      Back
                    </Button>
                    <Button variant="brand" disabled={step === "submitting"} onClick={confirm}>
                      {step === "submitting" ? (
                        <>
                          <Loader2 className="animate-spin" /> Submitting VaultDeposit…
                        </>
                      ) : (
                        "Confirm deposit"
                      )}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value, strong, mono, icon }: { label: string; value: string; strong?: boolean; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-muted">
        {icon}
        {label}
      </dt>
      <dd className={cn("tabular text-right text-ink-2", strong && "text-[15px] font-semibold text-ink", mono && "font-mono text-[12px]")}>{value}</dd>
    </div>
  );
}
