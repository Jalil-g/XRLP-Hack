// On-chain activity: one sentence per transaction, newest first.
import { TxLink } from "@/components/chain";
import type { ChainEvent } from "@/lib/contract";
import { EVENT_TX, describeEvent } from "@/lib/display";
import { formatDateTime } from "@/lib/utils";

export function Activity({
  events,
  who,
  milestoneTitle,
  roleOf,
  builderName,
  limit,
}: {
  events: ChainEvent[];
  who: (address?: string) => string;
  /** Actor's role label (Inspector, AI verifier, Release service, …). */
  roleOf?: (address?: string) => string | undefined;
  /** Recipient named in release lines. */
  builderName?: string;
  milestoneTitle: (id?: string) => string;
  limit?: number;
}) {
  const rows = limit ? events.slice(0, limit) : events;
  if (!rows.length) return <p className="text-small text-ink-2">No transactions yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {rows.map((e, i) => (
        <li key={`${e.txHash}-${i}`} className="py-3 first:pt-0">
          <p className={e.kind === "release_refused" ? "text-small font-medium text-fail" : "text-small text-ink"}>{describeEvent(e, who, milestoneTitle, builderName)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-ink-2">
            {roleOf?.(e.actor) && (
              <>
                <span className="font-medium text-ink">{roleOf(e.actor)}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{EVENT_TX[e.kind]}</span>
            <span aria-hidden>·</span>
            <span>{formatDateTime(e.at)}</span>
            <span aria-hidden>·</span>
            <TxLink hash={e.txHash} />
          </p>
        </li>
      ))}
    </ol>
  );
}
