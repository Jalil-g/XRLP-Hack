import type { Metadata } from "next";
import Link from "next/link";
import { Toaster } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/session";
import { BRAND } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.pitch,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-50 focus:rounded-control focus:bg-page focus:p-3">Skip to content</a>
        <SiteHeader session={session} />
        <main id="main-content" tabIndex={-1} className="container-app flex-1 pt-6 pb-16 sm:pt-8">{children}</main>
        <footer className="mt-16 bg-ink text-white">
          <div className="container-app flex flex-col gap-8 py-10">
            <div className="flex flex-wrap justify-between gap-8">
              <p className="text-[20px] font-medium">{BRAND.name}</p>
              <nav aria-label="Footer" className="flex flex-wrap gap-10 sm:gap-16">
                <div className="flex flex-col gap-2 text-small">
                  <p className="font-medium">Invest</p>
                  <Link href="/" className="text-white/80 hover:text-white">Projects</Link>
                  {session.role === "investor" && <Link href="/portfolio" className="text-white/80 hover:text-white">Portfolio</Link>}
                </div>
                {session.role === "builder" && <div className="flex flex-col gap-2 text-small">
                  <p className="font-medium">Build</p>
                  <Link href="/builder" className="text-white/80 hover:text-white">Builder</Link>
                </div>}
                <div className="flex flex-col gap-2 text-small">
                  <p className="font-medium">Ledger</p>
                  <Link href="/demo" className="text-white/80 hover:text-white">Demo</Link>
                  <a href="https://devnet.xrpl.org" className="text-white/80 hover:text-white">Devnet explorer</a>
                </div>
              </nav>
            </div>
            <p className="border-t border-white/20 pt-5 text-caption text-white/70">Devnet prototype. Not an offer to invest.</p>
          </div>
        </footer>
        <Toaster position="bottom-right" closeButton toastOptions={{ className: "font-sans" }} />
      </body>
    </html>
  );
}
