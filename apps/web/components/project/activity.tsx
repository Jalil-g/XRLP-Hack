// On-chain activity: one sentence per transaction, newest first. Date and tx sit quietly on the right.
import { TxLink } from "@/components/chain";
import type { ChainEvent } from "@/lib/contract";
import { describeEvent } from "@/lib/display";
import { formatDateTime } from "@/lib/utils";

export function Activity({
  events,
  who,
  milestoneTitle,
  builderName,
  limit,
}: {
  events: ChainEvent[];
  who: (address?: string) => string;
  /** Actor's role label. Accepted for compatibility; the sentence already names the actor. */
  roleOf?: (address?: string) => string | undefined;
  /** Recipient named in release lines. */
  builderName?: string;
  milestoneTitle: (id?: string) => string;
  limit?: number;
}) {
  const rows = limit ? events.slice(0, limit) : events;
  if (!rows.length) return <p className="text-small text-ink-2">No transactions yet.</p>;
  return (
    <ol className="border-t border-line">
      {rows.map((e, i) => (
        <li key={`${e.txHash}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-line py-3">
          <p className={e.kind === "release_refused" ? "min-w-0 text-small font-medium text-fail" : "min-w-0 text-small text-ink"}>{describeEvent(e, who, milestoneTitle, builderName)}</p>
          <p className="flex shrink-0 items-baseline gap-4 text-caption text-ink-3 tabular-nums">
            <span>{formatDateTime(e.at)}</span>
            <TxLink hash={e.txHash} className="text-ink-3" />
          </p>
        </li>
      ))}
    </ol>
  );
}
