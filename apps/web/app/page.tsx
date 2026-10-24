import { BadgeCheck, Lock, ScanSearch, ShieldCheck, Unlock, Wallet } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { ProjectCard } from "@/components/project-card";
import { StatTile } from "@/components/stat-tile";
import { getMarketplace } from "@/lib/api";
import { BRAND, formatAmount } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const { stats, projects } = await getMarketplace();

  return (
    <div className="space-y-10">
      <AutoRefresh ms={5000} />

      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 pt-12 pb-8 shadow-card sm:px-10">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" aria-hidden />
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium text-brand">
            <ShieldCheck className="size-3.5" />
            Milestone-verified construction lending on the XRP Ledger
          </span>
          <h1 className="mt-5 text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">{BRAND.tagline}</h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-2">
            Pool RLUSD into a project vault. Each construction stage is locked in its own on-chain escrow and released only after an AI
            evidence check and a licensed inspector&apos;s signed approval.
          </p>
          <ol className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
            {[
              { icon: Wallet, text: "Investors fund a vault" },
              { icon: Lock, text: "Each stage locked in escrow" },
              { icon: ScanSearch, text: "AI checks the evidence" },
              { icon: BadgeCheck, text: "Inspector signs" },
              { icon: Unlock, text: "Money moves" },
            ].map(({ icon: Icon, text }, i) => (
              <li key={text} className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-subtle text-[11px] font-semibold text-muted">{i + 1}</span>
                <Icon className="size-4 text-faint" />
                {text}
              </li>
            ))}
          </ol>
        </div>

        <div className="relative mt-10 grid gap-4 sm:grid-cols-3">
          <StatTile label="Committed by investors" value={formatAmount(stats.totalCommitted)} unit="RLUSD" icon={Wallet} hint={`${stats.activeProjects} active projects`} />
          <StatTile label="Locked in milestone escrows" value={formatAmount(stats.lockedInEscrow)} unit="RLUSD" icon={Lock} hint="Payable only to the builder — or back" />
          <StatTile
            label="Released on verified proof"
            value={formatAmount(stats.releasedOnProof)}
            unit="RLUSD"
            icon={BadgeCheck}
            hint={`${stats.milestonesVerified} milestones verified & signed`}
          />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Projects</h2>
            <p className="text-[13px] text-muted">{stats.verifiedBuilders} builders verified with an on-chain VERIFIED_BUILDER credential.</p>
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.project.id} summary={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
