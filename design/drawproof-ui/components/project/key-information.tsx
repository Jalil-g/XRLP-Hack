import { LedgerLink, ObjectLink, type LedgerObject } from '@/components/xrpl/ledger-drawer'
import { formatWhole, getLedger, shortAddress, shortHash } from '@/lib/api'
import { network, type Project } from '@/lib/mock-data'

function Table({ rows, label }: { rows: [string, React.ReactNode][]; label: string }) {
  return (
    <dl aria-label={label} className="divide-y divide-hairline rounded-md border border-hairline px-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-h-11 items-center justify-between gap-4 py-2.5">
          <dt className="t-label shrink-0">{k}</dt>
          <dd className="flex min-w-0 items-center justify-end gap-3 text-right text-[15px]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ObjectCell({ id, obj }: { id: string; obj: LedgerObject }) {
  return (
    <>
      <code className="truncate font-mono text-[13px]">{id}</code>
      <ObjectLink obj={obj} />
    </>
  )
}

export function KeyInformation({ project }: { project: Project }) {
  const txs = getLedger({ projectSlug: project.slug })
  const loanTx = txs.find((t) => t.action === 'LoanSet')
  const escrows = project.milestones.filter((m) => m.escrowSequence)
  const funding = project.status === 'Funding'

  const left: [string, React.ReactNode][] = [
    ['Builder', project.builder],
    ['Site', `${project.street}, ${project.town}`],
    ['Type', project.category],
    ['Inspector', project.inspector],
    [funding ? 'Funding closes' : 'Funding closed', project.closes],
    ['Payments', project.payments],
  ]

  const right: [string, React.ReactNode][] = [
    [
      'Vault',
      <ObjectCell
        key="v"
        id={shortAddress(project.vaultId)}
        obj={{
          kind: 'Vault',
          title: `${project.name} vault`,
          id: project.vaultId,
          rows: [
            ['Asset', 'RLUSD'],
            ['Assets held', `${formatWhole(funding ? project.raised : 0)} RLUSD`],
            ['Share token', shortHash(project.shareToken)],
          ],
        }}
      />,
    ],
    [
      'Share token',
      <ObjectCell
        key="s"
        id={shortHash(project.shareToken)}
        obj={{ kind: 'Multi-purpose token', title: 'Vault shares', id: project.shareToken, rows: [['Issuer', `${project.name} vault`], ['Transferable', 'No']] }}
      />,
    ],
    [
      'Loan',
      loanTx && project.loanId ? (
        <span key="l" className="flex items-center gap-3">
          <code className="font-mono text-[13px]">{shortHash(project.loanId)}</code>
          <LedgerLink tx={loanTx} short />
        </span>
      ) : (
        <span key="l" className="text-label">
          Set at close
        </span>
      ),
    ],
    [
      'Project account',
      <ObjectCell
        key="a"
        id={`${shortAddress(project.projectAccount)} · 3-of-4`}
        obj={{
          kind: 'Account · 3-of-4 multisig',
          title: `${project.name} account`,
          id: project.projectAccount,
          rows: project.signers.map((s) => [s.role, shortAddress(s.address)]),
          explorerUrl: `https://devnet.xrpl.org/accounts/${project.projectAccount}`,
        }}
      />,
    ],
    [
      `Escrows (${escrows.length || project.milestones.length})`,
      escrows.length ? (
        <ObjectCell
          key="e"
          id={escrows.map((m) => m.escrowSequence).join(', ')}
          obj={{
            kind: 'Escrows',
            title: `${escrows.length} milestone escrows`,
            id: project.projectAccount,
            rows: escrows.map((m) => [`${m.name} · seq ${m.escrowSequence}`, `${formatWhole(m.amount)} RLUSD`]),
          }}
        />
      ) : (
        <span key="e" className="text-label">
          Created at close
        </span>
      ),
    ],
    ['Network', network.name],
  ]

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Table rows={left} label="Project" />
      <Table rows={right} label="Ledger objects" />
    </div>
  )
}
