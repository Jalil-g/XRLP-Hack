import { Card, CardContent, SectionLabel } from "@/components/ui/card";
import { Progress, StackedBar } from "@/components/ui/progress";
import type { ProjectDetail } from "@/lib/types";
import { cn, formatAmount, formatDate, toCents } from "@/lib/utils";

/** Funding progress + "where is the money right now" breakdown. */
export function FundingCard({ detail }: { detail: ProjectDetail }) {
  const { funding, funds, vault } = detail;
  const target = toCents(funds.target);
  const atBuilder = Math.max(0, toCents(funds.released) - toCents(funds.repaid));
  const segments = [
    { label: "In vault, awaiting close", value: toCents(funds.awaitingClose), className: "bg-sky-400", dot: "bg-sky-400" },
    { label: "Locked in escrow", value: toCents(funds.escrowed), className: "bg-lock", dot: "bg-lock" },
    { label: "Released to builder", value: atBuilder, className: "bg-ok", dot: "bg-ok" },
    { label: "Repaid / refunded to vault", value: toCents(funds.repaid) + toCents(funds.refunded), className: "bg-emerald-300", dot: "bg-emerald-300" },
  ];
  const funded = funding.pct >= 100;

  return (
    <Card>
      <CardContent className="grid gap-6 py-5 md:grid-cols-2">
        <div>
          <SectionLabel>Funding</SectionLabel>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular text-3xl font-semibold tracking-tight">{formatAmount(funding.raised)}</span>
            <span className="text-sm text-muted">of {formatAmount(funding.target)} RLUSD</span>
          </div>
          <Progress value={funding.pct} className="mt-3 h-2.5" barClassName={funded ? "bg-ok" : undefined} />
          <div className="mt-2.5 flex justify-between text-[13px] text-muted">
            <span>
              <span className="font-medium text-ink-2">{Math.floor(funding.pct)}%</span> funded · {funding.investorCount} investor
              {funding.investorCount === 1 ? "" : "s"}
            </span>
            <span>{funded ? "Fully funded" : `Closes ${formatDate(funding.deadline)}`}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[13px]">
            <div>
              <div className="text-muted">Vault share price</div>
              <div className="tabular font-mono text-[15px] font-medium text-ink">{vault.sharePrice}</div>
            </div>
            <div>
              <div className="text-muted">Interest paid to vault</div>
              <div className="tabular text-[15px] font-medium text-ink">{formatAmount(funds.interestPaid, { cents: true })} RLUSD</div>
            </div>
          </div>
        </div>

        <div className="md:border-l md:border-line md:pl-6">
          <SectionLabel>Where the money is right now</SectionLabel>
          <StackedBar className="mt-4 h-3" total={Math.max(target, toCents(funds.raised))} segments={segments} />
          <ul className="mt-4 space-y-2">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2 text-ink-2">
                  <span className={cn("size-2.5 rounded-sm", s.dot)} />
                  {s.label}
                </span>
                <span className={cn("tabular font-medium", s.value ? "text-ink" : "text-faint")}>{formatAmount(s.value / 100)} RLUSD</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
