import { ChevronDown } from 'lucide-react'
import { CopyButton } from '@/components/xrpl/copy-button'
import type { Project } from '@/lib/mock-data'

export function LedgerDetails({ project }: { project: Project }) {
  const rows: [string, string][] = [
    ['Project account', project.projectAccount],
    ['Vault', project.vaultId],
    ...(project.loanId ? [['Loan', project.loanId] as [string, string]] : []),
    ...project.signers.map((s) => [`Signer · ${s.role}`, s.address] as [string, string]),
  ]
  return (
    <details className="group rounded-md border border-hairline">
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] [&::-webkit-details-marker]:hidden">
        <span>Raw IDs · 3-of-4 multisig</span>
        <ChevronDown className="size-4 group-open:rotate-180" aria-hidden />
      </summary>
      <dl className="divide-y divide-hairline border-t border-hairline px-4">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt className="t-label shrink-0">{k}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <code className="truncate font-mono text-[13px]">{v}</code>
              <CopyButton value={v} label={`Copy ${k}`} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
