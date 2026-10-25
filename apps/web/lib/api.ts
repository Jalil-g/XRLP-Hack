// THE data-access seam for apps/web: one typed function per route in docs/05-api.md §2 (routes 1–23).
// Usable from server and client components. Transport by NEXT_PUBLIC_API_MODE:
//   mock (default) — server: in-process mock (lib/mock/server.ts) · browser: /api/* served by app/api/[...path] (same mock)
//   http           — server: fetch CORE_URL · browser: /api/* rewritten to CORE_URL (next.config.ts)
// The app holds no business logic: whatever these return is what the UI shows.
import type {
  ApiErrorBody,
  AuditReport,
  Builder,
  CancelResult,
  ChainEvent,
  CloseLoanResult,
  CreateProjectInput,
  DecisionResult,
  ErrorCode,
  EventsOnly,
  Evidence,
  EvidenceKind,
  Inspector,
  InspectorTask,
  InvestResult,
  LockTermsResult,
  Party,
  PayFeeResult,
  PortfolioPosition,
  Project,
  ProjectDetail,
  ProjectStatus,
  ProjectSummary,
  RepayResult,
  Rlusd,
  RunChecksResult,
  SubmitAuditResult,
  SubmitEvidenceResult,
  TryStealResult,
  VerifyProjectResult,
  XrplAddress,
} from "./contract";

export const API_MODE: "mock" | "http" = process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

/** Client-side codes on top of the contract's ErrorCode. */
export type ClientErrorCode = ErrorCode | "unreachable" | "unknown";

export class ApiError extends Error {
  constructor(
    public readonly code: ClientErrorCode,
    message: string,
    public readonly status = 400,
    public readonly txResult?: string,
    public readonly txHash?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static fromBody(body: unknown, status: number): ApiError {
    const e = (body as Partial<ApiErrorBody> | undefined)?.error;
    if (e && typeof e.code === "string") return new ApiError(e.code, e.message ?? e.code, status, e.txResult, e.txHash);
    return new ApiError("unknown", `Request failed (${status})`, status);
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code as ErrorCode, message: this.message, txResult: this.txResult, txHash: this.txHash } };
  }
}

export type ApiRequest = { method: "GET" | "POST"; path: string; body?: unknown };

const enc = encodeURIComponent;

async function send<T>(req: ApiRequest): Promise<T> {
  if (process.env.NEXT_PUBLIC_API_MODE !== "http" && typeof window === "undefined") {
    const { handleMock } = await import("./mock/server");
    return (await handleMock(req)) as T;
  }
  const base = typeof window === "undefined" ? (process.env.CORE_URL ?? "http://localhost:4000") : "";
  const init: RequestInit = { method: req.method, cache: "no-store" };
  if (req.body instanceof FormData) init.body = req.body;
  else if (req.body !== undefined) {
    init.body = JSON.stringify(req.body);
    init.headers = { "content-type": "application/json" };
  }
  let res: Response;
  try {
    res = await fetch(base + req.path, init);
  } catch (err) {
    throw new ApiError("unreachable", `Core API unreachable at ${base || "/api"}: ${err instanceof Error ? err.message : err}`, 503);
  }
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw ApiError.fromBody(data, res.status);
  return data as T;
}

const get = <T>(path: string) => send<T>({ method: "GET", path });
const post = <T>(path: string, body?: unknown) => send<T>({ method: "POST", path, body });

const project = (id: string) => `/api/projects/${enc(id)}`;
const milestone = (id: string, mid: string) => `${project(id)}/milestones/${enc(mid)}`;

/** One evidence file for route 9. */
export type EvidenceFile = { file: Blob; filename: string; kind: EvidenceKind };

