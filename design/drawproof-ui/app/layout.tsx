import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Hanken_Grotesk } from 'next/font/google'
import { SiteFooter } from '@/components/shell/site-footer'
import { SiteHeader } from '@/components/shell/site-header'
import { LedgerProvider } from '@/components/xrpl/ledger-drawer'
import './globals.css'

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-hanken',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Drawproof',
    template: '%s · Drawproof',
  },
  description: 'Construction lending on the XRP Ledger. Milestone money releases only when the checks pass. XRPL Devnet.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  themeColor: '#F7F7F5',
  colorScheme: 'light',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${hanken.variable} bg-background`}>
      <body className="flex min-h-screen flex-col">
        <LedgerProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </LedgerProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
