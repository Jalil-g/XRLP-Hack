import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/session";
import { BRAND } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — milestone-verified construction lending`, template: `%s · ${BRAND.name}` },
  description: BRAND.tagline,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <SiteHeader session={session} />
        <main className="mx-auto max-w-7xl px-4 pt-8 pb-20 sm:px-6">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-faint">
          Prototype on {BRAND.network} — not an offer to invest. AI checks evidence consistency; licensed inspectors confirm quality.
        </footer>
        <Toaster position="bottom-right" richColors closeButton toastOptions={{ className: "font-sans" }} />
      </body>
    </html>
  );
}
