// Small on-chain display atoms: tx links, addresses, party chips.
import { ArrowUpRight, Bot, Building2, HardHat, Landmark, ShieldCheck, User, Vault } from "lucide-react";
import { explorerTxUrl } from "@xrlp/shared";
import type { Party } from "@/lib/types";
import { cn, explorerAccountUrl, shortAddress, shortHash } from "@/lib/utils";

export function TxLink({ hash, className, label }: { hash: string; className?: string; label?: string }) {
  return (
    <a
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      title={`View ${hash} on the XRPL devnet explorer`}
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-[12px] text-brand underline-offset-2 hover:text-brand-600 hover:underline",
        className,
      )}
    >
      {label ?? shortHash(hash)}
      <ArrowUpRight className="size-3" />
    </a>
  );
}

export function AddressLink({ address, className }: { address: string; className?: string }) {
  return (
    <a
      href={explorerAccountUrl(address)}
      target="_blank"
      rel="noreferrer"
      title={address}
      className={cn("font-mono text-[12px] text-muted hover:text-brand hover:underline", className)}
    >
      {shortAddress(address)}
    </a>
  );
}

const ROLE_ICON = {
  investor: User,
  inspector: HardHat,
  ai_agent: Bot,
  platform: Landmark,
  builder: Building2,
  spv: Vault,
} as const;

const ROLE_TINT = {
  investor: "bg-sky-50 text-sky-700",
  inspector: "bg-amber-50 text-amber-700",
  ai_agent: "bg-violet-50 text-violet-700",
  platform: "bg-slate-100 text-slate-700",
  builder: "bg-emerald-50 text-emerald-700",
  spv: "bg-indigo-50 text-indigo-700",
} as const;

export function PartyAvatar({ role, className }: { role: Party["role"]; className?: string }) {
  const Icon = ROLE_ICON[role];
  return (
    <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", ROLE_TINT[role], className)}>
      <Icon className="size-4" />
    </span>
  );
}

export function VerifiedBuilderBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok ring-1 ring-ok-line ring-inset",
        className,
      )}
      title="VERIFIED_BUILDER credential issued on-chain"
    >
      <ShieldCheck className="size-3.5" />
      Verified builder
    </span>
  );
}
