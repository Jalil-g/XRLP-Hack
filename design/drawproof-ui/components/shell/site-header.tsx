'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { navByRole, type Role } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { KeyTag } from '@/components/inspector/key-dialog'
import { WalletMenu } from './wallet-menu'

export function roleForPath(pathname: string): Role {
  if (pathname.startsWith('/builder')) return 'builder'
  if (pathname.startsWith('/inspector')) return 'inspector'
  return 'investor'
}

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  if (href === '/invest') return pathname.startsWith('/invest') || pathname.startsWith('/projects')
  if (href === '/inspector') return pathname === href || pathname.startsWith('/inspector/audit')
  if (href === '/builder') return pathname === href
  return pathname.startsWith(href)
}

export function SiteHeader() {
  const pathname = usePathname()
  const role = roleForPath(pathname)
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-white">
      <div className="container-app flex h-[72px] items-center gap-10">
        <Link href="/" className="text-[20px] font-medium tracking-tight text-ink">
          Drawproof
        </Link>
        <nav aria-label="Primary" className="flex h-full items-center gap-7">
          {navByRole[role].map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-full items-center text-[16px] text-ink',
                  active && 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-clay',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span className="rounded-sm bg-neutral-bg px-2 py-0.5 text-[13px] font-medium text-neutral">Devnet</span>
          {role === 'inspector' && <KeyTag />}
          <WalletMenu role={role} />
        </div>
      </div>
    </header>
  )
}
