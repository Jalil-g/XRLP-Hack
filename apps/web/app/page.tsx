import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Progress } from "@/components/ui/progress";
import { Tag } from "@/components/ui/tag";
import { Empty } from "@/components/ui/layout";
import { api } from "@/lib/api";
import { PROJECT_STATUS, PROJECT_TYPE } from "@/lib/display";
import { formatAmount, formatBps, formatDate, fromCents, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await api.listProjects({ status: "verified" });
  const principal = projects.reduce((total, project) => total + toCents(project.principal), 0);
  const raised = projects.reduce((total, project) => total + toCents(project.raised), 0);
  const funding = projects.filter((project) => project.status === "funding");

  return (
    <div className="space-y-8">
      <AutoRefresh ms={5000} />

      <header className="max-w-[760px]">
        <h1 className="text-title">Construction, backed by proof.</h1>
        <p className="mt-2 text-body text-ink-2">
          Explore verified projects. Capital moves milestone by milestone, after a signed inspection and evidence checks.
        </p>
      </header>

      <section className="capital-summary" aria-label="Listed project capital">
        <div>
          <p className="text-small text-capital-muted">Capital across listed projects</p>
          <p className="financial-amount mt-3">{formatAmount(fromCents(principal))} <span>RLUSD</span></p>
          <p className="mt-3 max-w-[48ch] text-small text-capital-muted">Every draw has a destination. Every release needs proof.</p>
        </div>
        <div className="capital-detail">
          <div><span>Raised to date</span><strong>{formatAmount(fromCents(raised))} RLUSD</strong></div>
          <div><span>Verified projects</span><strong>{projects.length}</strong></div>
          <div><span>Open for funding</span><strong>{funding.length}</strong></div>
        </div>
      </section>

      <section className="finance-surface">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-heading">Explore projects</h2>
          <span className="text-caption text-ink-2">{projects.length} verified · RLUSD</span>
        </div>

        {projects.length === 0 ? (
          <Empty title="No verified projects yet" action={<Link href="/demo" className="text-small text-link hover:underline">See how project verification works</Link>}>
            Projects appear here after they pass verification. This list refreshes automatically.
          </Empty>
        ) : (
          <div>
          <table className="responsive-finance-table w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-line bg-band text-caption text-ink-2">
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Builder</th>
                <th className="w-[220px] px-4 py-2.5 font-medium">Raised</th>
                <th className="px-4 py-2.5 text-right font-medium">Annual rate</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const pct = (toCents(p.raised) / Math.max(1, toCents(p.principal))) * 100;
                const status = PROJECT_STATUS[p.status];
                return (
                  <tr key={p.id} className="group border-b border-line transition-colors duration-150 hover:bg-band/40">
                    <td data-label="Project" className="px-4 py-5">
                      <Link href={`/projects/${p.id}`} className="text-body font-semibold text-ink group-hover:text-link hover:underline">
                        {p.name}
                      </Link>
                      <div className="text-caption text-ink-2">
                        {p.siteAddress.split(",").slice(1, 2).join("").trim() || p.siteAddress} · {PROJECT_TYPE[p.type]}
                      </div>
                    </td>
                    <td data-label="Builder" className="px-4 py-5 text-small">
                      {p.builderName}
                      {p.builderVerified && <div className="text-caption text-pass">Verified builder</div>}
                    </td>
                    <td data-label="Raised" className="px-4 py-5">
                      <div className="tabular text-small">
                        {formatAmount(p.raised)} <span className="text-ink-2">of {formatAmount(p.principal)}</span>
                      </div>
                      <Progress value={pct} className="mt-2" label={`${Math.floor(pct)}% raised`} />
                      {p.status === "funding" && <div className="mt-1.5 text-caption text-ink-2">Funding closes {formatDate(p.fundingDeadline)}</div>}
                    </td>
                    <td data-label="Annual rate" className="tabular px-4 py-5 text-right text-body font-semibold">{p.interestRateBps !== undefined ? formatBps(p.interestRateBps) : "Not available"}</td>
                    <td data-label="Status" className="px-4 py-5">
                      <Tag tone={status.tone}>{status.label}</Tag>
                    </td>
                    <td className="px-4 py-5"><Link href={`/projects/${p.id}`} aria-label={`View ${p.name}`} className="inline-flex min-h-11 items-center gap-2 text-small font-medium text-link">View<ArrowUpRight className="size-4" aria-hidden /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>
      <p className="max-w-[78ch] text-small text-ink-2">The ledger fixes where money can go. The platform release service decides when, using the inspector&apos;s signed audit and automated checks. This is a Devnet prototype, not an offer to invest.</p>
    </div>
  );
}
