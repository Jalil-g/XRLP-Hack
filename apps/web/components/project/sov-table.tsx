// The Schedule of Values (AIA G703 style): every line and which milestone escrow pays for it. Hairline rows only.
import Link from "next/link";
import type { Milestone, SovLine } from "@/lib/contract";
import { cn, formatAmount, fromCents, toCents } from "@/lib/utils";

export function SovTable({ sov, milestones, selectedId }: { sov: SovLine[]; milestones: Milestone[]; selectedId?: string }) {
  const groups = milestones.map((m) => ({ m, lines: sov.filter((l) => (m.sovCodes ?? []).includes(l.code)) }));
  const total = sov.reduce((a, l) => a + toCents(l.amount), 0);
  return (
    <div role="region" aria-label="Schedule of Values" tabIndex={0} className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-caption text-ink-2">
            <th className="w-[88px] py-2.5 pr-4 font-medium">Code</th>
            <th className="py-2.5 pr-4 font-medium">Work</th>
            <th className="py-2.5 pr-4 font-medium">Trade</th>
            <th className="py-2.5 pr-4 text-right font-medium">Amount</th>
            <th className="w-[220px] py-2.5 font-medium">Milestone</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap(({ m, lines }) =>
            lines.map((l, i) => (
              <tr key={l.code} className={cn("border-b border-line text-small", m.id === selectedId ? "text-ink" : "text-ink-2")}>
                <td className="tabular py-2.5 pr-4 text-ink-3">{l.code}</td>
                <td className={cn("py-2.5 pr-4", m.id === selectedId && "font-medium")}>{l.title}</td>
                <td className="py-2.5 pr-4">{l.trade}</td>
                <td className="tabular py-2.5 pr-4 text-right">{formatAmount(l.amount)}</td>
                <td className="py-2.5">
                  {i === 0 && (
                    <Link href={`?m=${encodeURIComponent(m.id)}`} scroll={false} className="font-medium text-ink hover:underline">
                      {m.index + 1}. {m.title}
                    </Link>
                  )}
                </td>
              </tr>
            )),
          )}
        </tbody>
        <tfoot>
          <tr className="text-small">
            <td className="py-2.5 pr-4" />
            <td className="py-2.5 pr-4 font-semibold" colSpan={2}>
              Total
            </td>
            <td className="tabular py-2.5 pr-4 text-right font-semibold">{formatAmount(fromCents(total))}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
