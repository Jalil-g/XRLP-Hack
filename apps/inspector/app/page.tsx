"use client";
// INS-02 queue: route 18 tasks for the selected inspector, grouped by `needs`, polled every 5s.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { NEEDS, TaskRow } from "@/components/task-row";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifiedInspectorBadge } from "@/components/verified-badge";
import { api } from "@/lib/api";
import { ACTIONABLE, arrivedKeys, groupTasks, taskKey } from "@/lib/queue";
import type { InspectorTask } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";
import { cn, explorerAccountUrl, shortAddress } from "@/lib/utils";

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

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title">
            Assigned audits{groups && <span className="ml-3 align-baseline text-ink-2 tabular">{actionable}</span>}
          </h1>
          <p className="mt-2 max-w-2xl text-body text-muted">
            {groups ? `${actionable} awaiting your review: audits, re-audits and site visits. ` : ""}Record what you see and sign your judgment.
          </p>
        </div>
        <PollStatus updatedAt={queue.updatedAt} error={queue.error} now={now} onRefresh={queue.refresh} />
      </div>

      <section aria-label="Your credentials" className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-panel border border-line bg-surface px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{inspector.name}</span>
            <VerifiedInspectorBadge inspector={inspector} />
          </div>
          <p className="text-caption text-muted">
            {inspector.licenseNumber} · {inspector.trades.join(", ")}
          </p>
        </div>
        <p className="text-caption text-muted sm:ml-auto">
          Signing account{" "}
          <a href={explorerAccountUrl(inspector.address)} target="_blank" rel="noreferrer" className="font-mono text-ink-2 underline underline-offset-4 hover:text-brand">
            {shortAddress(inspector.address, 8, 6)}
          </a>
        </p>
      </section>

      {!groups ? (
        queue.error ? (
          <Card role="alert"><CardContent className="space-y-3"><h2 className="text-heading">Assignments could not load</h2><p className="text-small text-bad">{queue.error}</p><p className="text-small text-muted">Your reports are unchanged. Use Refresh queue to try again.</p></CardContent></Card>
        ) : (
          <LoadingState label="Loading assigned audits…" />
        )
      ) : (
        <>
          {actionable === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-small text-muted">
                {groups.none.length
                  ? "Nothing to audit right now. New work shows up here as soon as a builder submits evidence."
                  : "No projects assigned to you yet. The AI assigns inspectors from the verified panel at lock-terms."}
              </CardContent>
            </Card>
          )}
          {ACTIONABLE.filter((n) => groups[n].length).map((n) => (
            <TaskGroup key={n} needs={n} tasks={groups[n]} fresh={fresh} now={now} />
          ))}
          {groups.none.length > 0 && <TaskGroup needs="none" tasks={groups.none} fresh={fresh} now={now} collapsible />}
        </>
      )}
    </div>
  );
}

function TaskGroup({
  needs,
  tasks,
  fresh,
  now,
  collapsible,
}: {
  needs: InspectorTask["needs"];
  tasks: InspectorTask[];
  fresh: Set<string>;
  now: number;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const { label, tone, hint } = NEEDS[needs];
  return (
    <Card>
      <CardHeader className={cn(!open && "border-b-0")}>
        <div>
          <CardTitle className="flex items-center gap-2">
            {collapsible ? "Assigned, nothing due" : label}
            <Badge tone={tone}>{tasks.length}</Badge>
          </CardTitle>
          <CardDescription>{hint}</CardDescription>
        </div>
        {collapsible && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-11 items-center gap-1 text-caption text-muted hover:text-ink" aria-expanded={open}>
            {open ? "Hide" : "Show"} <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </CardHeader>
      {open && (
        <ul className="divide-y divide-line">
          {tasks.map((t) => (
            <TaskRow key={taskKey(t)} task={t} fresh={fresh.has(taskKey(t))} now={now} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PollStatus({ updatedAt, error, now, onRefresh }: { updatedAt?: number; error?: string; now: number; onRefresh(): void }) {
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <div className="flex items-center gap-2 text-caption text-muted">
      {error ? (
        <Badge tone="warn" title={error}>
          {updatedAt ? "Stale: unable to refresh" : "Unable to load queue"}
        </Badge>
      ) : (
        <span className="flex items-center gap-1.5">
          {!updatedAt && "Loading queue…"}
        </span>
      )}
      {ago !== null && <span className="tabular">updated {ago}s ago</span>}
      <button type="button" onClick={onRefresh} className="flex size-11 items-center justify-center rounded-control hover:bg-subtle hover:text-ink" aria-label="Refresh queue">
        <RefreshCw className="size-3.5" />
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
