import type { Metadata } from "next";
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
    <html lang="en">
      <body className="min-h-screen font-sans">
        <IdentityProvider>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-50 focus:rounded-control focus:bg-page focus:p-3">Skip to content</a>
          <SiteHeader />
          <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1184px] px-4 pt-8 pb-20 sm:px-8 sm:pt-10">{children}</main>
        </IdentityProvider>
        <footer className="mx-auto max-w-[1184px] border-t border-line px-4 py-6 text-caption text-muted sm:px-8">
          Prototype on {BRAND.network}. Inspectors audit and sign; they hold no release key. The milestone test suite decides release.
        </footer>
      </body>
    </html>
  );
}
