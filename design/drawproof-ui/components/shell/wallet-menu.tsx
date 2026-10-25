'use client'

import { Menu } from '@base-ui/react/menu'
import { ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { formatRLUSD, getReleasedToDate, getTx, getWallet, shortAddress } from '@/lib/api'
import { network, roleHome, type LedgerTx, type Role } from '@/lib/mock-data'
import { CopyButton } from '@/components/xrpl/copy-button'
import { useLedgerDrawer } from '@/components/xrpl/ledger-drawer'

const ROLES: { id: Role; label: string }[] = [
  { id: 'investor', label: 'Investor' },
  { id: 'builder', label: 'Builder' },
  { id: 'inspector', label: 'Inspector' },
]

export function WalletMenu({ role }: { role: Role }) {
  const wallet = getWallet(role)
  const router = useRouter()
  const { show } = useLedgerDrawer()

  const credentialTx: LedgerTx = getTx(wallet.credentialTx) ?? {
    hash: wallet.credentialTx,
    action: 'Payment',
    label: 'Credential issued',
    from: 'rRQsHU57dfc9RsFQsXkefT89WHY3zMbR1',
    fromName: 'Drawproof',
    to: wallet.address,
    toName: wallet.name,
    amount: null,
    currency: 'XRP',
    time: 'Aug 28, 2026 12:00',
    ledgerIndex: 4180012,
    projectSlug: '',
    mock: true,
  }

  const section = 'border-b border-hairline px-4 py-3'
  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        aria-label={`Wallet menu for ${wallet.name}`}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-ink text-[14px] font-medium text-white">
          {wallet.initials}
        </span>
        <ChevronDown className="size-4 text-ink" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="w-80 rounded-md border border-hairline bg-white text-ink outline-none">
            <div className={section}>
              <p className="text-[16px] font-medium">{wallet.name}</p>
              <p className="t-label">{wallet.roleLabel}</p>
            </div>
            <div className={`${section} flex items-center justify-between`}>
              <span className="t-mono" title={wallet.address}>
                {shortAddress(wallet.address)}
              </span>
              <CopyButton value={wallet.address} label="Copy address" />
            </div>
            <div className={section}>
              <span className="inline-flex h-6 items-center rounded-sm bg-ok-bg px-2 text-[13px] font-medium text-ok">
                {wallet.credential}
                {wallet.credentialDetail && ` · ${wallet.credentialDetail}`}
              </span>
              {wallet.credentialDetail && (
                <span className="ml-2 rounded-sm border border-hairline px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-label">
                  MOCK
                </span>
              )}
              <p className="mt-1.5 t-caption text-label">Issued by Drawproof</p>
              <Menu.Item
                onClick={() => show(credentialTx)}
                className="mt-1 cursor-pointer rounded-sm text-[13px] underline underline-offset-4 outline-none data-highlighted:no-underline"
              >
                View on ledger
              </Menu.Item>
            </div>
            <dl className={`${section} flex flex-col gap-1`}>
              <div className="flex justify-between">
                <dt className="t-label">RLUSD</dt>
                <dd className="tnum">{formatRLUSD(wallet.rlusd)}</dd>
              </div>
              {role === 'builder' && (
                <div className="flex justify-between">
                  <dt className="t-label">Released to date</dt>
                  <dd className="tnum">{formatRLUSD(getReleasedToDate())}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="t-label">XRP reserve</dt>
                <dd className="tnum">{wallet.xrp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</dd>
              </div>
            </dl>
            <div className={section}>
              <p className="t-label">{network.name}</p>
            </div>
            <Menu.Group className={section}>
              <Menu.GroupLabel className="t-label mb-1">Switch role</Menu.GroupLabel>
              <Menu.RadioGroup value={role} onValueChange={(v) => router.push(roleHome[v as Role])}>
                {ROLES.map((r) => (
                  <Menu.RadioItem
                    key={r.id}
                    value={r.id}
                    className="flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-[15px] outline-none data-highlighted:bg-accent"
                  >
                    {r.label}
                    <Menu.RadioItemIndicator className="t-caption text-label">Current</Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <div className="p-2">
              <Menu.Item className="cursor-pointer rounded-sm px-2 py-1.5 text-[15px] outline-none data-highlighted:bg-accent">
                Sign out
              </Menu.Item>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
