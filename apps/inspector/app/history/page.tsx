"use client";

import { useCallback } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { AuditHistoryCard } from "@/components/audit/history-card";
import { buttonClass } from "@/components/ui/button";
import { Empty, PageHeader } from "@/components/ui/layout";
import { LoadingState } from "@/components/ui/loading-state";
import { api } from "@/lib/api";
import { auditHistory } from "@/lib/history";
import { usePoll } from "@/lib/use-poll";
import { formatDateTime } from "@/lib/utils";

export default function HistoryPage() {
  const { status, error, inspector } = useIdentity();
  if (status === "error") return <p role="alert" className="text-small text-bad">Could not load the inspector panel: {error}</p>;
  if (!inspector) return <LoadingState label="Loading inspector credentials…" />;
  // Remount on identity changes so another inspector's reports never flash while their request is loading.
  return <History key={inspector.address} address={inspector.address} />;
}

function History({ address }: { address: string }) {
  const load = useCallback(() => api.getAuditHistory(address), [address]);
  const history = usePoll(load, 5_000);
  const entries = history.data ? auditHistory(history.data, address) : null;

  const ago = history.updatedAt ? formatDateTime(new Date(history.updatedAt).toISOString()) : null;
  return (
    <div className="space-y-12">
      <PageHeader
        title={<>History{entries && entries.length > 0 && <span className="ml-3 text-ink-3 tabular">{entries.length}</span>}</>}
        action={
          <div className="flex items-center gap-1 text-caption text-ink-3">
            {ago && <span className="tabular">Updated {ago}</span>}
            <button type="button" onClick={history.refresh} className="flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-band hover:text-ink" aria-label="Refresh history">
              <RefreshCw className="size-4" />
            </button>
          </div>
        }
      />
      {history.error && (
        <p role="alert" className="rounded-control bg-review-bg px-4 py-3 text-small text-review">
          {entries ? "History may be stale. " : "Could not load history. "}{history.error}
        </p>
      )}
      {!entries && !history.error && <LoadingState label="Loading signed reports and receipts…" />}
      {entries?.length === 0 && (
        <Empty title="No submitted audits yet" action={<Link href="/" className={buttonClass("secondary")}>Open queue</Link>} />
      )}
      {entries?.map((entry, index) => <AuditHistoryCard key={`${entry.milestone.id}:${entry.audit.txHash ?? entry.audit.at}:${index}`} entry={entry} />)}
    </div>
  );
}
