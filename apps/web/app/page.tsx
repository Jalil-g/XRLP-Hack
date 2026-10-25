import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { ProjectHero } from "@/components/project/project-hero";
import { buttonClass } from "@/components/ui/button";
import { Empty } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import { PROJECT_STATUS } from "@/lib/display";
import { cn, formatAmount, formatBps, formatDate, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

const GRID = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_72px_150px]";

export default async function ProjectsPage() {
  const listed = await api.listProjects({ status: "verified" });
  // Open for funding first, then the rest in their given order.
  const projects = [...listed].sort((a, b) => Number(b.status === "funding") - Number(a.status === "funding"));
  const target = projects.reduce((total, project) => total + toCents(project.principal), 0);
  const raised = projects.reduce((total, project) => total + toCents(project.raised), 0);
  const open = projects.filter((project) => project.status === "funding").length;

  return (
    <div className="space-y-12">
      <AutoRefresh ms={5000} />
      <h1 className="sr-only">Projects</h1>

      {projects.length === 0 ? (
        <Empty title="No verified projects" action={<Link href="/demo" className={buttonClass("secondary")}>Open demo</Link>} />
      ) : (
        <>
          <ProjectHero
            money={{ mode: "funding", raisedCents: raised, targetCents: target }}
            facts={[
              { label: "Projects", value: String(projects.length) },
              { label: "Open for funding", value: String(open) },
            ]}
          />

          <section aria-label="Projects">
            <div aria-hidden className={cn(GRID, "hidden border-b border-line px-3 pb-2 text-caption text-ink-2 md:grid")}>
              <span>Project</span>
              <span>Raised</span>
              <span className="text-right">Rate</span>
              <span />
            </div>
            <ul>
              {projects.map((p) => {
                const pct = Math.min(100, (toCents(p.raised) / Math.max(1, toCents(p.principal))) * 100);
                const status = PROJECT_STATUS[p.status];
                const funding = p.status === "funding";
                const place = p.siteAddress.split(",")[1]?.trim() || p.siteAddress;
                return (
                  <li key={p.id} className="border-b border-line">
                    <Link
                      href={`/projects/${p.id}`}
                      className={cn(GRID, "group -mx-3 rounded-[12px] px-3 py-5 transition-colors duration-150 hover:bg-band")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-body font-semibold">{p.name}</span>
                        <span className="block text-small text-ink-2">{place}</span>
                      </span>
                      <span className="text-right md:order-4 md:text-left">
                        {funding ? <Tag tone={status.tone}>{status.label}</Tag> : <span className="text-small text-ink-3">{status.label}</span>}
                        {funding && <span className="mt-1 block text-caption text-ink-2 tabular-nums">Closes {formatDate(p.fundingDeadline)}</span>}
                      </span>
                      <span className="col-span-2 md:order-2 md:col-span-1">
                        <span className="block text-small tabular-nums">
                          <strong className="font-semibold">{formatAmount(p.raised)}</strong>
                          <span className="text-ink-2">{pct < 100 ? ` of ${formatAmount(p.principal)}` : " raised"}</span>
                        </span>
                        {pct < 100 && <span
                          role="progressbar"
                          aria-label={`${Math.floor(pct)}% raised`}
                          aria-valuenow={Math.round(pct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className="mt-2 block h-1.5 overflow-hidden rounded-full bg-band-2"
                        >
                          <span className="block h-full rounded-full bg-accent shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" style={{ width: `${pct}%` }} />
                        </span>}
                      </span>
                      <span className="col-span-2 text-small font-semibold tabular-nums md:order-3 md:col-span-1 md:text-right">
                        <span className="font-normal text-ink-2 md:hidden">Rate </span>
                        {p.interestRateBps !== undefined ? formatBps(p.interestRateBps) : "n/a"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
