"use client";
// INS-02 queue: route 18 tasks for the selected inspector, grouped by `needs`, polled every 5s.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { TaskRow } from "@/components/task-row";
import { Empty, Facts } from "@/components/ui/layout";
import { LoadingState } from "@/components/ui/loading-state";
import { VerifiedInspectorBadge } from "@/components/verified-badge";
import { api } from "@/lib/api";
import { ACTIONABLE, arrivedKeys, groupTasks, taskKey } from "@/lib/queue";
import type { InspectorTask } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";
import { cn } from "@/lib/utils";

const POLL_MS = 5_000;
/** How long a task that arrived on a poll stays highlighted. */
const FRESH_MS = 8_000;

export default function QueuePage() {
  const { status, error, inspector } = useIdentity();
  const address = inspector?.address;
  const load = useCallback(() => api.getQueue(address!), [address]);
  const queue = usePoll(address ? load : null, POLL_MS);
  const fresh = useArrivals(queue.data);
  const now = useNow(queue.updatedAt);

  if (status === "error") return <p role="alert" className="text-small text-bad">Could not load the inspector panel: {error}</p>;
  if (!inspector) return <LoadingState label="Loading inspector credentials…" />;

  const groups = queue.data ? groupTasks(queue.data) : null;
  const actionable = groups ? ACTIONABLE.reduce((n, k) => n + groups[k].length, 0) : 0;
  const due = groups ? ACTIONABLE.flatMap((n) => groups[n]) : [];

  return (
    <div className="space-y-12">
      <section aria-label="Your queue" className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        <h1 className="min-w-0">
          <span className="block text-small font-medium text-ink-2">Due now</span>
          <span className="hero-amount mt-2 block">{groups ? actionable : "–"}</span>
        </h1>
        <Facts
          items={[
            { key: "inspector", label: <VerifiedInspectorBadge inspector={inspector} />, value: inspector.name },
            { label: "License", value: inspector.licenseNumber },
            { label: "Trades", value: sentence(inspector.trades.join(", ")) },
          ]}
        />
      </section>

      {!groups ? (
        queue.error ? (
          <div role="alert" className="rounded-panel bg-fail-bg px-5 py-4 text-small text-fail">
            Assignments could not load: {queue.error}.{" "}
            <button type="button" onClick={queue.refresh} className="min-h-11 font-semibold underline">Retry</button>
          </div>
        ) : (
          <LoadingState label="Loading assigned audits…" />
        )
      ) : (
        <>
          <section aria-label="Due" className="min-w-0">
            <div className="flex min-h-11 items-center justify-end border-b border-line pb-1">
              <PollStatus updatedAt={queue.updatedAt} error={queue.error} now={now} onRefresh={queue.refresh} />
            </div>
            {due.length === 0 ? (
              <Empty className="mt-6" title={groups.none.length ? "No audits due" : "No assignments"} />
            ) : (
              <ul className="divide-y divide-line">
                {due.map((t) => (
                  <TaskRow key={taskKey(t)} task={t} fresh={fresh.has(taskKey(t))} now={now} />
                ))}
              </ul>
            )}
          </section>
          {groups.none.length > 0 && <Done tasks={groups.none} fresh={fresh} now={now} />}
        </>
      )}
    </div>
  );
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Done({ tasks, fresh, now }: { tasks: InspectorTask[]; fresh: Set<string>; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Nothing due" className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 border-b border-line text-small font-medium text-ink-2 hover:text-ink"
      >
        <ChevronRight className={cn("size-4 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        Nothing due
        <span className="tabular text-ink-3">{tasks.length}</span>
      </button>
      {open && (
        <ul className="divide-y divide-line">
          {tasks.map((t) => (
            <TaskRow key={taskKey(t)} task={t} fresh={fresh.has(taskKey(t))} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PollStatus({ updatedAt, error, now, onRefresh }: { updatedAt?: number; error?: string; now: number; onRefresh(): void }) {
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <div className="flex items-center gap-1 text-caption text-ink-3">
      {error ? (
        <span className="font-medium text-review" title={error}>
          {updatedAt ? "Stale: unable to refresh" : "Unable to load queue"}
        </span>
      ) : (
        !updatedAt && <span>Loading queue…</span>
      )}
      {ago !== null && !error && <span className="tabular">Updated {ago}s ago</span>}
      <button type="button" onClick={onRefresh} className="flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-band hover:text-ink" aria-label="Refresh queue">
        <RefreshCw className="size-4" />
      </button>
    </div>
  );
}

/** Tasks that appeared since the previous poll, highlighted for FRESH_MS (on stage: builder uploads → it pops up here). */
function useArrivals(tasks: InspectorTask[] | null): Set<string> {
  const prev = useRef<InspectorTask[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  // Timers outlive the effect: the next poll (5s) lands before the highlight ends (8s) and must not cancel it.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    if (!tasks) {
      prev.current = null;
      setFresh(new Set());
      return;
    }
    const arrived = arrivedKeys(prev.current, tasks);
    prev.current = tasks;
    if (!arrived.size) return;
    setFresh((f) => new Set([...f, ...arrived]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFresh((f) => new Set([...f].filter((k) => !arrived.has(k))));
    }, FRESH_MS);
    timers.current.add(timer);
  }, [tasks]);
  return fresh;
}

/** Wall clock for "updated Ns ago" / expiry countdowns, ticking every second. */
function useNow(resetOn?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [resetOn]);
  return now;
}
