import { KeyRound, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** The core trust promise, stated plainly. */
export function EscrowGuarantee({ builderName, className }: { builderName: string; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-ink/10 bg-ink p-5 text-white shadow-card", className)}>
      <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-brand/40 blur-3xl" aria-hidden />
      <div className="relative">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-emerald-300" />
          <h3 className="text-[15px] font-semibold tracking-tight">Not even the platform can redirect escrowed funds.</h3>
        </div>
        <ul className="mt-4 space-y-3 text-[13px] leading-snug text-white/75">
          <li className="flex gap-2.5">
            <Lock className="mt-0.5 size-4 shrink-0 text-white/50" />
            <span>
              Each milestone sits in its own XRPL escrow payable <span className="text-white">only to {builderName}</span> — or back to
              the project account.
            </span>
          </li>
          <li className="flex gap-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-white/50" />
            <span>
              The release key is held by the <span className="text-white">assigned inspector</span>, never the platform. Release also
              needs a second signer: the AI verifier, platform, or another inspector.
            </span>
          </li>
          <li className="flex gap-2.5">
            <RotateCcw className="mt-0.5 size-4 shrink-0 text-white/50" />
            <span>If a stage stalls, the escrow expires and funds go back to the project account, then are repaid to the vault.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