export const api = {
  // 1
  listProjects: (q: { status?: ProjectStatus } = {}) =>
    get<ProjectSummary[]>(`/api/projects${q.status ? `?status=${enc(q.status)}` : ""}`),
  // 2
  getProject: (id: string) => get<ProjectDetail>(project(id)),
  // 3
  createProject: (input: CreateProjectInput) => post<Project>("/api/projects", input),
  // 4
  payVerificationFee: (id: string, builder: XrplAddress) => post<PayFeeResult>(`${project(id)}/verification-fee`, { builder }),
  // 5
  verifyProject: (id: string) => post<VerifyProjectResult>(`${project(id)}/verify-project`),
  // 6
  lockTerms: (id: string, actor: XrplAddress) => post<LockTermsResult>(`${project(id)}/lock-terms`, { actor }),
  // 7
  invest: (id: string, investor: XrplAddress, amount: Rlusd) => post<InvestResult>(`${project(id)}/investments`, { investor, amount }),
  // 8
  closeLoan: (id: string, actor: XrplAddress) => post<CloseLoanResult>(`${project(id)}/close`, { actor }),
  // 9 (multipart: files[], kind[])
  submitEvidence: (id: string, mid: string, files: EvidenceFile[]) => {
    const form = new FormData();
    for (const f of files) {
      form.append("files[]", f.file, f.filename);
      form.append("kind[]", f.kind);
    }
    return post<SubmitEvidenceResult>(`${milestone(id, mid)}/evidence`, form);
  },
  // 10 (multipart: report JSON, photos[], optional signedTxBlob)
  submitAudit: (id: string, mid: string, input: { report: AuditReport; photos: { file: Blob; filename: string }[]; signedTxBlob?: string }) => {
    const form = new FormData();
    form.append("report", JSON.stringify(input.report));
    for (const p of input.photos) form.append("photos[]", p.file, p.filename);
    if (input.signedTxBlob) form.append("signedTxBlob", input.signedTxBlob);
    return post<SubmitAuditResult>(`${milestone(id, mid)}/audit`, form);
  },
  // 11 — runs the suite; core auto-releases on pass
  runChecks: (id: string, mid: string) => post<RunChecksResult>(`${milestone(id, mid)}/run-checks`),
  // 12 — platform operator resolves needs_human
  decide: (id: string, mid: string, input: { actor: XrplAddress; decision: "approve" | "reject"; reason: string }) =>
    post<DecisionResult>(`${milestone(id, mid)}/decision`, input),
  // 13
  cancelMilestone: (id: string, mid: string) => post<CancelResult>(`${milestone(id, mid)}/cancel`),
  // 14
  repay: (id: string, amount: Rlusd) => post<RepayResult>(`${project(id)}/repayments`, { amount }),
  // 15
  withdraw: (id: string, investor: XrplAddress, amount: Rlusd) => post<EventsOnly>(`${project(id)}/withdrawals`, { investor, amount }),
  // 16 — newest first
  listEvents: (id: string) => get<ChainEvent[]>(`${project(id)}/events`),
  // 17
  listBuilders: () => get<Builder[]>("/api/builders"),
  getBuilder: (id: string) => get<Builder>(`/api/builders/${enc(id)}`),
  // 18
  listInspectors: () => get<Inspector[]>("/api/inspectors"),
  inspectorQueue: (address: XrplAddress) => get<InspectorTask[]>(`/api/inspectors/${enc(address)}/queue`),
  // 19
  kycInvestor: (address: XrplAddress) => post<EventsOnly>(`/api/investors/${enc(address)}/kyc`),
  // 20
  portfolio: (investor: XrplAddress) => get<PortfolioPosition[]>(`/api/portfolio/${enc(investor)}`),
  // 21
  resetDemo: (seed: "maple-st" = "maple-st") => post<{ ok: boolean }>("/api/admin/demo/reset", { seed }),
  // 22
  keeperTick: () => post<EventsOnly>("/api/admin/keeper/tick"),
  // 23 — wrong fulfillment from the platform key; the ledger refuses
  tryStealDemo: (id: string, mid: string) => post<TryStealResult>(`/api/admin/demo/try-steal/${enc(id)}/${enc(mid)}`),

  // PROPOSED on #53 (not in 05-api yet): demo identities. Returns [] if core doesn't serve it.
  listParties: () =>
    get<Party[]>("/api/admin/demo/parties").catch((err: unknown) => {
      if (err instanceof ApiError && (err.status === 404 || err.code === "not_found")) return [] as Party[];
      throw err;
    }),
};

/** URL for an evidence / audit file: fixture URIs as-is, everything else via GET /api/files/:fileId. */
export function fileUrl(e: Pick<Evidence, "id" | "uri">): string {
  return /^(\/|data:|https?:)/.test(e.uri) ? e.uri : `/api/files/${enc(e.id)}`;
}
