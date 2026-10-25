import type { Metadata } from "next";
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
      <body className="min-h-screen">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-50 focus:rounded-control focus:bg-page focus:p-3">Skip to content</a>
        <SiteHeader session={session} />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1184px] px-4 pt-8 pb-20 sm:px-8 sm:pt-10">{children}</main>
        <footer className="mx-auto max-w-[1184px] border-t border-line px-4 py-6 sm:px-8 text-caption text-ink-2">
          {BRAND.name} is a prototype on the XRPL devnet. Not an offer to invest.
        </footer>
        <Toaster position="bottom-right" closeButton toastOptions={{ className: "font-sans" }} />
      </body>
    </html>
  );
}
