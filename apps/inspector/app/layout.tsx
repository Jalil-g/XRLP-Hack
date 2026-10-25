import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { IdentityProvider } from "@/components/identity";
import { SiteHeader } from "@/components/site-header";
import { BRAND } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND.name} ${BRAND.app}`, template: `%s · ${BRAND.name} ${BRAND.app}` },
  description: BRAND.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <IdentityProvider>
          <SiteHeader />
          <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6">{children}</main>
        </IdentityProvider>
        <footer className="border-t border-line py-6 text-center text-xs text-faint">
          Prototype on {BRAND.network}. Inspectors audit and sign; they hold no release key. The milestone test suite decides release.
        </footer>
      </body>
    </html>
  );
}
