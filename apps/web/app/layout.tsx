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
        <SiteHeader session={session} />
        <main className="mx-auto max-w-[1184px] px-8 pt-10 pb-24">{children}</main>
        <footer className="mx-auto max-w-[1184px] border-t border-line px-8 py-6 text-caption text-ink-2">
          {BRAND.name} is a prototype on the XRPL devnet. Not an offer to invest.
        </footer>
        <Toaster position="bottom-right" closeButton toastOptions={{ className: "font-sans" }} />
      </body>
    </html>
  );
}
