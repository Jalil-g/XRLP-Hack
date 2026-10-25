"use client";

import { useCallback } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { AuditHistoryCard } from "@/components/audit/history-card";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { api, API_MODE } from "@/lib/api";
import { auditHistory } from "@/lib/history";
import { usePoll } from "@/lib/use-poll";
import { formatDateTime } from "@/lib/utils";

export default function HistoryPage() {
  const { status, error, inspector } = useIdentity();
  if (status === "error") return <p role="alert" className="text-small text-bad">Could not load the inspector panel: {error}</p>;
  if (!inspector) return <LoadingState label="Loading inspector credentials…" />;
  // Remount on identity changes so another inspector's reports never flash while their request is loading.
  return <History key={inspector.address} address={inspector.address} name={inspector.name} />;
}

function History({ address, name }: { address: string; name: string }) {
  const load = useCallback(() => api.getAuditHistory(address), [address]);
  const history = usePoll(load, 5_000);
  const entries = history.data ? auditHistory(history.data, address) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title">Audit history</h1>
          <p className="mt-2 text-body text-muted">{name}&apos;s signed reports, check results and release receipts.</p>
        </div>
        <button type="button" onClick={history.refresh} className="flex min-h-11 items-center gap-2 rounded-control border border-line bg-surface px-4 text-small text-muted hover:text-ink">
          <RefreshCw className="size-4" /> Refresh history
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-4">
        <h2 className="text-small font-semibold">Submitted reports{entries ? ` · ${entries.length}` : ""}</h2>
      <p className="max-w-2xl text-caption text-muted">
        Latest milestone results refresh every 5 seconds.{history.updatedAt && ` Updated ${formatDateTime(new Date(history.updatedAt).toISOString())}.`}
        {API_MODE === "mock" && " Mock data: transaction hashes are examples; they are not on devnet. New reports reset on reload."}
      </p>
      </div>
      {history.error && <p role="alert" className="rounded-lg border border-warn-line bg-warn-bg p-3 text-small text-warn">
        {entries ? "History may be stale. " : "Could not load history. "}{history.error}
      </p>}
      {!entries && !history.error && <LoadingState label="Loading signed reports and receipts…" />}
      {entries?.length === 0 && (
        <Card><CardContent className="space-y-3 py-10 text-center">
          <p className="font-medium">No submitted audits yet</p>
          <p className="text-small text-muted">Your filed reports will appear here with the milestone&apos;s check results and release transaction.</p>
          <Link href="/" className="inline-block text-small text-brand hover:underline">View assigned audits</Link>
        </CardContent></Card>
      )}
      {entries?.map((entry, index) => <AuditHistoryCard key={`${entry.milestone.id}:${entry.audit.txHash ?? entry.audit.at}:${index}`} entry={entry} />)}
    </div>
  );
}
