import {
  ArrowDownToLine,
  BadgeCheck,
  Banknote,
  FileSignature,
  HandCoins,
  Landmark,
  Lock,
  RotateCcw,
  ShieldCheck,
  Unlock,
  Vault,
  type LucideIcon,
} from "lucide-react";
import type { ChainEvent } from "@xrlp/shared";
import { TxLink } from "@/components/chain";
import { EVENT_LABEL, EVENT_TX, describeEvent } from "@/lib/display";
import type { Party } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const META: Record<ChainEvent["kind"], { icon: LucideIcon; className: string }> = {
  credential_issued: { icon: BadgeCheck, className: "bg-ok-bg text-ok" },
  vault_created: { icon: Vault, className: "bg-subtle text-ink-2" },
  vault_deposit: { icon: ArrowDownToLine, className: "bg-sky-50 text-sky-700" },
  loan_broker_created: { icon: Landmark, className: "bg-subtle text-ink-2" },
  loan_set: { icon: HandCoins, className: "bg-brand-50 text-brand" },
  escrow_created: { icon: Lock, className: "bg-lock-bg text-lock" },
  approval_attested: { icon: FileSignature, className: "bg-amber-50 text-amber-700" },
  escrow_finished: { icon: Unlock, className: "bg-ok-bg text-ok" },
  escrow_cancelled: { icon: RotateCcw, className: "bg-warn-bg text-warn" },
  loan_payment: { icon: Banknote, className: "bg-emerald-50 text-emerald-700" },
  vault_withdraw: { icon: ShieldCheck, className: "bg-subtle text-ink-2" },
  // v2
  verification_fee_paid: { icon: Banknote, className: "bg-subtle text-ink-2" },
  project_verified: { icon: BadgeCheck, className: "bg-ok-bg text-ok" },
  inspector_assigned: { icon: FileSignature, className: "bg-subtle text-ink-2" },
  audit_attested: { icon: FileSignature, className: "bg-amber-50 text-amber-700" },
  verdict_attested: { icon: FileSignature, className: "bg-amber-50 text-amber-700" },
  decision_attested: { icon: FileSignature, className: "bg-amber-50 text-amber-700" },
  cover_deposited: { icon: ShieldCheck, className: "bg-subtle text-ink-2" },
  credential_accepted: { icon: BadgeCheck, className: "bg-ok-bg text-ok" },
  loan_default: { icon: RotateCcw, className: "bg-bad-bg text-bad" },
  release_refused: { icon: Lock, className: "bg-bad-bg text-bad" },
};

export function ChainTimeline({
  events,
  directory,
  milestoneTitles,
  showProject,
  limit,
}: {
  events: ChainEvent[];
  directory: Record<string, Party>;
  milestoneTitles: Record<string, string>;
  /** Prefix each row with the project name (portfolio feed). */
  showProject?: Record<string, string>;
  limit?: number;
}) {
  const rows = limit ? events.slice(0, limit) : events;
  if (!rows.length) return <p className="px-1 py-6 text-center text-sm text-muted">No on-chain activity yet.</p>;
  return (
    <ol className="relative">
      {rows.map((e, i) => {
        const { icon: Icon, className } = META[e.kind];
        return (
          <li key={`${e.txHash}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            {i < rows.length - 1 && <span className="absolute top-8 bottom-0 left-[15px] w-px bg-line" aria-hidden />}
            <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface", className)}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13px] font-semibold text-ink">{EVENT_LABEL[e.kind]}</span>
                <span className="font-mono text-[10.5px] text-faint">{EVENT_TX[e.kind]}</span>
              </div>
              <p className="text-[13px] leading-snug text-ink-2">
                {showProject && <span className="font-medium">{showProject[e.projectId]} · </span>}
                {describeEvent(e, directory, (id) => milestoneTitles[id])}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
                <span>{formatDateTime(e.at)}</span>
                <span>·</span>
                <TxLink hash={e.txHash} className="text-[11.5px]" />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
