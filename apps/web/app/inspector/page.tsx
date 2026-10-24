// Inspector UI lives in a separate app (apps/inspector) because it holds escrow release keys client-side.
// This page is intentionally a thin pointer. Set NEXT_PUBLIC_INSPECTOR_APP_URL to link to it.
import Link from "next/link";
import { ArrowUpRight, HardHat, KeyRound } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getInspectorQueue } from "@/lib/api";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inspector" };

const INSPECTOR_APP_URL = process.env.NEXT_PUBLIC_INSPECTOR_APP_URL ?? "http://localhost:3001";

export default async function InspectorPage() {
  const session = await getSession();
  const queue = await getInspectorQueue(session.inspector.address);

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardContent className="py-10 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <HardHat className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Inspections happen in the Inspector app</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            Inspectors hold each escrow&apos;s release key on their own device. Signing an approval reveals the fulfillment — the platform
            never sees it.
          </p>
          <p className="mt-4 text-[13px] text-ink-2">
            {session.inspector.name} has <span className="font-semibold">{queue.pending.length}</span> milestone
            {queue.pending.length === 1 ? "" : "s"} awaiting signature.
          </p>
          <ul className="mt-3 space-y-1 text-[13px] text-muted">
            {queue.pending.map((t) => (
              <li key={t.milestone.milestone.id}>
                <Link href={`/projects/${t.project.id}`} className="hover:text-brand hover:underline">
                  {t.project.name} · {t.milestone.milestone.title}
                </Link>
              </li>
            ))}
          </ul>
          <a href={INSPECTOR_APP_URL} className={buttonClass("primary", "lg", "mt-6")}>
            <KeyRound /> Open inspector app <ArrowUpRight />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
