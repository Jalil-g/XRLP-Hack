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
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-50 focus:rounded-control focus:bg-surface focus:p-3">Skip to content</a>
          <SiteHeader />
          <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1264px] px-4 py-10 sm:px-8">{children}</main>
        </IdentityProvider>
        <footer className="mt-16 bg-[#2f4241] text-white">
          <div className="mx-auto flex max-w-[1264px] flex-wrap justify-between gap-8 px-4 py-10 sm:px-8">
            <p className="text-[20px]">{BRAND.name}</p>
            <p className="text-caption text-white/70">{BRAND.network} prototype. Inspector observations do not release funds.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
