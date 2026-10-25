import Link from 'next/link'
import { disclaimer } from '@/lib/mock-data'

const columns = [
  { title: 'Invest', links: [{ label: 'Projects', href: '/invest' }, { label: 'Portfolio', href: '/portfolio' }, { label: 'Transactions', href: '/transactions' }] },
  { title: 'Build', links: [{ label: 'Builder', href: '/builder' }, { label: 'Inspector', href: '/inspector' }] },
  { title: 'Ledger', links: [{ label: 'Demo', href: '/demo' }, { label: 'Devnet explorer', href: 'https://devnet.xrpl.org' }] },
]

export function SiteFooter() {
  return (
    <footer className="mt-16 bg-ink text-white">
      <div className="container-app flex flex-col gap-8 py-10">
        <div className="flex flex-wrap justify-between gap-8">
          <p className="text-[20px] font-medium">Drawproof</p>
          <div className="flex gap-16">
            {columns.map((col) => (
              <div key={col.title} className="flex flex-col gap-2">
                <p className="text-[14px] font-medium">{col.title}</p>
                {col.links.map((l) => (
                  <Link key={l.href} href={l.href} className="text-[14px] text-white/80 hover:text-white">
                    {l.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="border-t border-white/20 pt-5 t-caption text-white/70">{disclaimer}</p>
      </div>
    </footer>
  )
}
