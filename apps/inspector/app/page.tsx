"use client";
// INS-02 queue: route 18 tasks for the selected inspector, grouped by `needs`, polled every 5s.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { TaskRow } from "@/components/task-row";
import { Empty } from "@/components/ui/layout";
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
    <div className="space-y-6">
      <section aria-label="Your queue" className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="text-title">Queue</h1>
        <p className="text-[40px] leading-12 tabular">{groups ? actionable : "–"} <span className="text-[20px] text-ink-2">due</span></p>
      </section>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-small text-ink-2">
        <span>{inspector.name}</span><VerifiedInspectorBadge inspector={inspector} />
        <span>License {inspector.licenseNumber}</span><span>{sentence(inspector.trades.join(", "))}</span>
      </div>

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
          <section aria-label="Due" className="min-w-0 rounded-panel border border-line bg-surface px-6 py-2">
            <div className="flex min-h-11 items-center justify-end pb-1">
              <PollStatus updatedAt={queue.updatedAt} error={queue.error} now={now} onRefresh={queue.refresh} />
            </div>
            {due.length === 0 ? (
              <Empty
                className="mt-6"
                title={groups.none.length ? "No audits due" : "No assignments"}
                action={
                  <p className="text-small text-ink-2">
                    {groups.none.length
                      ? "New work shows up here as soon as a builder submits evidence."
                      : "No projects assigned to you yet. Inspectors are assigned from the verified panel at lock-terms."}
                  </p>
                }
              />
            ) : (
              <TaskTable tasks={due} fresh={fresh} now={now} />
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
        <div className="rounded-panel border border-line bg-surface px-6 py-2"><TaskTable tasks={tasks} fresh={fresh} now={now} /></div>
      )}
    </section>
  );
}

function TaskTable({ tasks, fresh, now }: { tasks: InspectorTask[]; fresh: Set<string>; now: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-left text-[15px] tabular">
        <thead><tr className="border-b-2 border-ink">
          {["Project", "Milestone", "Site", "Evidence", "Due", "Status"].map((label) => <th key={label} scope="col" className="py-2 pr-4 font-medium">{label}</th>)}
          <th scope="col" className="py-2 text-right"><span className="sr-only">Action</span></th>
        </tr></thead>
        <tbody className="divide-y divide-line">{tasks.map((task) => <TaskRow key={taskKey(task)} task={task} fresh={fresh.has(taskKey(task))} now={now} />)}</tbody>
      </table>
    </div>
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
