// Browser-side typed client for app/api/*. Client components use this; server components call lib/api directly.
import type { ChainEvent, Verdict } from "@xrlp/shared";
import type {
  AttestInput,
  AttestResult,
  DemoAction,
  DemoResult,
  InvestResult,
  MilestoneRef,
  MilestoneView,
  SubmitEvidenceInput,
} from "./types";

async function post<T>(url: string, payload?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const client = {
  invest: (projectId: string, investor: string, amount: string) =>
    post<InvestResult>(`/api/projects/${encodeURIComponent(projectId)}/invest`, { investor, amount }),
  closeLoan: (projectId: string) => post<ChainEvent[]>(`/api/projects/${encodeURIComponent(projectId)}/close`),
  repay: (projectId: string) => post<ChainEvent>(`/api/projects/${encodeURIComponent(projectId)}/repay`),
  submitEvidence: (input: SubmitEvidenceInput) => post<MilestoneView>("/api/milestones/evidence", input),
  runAiReview: (ref: MilestoneRef) => post<Verdict>("/api/milestones/review", ref),
  attest: (input: AttestInput) => post<AttestResult>("/api/milestones/attest", input),
  release: (ref: MilestoneRef) => post<ChainEvent>("/api/milestones/release", ref),
  expire: (ref: MilestoneRef) => post<ChainEvent[]>("/api/milestones/expire", ref),
  demo: (action: DemoAction) => post<DemoResult>("/api/demo", { action }),
};
