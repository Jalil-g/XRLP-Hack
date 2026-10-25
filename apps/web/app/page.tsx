import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Progress } from "@/components/ui/progress";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import { PROJECT_STATUS, PROJECT_TYPE } from "@/lib/display";
import { BRAND, formatAmount, formatBps, formatDate, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = (await api.listProjects()).filter((project) => project.verified);

  return (
    <div className="space-y-16">
      <AutoRefresh ms={5000} />

      <header className="max-w-[760px] pt-6">
        <h1 className="text-display">{BRAND.line}</h1>
        <p className="mt-4 text-body text-ink-2">
          Investors fund verified projects. Each milestone&apos;s money waits in its own XRPL escrow and pays the builder only after the
          milestone passes its checks: a licensed inspector&apos;s signed audit, plus automated and AI checks on the evidence.
        </p>
      </header>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-heading">Verified projects</h2>
          <span className="text-caption text-ink-2">{projects.length} listed</span>
        </div>

        {projects.length === 0 ? (
          <p className="rounded-panel bg-band px-6 py-10 text-center text-small text-ink-2">No verified projects yet. Builders appear here once their project passes verification.</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-line bg-band text-caption text-ink-2">
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Builder</th>
                <th className="w-[220px] px-4 py-2.5 font-medium">Raised</th>
                <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const pct = (toCents(p.raised) / Math.max(1, toCents(p.principal))) * 100;
                const status = PROJECT_STATUS[p.status];
                return (
                  <tr key={p.id} className="group relative border-b border-line transition-colors duration-150 hover:bg-band/60">
                    <td className="px-4 py-4">
                      <Link href={`/projects/${p.id}`} className="text-body font-medium text-ink after:absolute after:inset-0 group-hover:text-link">
                        {p.name}
                      </Link>
                      <div className="text-caption text-ink-2">
                        {p.siteAddress.split(",").slice(1, 2).join("").trim() || p.siteAddress} · {PROJECT_TYPE[p.type]}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-small">
                      {p.builderName}
                      {p.builderVerified && <div className="text-caption text-pass">Verified builder</div>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="tabular text-small">
                        {formatAmount(p.raised)} <span className="text-ink-2">of {formatAmount(p.principal)}</span>
                      </div>
                      <Progress value={pct} className="mt-2" label={`${Math.floor(pct)}% raised`} />
                      {p.status === "funding" && <div className="mt-1.5 text-caption text-ink-2">Funding closes {formatDate(p.fundingDeadline)}</div>}
                    </td>
                    <td className="tabular px-4 py-4 text-right text-small">{p.interestRateBps !== undefined ? formatBps(p.interestRateBps) : "—"}</td>
                    <td className="px-4 py-4">
                      <Tag tone={status.tone}>{status.label}</Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
