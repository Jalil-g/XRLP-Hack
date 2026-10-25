import Link from "next/link";
import { ArrowUpRight, Search, ShieldCheck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { ProjectArt } from "@/components/project/project-art";
import { Progress } from "@/components/ui/progress";
import { Tag } from "@/components/ui/tag";
import { Empty } from "@/components/ui/layout";
import { api } from "@/lib/api";
import { PROJECT_STATUS, PROJECT_TYPE } from "@/lib/display";
import { fundingCountdown, MARKETPLACE_TYPES, marketplaceProjects, parseProjectType } from "@/lib/marketplace";
import { formatAmount, formatBps, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ type?: string | string[]; q?: string | string[]; funding?: string }> };

export default async function ProjectsPage({ searchParams }: Props) {
  const params = await searchParams;
  const selectedType = parseProjectType(params.type);
  const query = (typeof params.q === "string" ? params.q : "").trim();
  const all = marketplaceProjects(await api.listProjects());
  const projects = marketplaceProjects(all, selectedType)
    .filter((p) => (!query || `${p.name} ${p.siteAddress} ${p.builderName}`.toLowerCase().includes(query.toLowerCase())) && (params.funding !== "open" || p.status === "funding"))
    .sort((a, b) => Number(b.status === "funding") - Number(a.status === "funding"));
  const open = all.filter((p) => p.status === "funding");
  const capital = all.reduce((sum, p) => sum + toCents(p.raised), 0);
  const filterHref = (type?: string, funding = params.funding) => {
    const next = new URLSearchParams();
    if (type) next.set("type", type);
    if (query) next.set("q", query);
    if (funding === "open") next.set("funding", "open");
    return `/?${next.toString()}`;
  };

  return <div className="space-y-7">
    <AutoRefresh ms={5000} />
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="workspace-eyebrow mb-2">Find your next investment</p><h1 className="workspace-title">Projects</h1><p className="mt-2 text-small text-ink-2">Real projects. Clear milestones. Capital with a purpose.</p></div>
      <Link href="/portfolio" className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-2 bg-page px-4 text-small font-medium">My portfolio <ArrowUpRight className="size-4" aria-hidden="true" /></Link>
    </header>
    <dl className="summary-strip">
      <div><dt>Verified projects</dt><dd>{all.length}<small>in the marketplace</small></dd></div>
      <div><dt>Capital committed</dt><dd>{formatAmount(capital / 100)}<small>RLUSD</small></dd></div>
      <div><dt>Open for investment</dt><dd>{open.length}<small>{open.length === 1 ? "project raising now" : "projects raising now"}</small></dd></div>
    </dl>
    <section aria-label="Browse projects" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav className="flex flex-wrap gap-1" aria-label="Filter projects by type">
          <FilterLink href={filterHref()} active={!selectedType}>All projects</FilterLink>
          {MARKETPLACE_TYPES.map((type) => <FilterLink key={type} href={filterHref(type)} active={selectedType === type}>{PROJECT_TYPE[type]}</FilterLink>)}
        </nav>
        <form className="project-search" role="search">
          {selectedType && <input type="hidden" name="type" value={selectedType} />}
          {params.funding === "open" && <input type="hidden" name="funding" value="open" />}
          <label htmlFor="project-search" className="sr-only">Search projects</label>
          <input id="project-search" name="q" defaultValue={query} placeholder="Search projects…" />
          <button aria-label="Search" type="submit"><Search className="size-4" aria-hidden="true" /></button>
        </form>
      </div>
      <div className="flex items-center justify-between text-caption text-ink-2"><span>{projects.length} project{projects.length === 1 ? "" : "s"}{query && ` matching “${query}”`}</span><Link href={filterHref(selectedType, params.funding === "open" ? "all" : "open")} aria-current={params.funding === "open" ? "page" : undefined} className="min-h-8 content-center font-medium text-link">{params.funding === "open" ? "Show all stages" : "Open for investment only"}</Link></div>
      {projects.length === 0 ? <Empty title="No matching projects" action={<Link href="/" className="text-link">Clear filters</Link>}>Try another name or project type.</Empty> : <div className="project-grid">
        {projects.map((p) => {
          const pct = Math.min(100, (toCents(p.raised) / Math.max(1, toCents(p.principal))) * 100);
          const status = PROJECT_STATUS[p.status];
          return <article key={p.id} className="project-card">
            <Link href={`/projects/${p.id}`} className="project-art-link" aria-label={`View ${p.name}`}><ProjectArt id={p.id} /><span className="project-card-status"><Tag tone={status.tone}>{status.label}</Tag></span><span className="project-card-arrow"><ArrowUpRight className="size-5" aria-hidden="true" /></span></Link>
            <div className="p-5">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-2"><span>{PROJECT_TYPE[p.type]}</span><span aria-hidden="true">·</span><span>{p.siteAddress.split(",").slice(1, 2).join("").trim() || p.siteAddress}</span></div>
              <h2 className="text-heading"><Link href={`/projects/${p.id}`} className="hover:text-link">{p.name}</Link></h2>
              <div className="mt-1.5 flex items-center gap-1.5 text-caption text-ink-2">{p.builderVerified && <ShieldCheck className="size-3.5 text-pass" aria-label="Verified builder" />}{p.builderName}</div>
              <dl className="mt-5 grid grid-cols-2 border-y border-line py-4"><div><dt className="text-caption text-ink-2">Annual rate</dt><dd className="mt-1 text-[23px] font-medium tracking-tight">{p.interestRateBps !== undefined ? formatBps(p.interestRateBps) : "—"}</dd></div><div className="border-l border-line pl-5"><dt className="text-caption text-ink-2">Project size</dt><dd className="mt-1 text-[23px] font-medium tracking-tight">{formatAmount(p.principal)}<span className="ml-1 text-[10px] font-normal text-ink-2">RLUSD</span></dd></div></dl>
              <div className="mt-4 flex justify-between text-caption"><span className="tabular">{formatAmount(p.raised)} <span className="text-ink-2">raised</span></span><span className="text-ink-2">{Math.floor(pct)}%</span></div>
              <Progress value={pct} className="mt-2" label={`${Math.floor(pct)}% raised`} />
              <div className="mt-4 flex items-center justify-between gap-2 text-caption"><span className="text-ink-2">{p.status === "funding" ? fundingCountdown(p.fundingDeadline) : "Milestone-based funding"}</span><Link href={`/projects/${p.id}/verification`} className="inline-flex min-h-8 items-center gap-1 text-link">View verification <ArrowUpRight className="size-3" aria-hidden="true" /></Link></div>
            </div>
          </article>;
        })}
      </div>}
    </section>
  </div>;
}
function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-control px-3 text-caption transition-colors ${active ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-band-2"}`}>{children}</Link>;
}
