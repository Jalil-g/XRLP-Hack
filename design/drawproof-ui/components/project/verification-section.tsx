import { StatusTag } from '@/components/status-tag'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { formatRLUSD, getTx } from '@/lib/api'
import { verificationFeeTx, verificationGroups } from '@/lib/mock-data'

export function VerificationSection() {
  const fee = getTx(verificationFeeTx)
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {verificationGroups.map((g) => (
          <section key={g.group} aria-labelledby={`vg-${g.group}`}>
            <h3 id={`vg-${g.group}`} className="border-b-2 border-ink pb-2 text-[15px] font-semibold">
              {g.group}
            </h3>
            <ul className="divide-y divide-hairline">
              {g.checks.map((c) => (
                <li key={c.name} className="flex items-start justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[15px]">{c.name}</span>
                    <span className="text-[13px] text-label">{c.reason}</span>
                  </div>
                  <StatusTag status="Passed" className="bg-ok-bg text-ok" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {fee && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-hairline px-4 py-3">
          <div className="flex flex-col">
            <span className="text-[15px]">Verification fee</span>
            <span className="text-[13px] text-label">
              {fee.fromName} to Drawproof · {fee.time}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="tnum text-[15px]">{formatRLUSD(fee.amount ?? 0)} RLUSD</span>
            <LedgerLink tx={fee} />
          </div>
        </div>
      )}
    </div>
  )
}
