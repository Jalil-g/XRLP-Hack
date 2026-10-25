import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { CapitalBar } from "@/components/ui/capital-bar";
import { Empty, PageHeader } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
import { VAULT_PHASE } from "@/lib/display";
import { getSession } from "@/lib/session";
import { formatAmount, formatDate, fromCents, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const session = await getSession();
  const investor = session.investor;
  if (!investor && session.directoryUnavailable) throw new ApiError("unreachable", "The account directory could not be loaded", 503);
  if (!investor) return (
    <Empty title="No investor accounts" action={<Link href="/" className="text-small text-link hover:underline">Browse verified projects</Link>}>
      No investor accounts are configured. Ask the operator to set up an account before investing.
    </Empty>
  );
  const positions = await api.portfolio(investor.address);
  const total = positions.reduce((a, p) => a + toCents(p.value), 0);
  const nextOpen = positions.filter((p) => p.phase !== "redemption").map((p) => p.redemptionDate).sort()[0];
  const open = positions.filter((p) => p.phase === "redemption").reduce((a, p) => a + toCents(p.value), 0);

  return (
    <div className="space-y-12">
      <AutoRefresh ms={4000} />
      <PageHeader
        title="Portfolio"
        meta={investor.kyc ? <Tag tone="pass">KYC verified</Tag> : <Tag tone="review">No KYC credential</Tag>}
        description={`${investor.name}. Value is your vault shares at today's share price.`}
        action={
          !investor.kyc ? (
            <ActionButton action={{ kind: "kyc", investor: investor.address }}>Issue KYC credential</ActionButton>
          ) : undefined
        }
      />

      {positions.length > 0 && <section className="capital-summary" aria-label="Portfolio value">
        <div>
          <p className="text-small text-capital-muted">Current vault share value</p>
          <p className="financial-amount mt-3">{formatAmount(fromCents(total), { cents: true })} <span>RLUSD</span></p>
          <p className="mt-2 text-small text-capital-muted">{positions.length} project {positions.length === 1 ? "position" : "positions"} · share value rises as interest is repaid</p>
          <CapitalBar
            className="mt-6"
            label="Holdings by withdrawal status"
            segments={[
              { label: "Withdrawals open", cents: open, tone: "accent" },
              { label: "Locked until redemption date", cents: total - open, tone: "muted" },
            ]}
          />
        </div>
        <div className="capital-detail">
          <div><span>Positions</span><strong>{positions.length}</strong></div>
          <div><span>Next withdrawal opens</span><strong>{nextOpen ? formatDate(nextOpen) : "Not scheduled"}</strong></div>
        </div>
      </section>}

      {positions.length === 0 ? (
        <Empty title="No positions yet">
          Pick a verified project on the <Link href="/" className="text-link hover:underline">Projects</Link> page and invest.
        </Empty>
      ) : (
        <section className="finance-surface">
        <h2 className="mb-5 text-heading">Your holdings</h2>
        <table className="responsive-finance-table w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-line bg-band text-caption text-ink-2">
              <th className="px-4 py-2.5 font-medium">Project</th>
              <th className="px-4 py-2.5 text-right font-medium">Shares</th>
              <th className="px-4 py-2.5 text-right font-medium">Value (RLUSD)</th>
              <th className="px-4 py-2.5 font-medium">Vault</th>
              <th className="px-4 py-2.5 text-right font-medium">Withdraw</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => (
              <tr key={pos.projectId} className="border-b border-line">
                <td data-label="Project" className="px-4 py-5">
                  <Link href={`/projects/${pos.projectId}`} className="text-body font-medium text-ink hover:text-link">
                    {pos.projectName}
                  </Link>
                </td>
                <td data-label="Shares" className="tabular px-4 py-5 text-right text-small">{Number(pos.shares).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td data-label="Value · RLUSD" className="tabular px-4 py-5 text-right text-body font-semibold">{formatAmount(pos.value, { cents: true })}</td>
                <td data-label="Vault" className="px-4 py-5">
                  <Tag tone={pos.phase === "redemption" ? "pass" : pos.phase === "subscription" ? "info" : "neutral"}>{VAULT_PHASE[pos.phase]}</Tag>
                </td>
                <td data-label="Withdrawals" className="px-4 py-5 text-right">
                  {pos.phase === "redemption" ? (
                    <ActionButton size="sm" variant="secondary" context={pos.projectName} action={{ kind: "withdraw", projectId: pos.projectId, investor: investor.address, amount: pos.value }}>
                      Withdraw {formatAmount(pos.value)}
                    </ActionButton>
                  ) : (
                    <span className="text-caption text-ink-2">From {formatDate(pos.redemptionDate)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </section>
      )}
    </div>
  );
}
