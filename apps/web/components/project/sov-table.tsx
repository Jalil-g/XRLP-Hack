// The Schedule of Values (AIA G703 style): every line, which milestone escrow pays for it, and that escrow's state.
import Link from "next/link";
import { Tag } from "@/components/ui/tag";
import type { Milestone, SovLine } from "@/lib/contract";
import { MILESTONE_STATUS } from "@/lib/display";
import { cn, formatAmount, fromCents, toCents } from "@/lib/utils";

export function SovTable({ sov, milestones, selectedId }: { sov: SovLine[]; milestones: Milestone[]; selectedId?: string }) {
  const groups = milestones.map((m) => ({ m, lines: sov.filter((l) => (m.sovCodes ?? []).includes(l.code)) }));
  const total = sov.reduce((a, l) => a + toCents(l.amount), 0);
  return (
    <div>
      <p className="mb-2 text-caption text-ink-2 lg:hidden">Scroll horizontally to see all schedule details.</p>
      <div role="region" aria-label="Schedule of Values" tabIndex={0} className="overflow-x-auto">
    <table className="w-full min-w-[760px] border-collapse text-left">
      <thead>
        <tr className="border-y border-line bg-band text-caption text-ink-2">
          <th className="w-[96px] px-4 py-2.5 font-medium">Code</th>
          <th className="px-4 py-2.5 font-medium">Work</th>
          <th className="px-4 py-2.5 font-medium">Trade</th>
          <th className="px-4 py-2.5 text-right font-medium">Amount (RLUSD)</th>
          <th className="w-[330px] px-4 py-2.5 font-medium">Paid from escrow</th>
        </tr>
      </thead>
      <tbody>
        {groups.flatMap(({ m, lines }) =>
          lines.map((l, i) => (
            <tr key={l.code} className={cn("border-b border-line text-small", m.id === selectedId && "bg-band/60", i === lines.length - 1 && "border-b-line-2")}>
              <td className="tabular px-4 py-2.5 text-ink-2">{l.code}</td>
              <td className="px-4 py-2.5">{l.title}</td>
              <td className="px-4 py-2.5 text-ink-2">{l.trade}</td>
              <td className="tabular px-4 py-2.5 text-right">{formatAmount(l.amount)}</td>
              <td className="px-4 py-2.5">
                {i === 0 && (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Link href={`?m=${encodeURIComponent(m.id)}`} scroll={false} className="font-medium text-ink hover:text-link">
                      {m.index + 1}. {m.title}
                    </Link>
                    <Tag tone={MILESTONE_STATUS[m.status].tone}>{MILESTONE_STATUS[m.status].label}</Tag>
                  </span>
                )}
              </td>
            </tr>
          )),
        )}
      </tbody>
      <tfoot>
        <tr className="text-small">
          <td className="px-4 py-2.5" />
          <td className="px-4 py-2.5 font-medium" colSpan={2}>
            Total, {sov.length} lines
          </td>
          <td className="tabular px-4 py-2.5 text-right font-medium">{formatAmount(fromCents(total))}</td>
          <td />
        </tr>
      </tfoot>
    </table>
      </div>
    </div>
  );
}
