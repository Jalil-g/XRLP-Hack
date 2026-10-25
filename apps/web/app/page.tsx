import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { ProjectCover } from "@/components/project/project-cover";
import { buttonClass } from "@/components/ui/button";
import { Empty } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import { PROJECT_STATUS, PROJECT_TYPE } from "@/lib/display";
import { fundingCountdown, MARKETPLACE_TYPES, marketplaceProjects, parseProjectType } from "@/lib/marketplace";
import { cn, formatAmount, formatBps, formatDate, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ type?: string | string[] }> };

export default async function ProjectsPage({ searchParams }: Props) {
  const selectedType = parseProjectType((await searchParams).type);
  const projects = marketplaceProjects(await api.listProjects(), selectedType);
  const target = projects.reduce((total, project) => total + toCents(project.principal), 0);
  const raised = projects.reduce((total, project) => total + toCents(project.raised), 0);
  const open = projects.filter((project) => project.status === "funding");
  const closing = open[0];

  return (
    <div className="space-y-7">
      <AutoRefresh ms={5000} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="mb-1 text-small text-ink-2">Construction lending, backed by proof</p><h1 className="text-[30px] leading-10 font-medium tracking-tight">Projects</h1></div>
        <Link href="/portfolio" className="flex items-center gap-2 text-small underline underline-offset-4">Your portfolio <ArrowRight className="size-4" aria-hidden /></Link>
      </header>
      {closing && <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-[#163c35] px-6 py-4 text-white"><p className="text-[17px]">{closing.name} · {fundingCountdown(closing.fundingDeadline)}</p><Link href={`/projects/${closing.id}`} className={cn(buttonClass("secondary"), "border-white bg-white text-[#163c35]")}>View project</Link></div>}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Projects" className="min-w-0 space-y-4">
          <h2 className="text-[23px] font-medium">{selectedType ? PROJECT_TYPE[selectedType] : "Explore projects"}</h2>
          <nav className="flex flex-wrap gap-2" aria-label="Filter projects by type">
            <FilterLink href="/" active={!selectedType}>All</FilterLink>
            {MARKETPLACE_TYPES.map((type) => <FilterLink key={type} href={`/?type=${type}`} active={selectedType === type}>{PROJECT_TYPE[type]}</FilterLink>)}
          </nav>
          {projects.length === 0 ? <Empty title={selectedType ? "No matching verified projects" : "No verified projects"} action={<Link href={selectedType ? "/" : "/demo"} className={buttonClass("secondary")}>{selectedType ? "Clear the type filter" : "Open demo"}</Link>}>Projects appear here after they pass verification. This list refreshes automatically.</Empty> : (
            <ul className="space-y-4">
              {projects.map((project) => {
                const percent = Math.min(100, (toCents(project.raised) / Math.max(1, toCents(project.principal))) * 100);
                const status = PROJECT_STATUS[project.status];
                return <li key={project.id} className="rounded-md border border-line bg-white p-5"><article className="space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <ProjectCover name={project.name} address={project.siteAddress} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-small text-ink-2"><span>{PROJECT_TYPE[project.type]}</span><Tag tone={status.tone}>{status.label}</Tag></div>
                      <h3 className="mt-2 text-[22px] leading-7 font-medium">{project.name}</h3>
                      {project.builderName && <p className="mt-1 text-small text-ink-2">{project.builderName}{project.builderVerified && <span className="text-pass"> · Verified builder</span>}</p>}
                      <dl className="mt-4 divide-y divide-line text-small">{[
                        ["Rate", project.interestRateBps !== undefined ? formatBps(project.interestRateBps) : "Not available"],
                        ["Raised", `${formatAmount(project.raised)} / ${formatAmount(project.principal)} RLUSD`],
                        ["Closes", formatDate(project.fundingDeadline)],
                      ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-2"><dt className="text-ink-2">{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>)}</dl>
                    </div>
                  </div>
                  <div role="progressbar" aria-label={`${Math.floor(percent)}% raised`} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-[#e8ece8]"><div className="h-full rounded-full bg-[#163c35]" style={{ width: `${percent}%` }} /></div>
                  <Link href={`/projects/${project.id}`} className={cn(buttonClass("secondary"), "w-full rounded-md border-[#163c35] text-[#163c35]")}>View project <ArrowRight className="ml-2 size-4" aria-hidden /></Link>
                </article></li>;
              })}
            </ul>
          )}
        </section>
        <aside className="space-y-4">
          <section className="rounded-md border border-line bg-white p-5"><h2 className="text-[20px] font-medium">Marketplace</h2><dl className="mt-4 grid grid-cols-2 gap-4"><div><dt className="text-small text-ink-2">Raised · RLUSD</dt><dd className="mt-1 text-[26px] tabular-nums">{formatAmount(raised / 100)}</dd></div><div className="border-l border-line pl-4"><dt className="text-small text-ink-2">Open projects</dt><dd className="mt-1 text-[26px] tabular-nums">{open.length}</dd></div></dl><p className="mt-4 border-t border-line pt-3 text-small text-ink-2">{formatAmount(target / 100)} RLUSD in listed project principal</p></section>
          <section className="rounded-md border border-line bg-white p-5"><ShieldCheck className="mb-3 size-6 text-[#163c35]" aria-hidden /><h2 className="text-[20px] font-medium">Proof before payout</h2><p className="mt-3 text-small leading-6 text-ink-2">Signed audits and passing checks gate escrow release.</p><Link href="/demo" className="mt-4 inline-flex items-center gap-2 text-small underline underline-offset-4">See the live workflow <ArrowRight className="size-4" aria-hidden /></Link></section>
          <section className="rounded-md border border-line bg-white p-5"><h2 className="text-[20px] font-medium">Building something?</h2><p className="mt-2 text-small leading-6 text-ink-2">Manage your project, evidence and milestone draws in one workspace.</p><Link href="/builder" className={cn(buttonClass(), "mt-4 w-full bg-[#163c35] text-white")}>Builder workspace</Link></section>
        </aside>
      </div>
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={cn("rounded-md border px-3 py-2 text-small transition-colors", active ? "border-[#163c35] bg-[#163c35] text-white" : "border-line bg-white text-ink hover:bg-band")}>{children}</Link>;
}
