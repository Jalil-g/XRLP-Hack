// THE data-access seam for the inspector app (docs/05-api.md §1: one typed client per app). Components call only `api.*`.
// NEXT_PUBLIC_API_MODE=mock → in-memory fixtures (lib/mock); http → core. In the browser http calls go same-origin to /api/*
// and next.config.ts rewrites them to CORE_URL; on the server they go to CORE_URL directly.
// http responses are checked against the 05-api schemas: a mismatch logs a warning (contract drift) but does not throw.
import type { z } from "zod";
import * as mock from "./mock/backend.ts";
import {
  ErrorBody,
  Inspector,
  InspectorTask,
  ProjectDetail,
  SubmitAuditResult,
  type ErrorCode,
  type Evidence,
  type InspectorAudit,
  type ChecksStatus,
} from "./types.ts";

export type ApiMode = "mock" | "http";
export const API_MODE: ApiMode = process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

/** Multipart field names for route 10. Not pinned by 05-api; proposed on #53. */
export const AUDIT_FORM_FIELDS = { report: "report", photos: "photos", signedTxBlob: "signedTxBlob" } as const;

export class ApiError extends Error {
  /** 05-api ErrorCode, or "network" when core could not be reached / did not answer with the error envelope. */
  readonly code: ErrorCode | "network";
  readonly status: number;
  readonly txResult?: string;
  readonly txHash?: string;
  constructor(code: ErrorCode | "network", message: string, status: number, extra: { txResult?: string; txHash?: string } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.txResult = extra.txResult;
    this.txHash = extra.txHash;
  }
}

export type SubmitAuditInput = {
  projectId: string;
  milestoneId: string;
  /** The audit as signed: `txHash` is filled in by core from the attestation tx. */
  report: InspectorAudit;
  /** Photo files, same order as `report.photos`. */
  photos: Blob[];
  /** Attestation tx signed in this app with the inspector's software key (INS-04). Omitted → core signs with the demo key. */
  signedTxBlob?: string;
};

// ---------------------------------------------------------------- transport

const enc = encodeURIComponent;

function baseUrl() {
  if (typeof window !== "undefined") return "";
  return (process.env.CORE_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

async function http<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(baseUrl() + path, { cache: "no-store", ...init, headers: { accept: "application/json", ...init?.headers } });
  } catch (err) {
    throw new ApiError("network", `Core unreachable (${path}): ${(err as Error).message}`, 0);
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ErrorBody.safeParse(body);
    if (parsed.success) {
      const { code, message, ...extra } = parsed.data.error;
      throw new ApiError(code, message, res.status, extra);
    }
    throw new ApiError(res.status === 404 ? "not_found" : "network", `${path} failed with HTTP ${res.status}`, res.status);
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  console.warn(`[inspector api] ${path} response does not match docs/05-api.md`, parsed.error.issues.slice(0, 5));
  return body as T;
}

async function viaMock<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof mock.MockError) throw new ApiError(err.code, err.message, err.status);
    throw err;
  }
}

// ---------------------------------------------------------------- routes

export const api = {
  mode: API_MODE,

  /** Route 18a — the verified inspector panel (identity picker). */
  listInspectors(): Promise<Inspector[]> {
    if (API_MODE === "mock") return viaMock(() => mock.listInspectors());
    return http(Inspector.array(), "/api/inspectors");
  },

  /** Route 18b — tasks assigned to this inspector (pre_visit / audit / re_audit / none). */
  getQueue(address: string): Promise<InspectorTask[]> {
    if (API_MODE === "mock") return viaMock(() => mock.inspectorQueue(address));
    return http(InspectorTask.array(), `/api/inspectors/${enc(address)}/queue`);
  },

  /** Discover assigned projects via route 18 (including needs:none), then read their audits/checks via route 2. */
  async getAuditHistory(address: string): Promise<ProjectDetail[]> {
    const tasks = await api.getQueue(address);
    const projectIds = [...new Set(tasks.map((task) => task.projectId))];
    // Reject a partial refresh: usePoll retains the last complete snapshot and displays the error.
    return Promise.all(projectIds.map((id) => api.getProject(id)));
  },

  /** Route 2 — full project read model (checks panel outcome, audits, attestations, events). */
  getProject(projectId: string): Promise<ProjectDetail> {
    if (API_MODE === "mock") return viaMock(() => mock.getProject(projectId));
    return http(ProjectDetail, `/api/projects/${enc(projectId)}`);
  },

  /** One-shot review snapshot. A prior audit also identifies a new evidence round labelled `audit` by core. */
  async getAuditReview(address: string, projectId: string, milestoneId: string): Promise<{ task: InspectorTask; checks?: ChecksStatus } | null> {
    const tasks = await api.getQueue(address);
    const task = tasks.find((t) => t.projectId === projectId && t.milestone?.id === milestoneId);
    if (!task) return null;
    if (task.needs === "re_audit" || task.priorAudits.some((a) => a.inspector === address)) {
      const detail = await api.getProject(projectId);
      return { task, checks: detail.checks[milestoneId] };
    }
    return { task };
  },

  /** Route 10 — file the signed audit. Core attests it on-chain (or submits `signedTxBlob`) and returns the event. */
  submitAudit(input: SubmitAuditInput): Promise<SubmitAuditResult> {
    if (API_MODE === "mock") return viaMock(() => mock.submitAudit(input));
    const form = new FormData();
    form.set(AUDIT_FORM_FIELDS.report, JSON.stringify(input.report));
    input.photos.forEach((p, i) => form.append(AUDIT_FORM_FIELDS.photos, p, input.report.photos[i]?.filename ?? `photo-${i + 1}.jpg`));
    if (input.signedTxBlob) form.set(AUDIT_FORM_FIELDS.signedTxBlob, input.signedTxBlob);
    const path = `/api/projects/${enc(input.projectId)}/milestones/${enc(input.milestoneId)}/audit`;
    return http(SubmitAuditResult, path, { method: "POST", body: form });
  },

  /** Where to load an evidence / audit file: core's `/api/files/:fileId`, or the fixture's data: URL in mock mode. */
  fileUrl(evidence: Pick<Evidence, "id" | "uri">): string {
    return API_MODE === "mock" ? evidence.uri : `${baseUrl()}/api/files/${enc(evidence.id)}`;
  },
};
