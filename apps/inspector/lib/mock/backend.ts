// In-memory stand-in for core, used when NEXT_PUBLIC_API_MODE=mock. Implements routes 2, 10 and 18 with the same
// inputs, outputs and error codes as docs/05-api.md so swapping to http mode changes nothing above lib/api.ts.
// State lives in whichever runtime imports it (the browser, for this client-rendered app) and resets on reload.
import type {
  ErrorCode,
  Inspector,
  InspectorAudit,
  InspectorTask,
  Milestone,
  ProjectDetail,
  SubmitAuditResult,
  TaskNeeds,
} from "../types.ts";
import { ATTEST_AMOUNT_DROPS, auditHash, parseAttestationTx, verifySignedBlob } from "@xrlp/attest-signer";
import { decode, hashes, type Transaction } from "xrpl";
import { evidenceBundleHash, sha256Hex } from "../audit.ts";
import * as fx from "./fixtures.ts";

export class MockError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function seed() {
  return structuredClone({
    projects: fx.PROJECTS,
    assignments: fx.ASSIGNMENTS,
    evidence: fx.EVIDENCE,
    audits: fx.AUDITS,
    checks: fx.CHECKS,
    attestations: fx.ATTESTATIONS,
    events: fx.EVENTS,
    reAudit: fx.RE_AUDIT,
  });
}

let state = seed();
let latencyMs = 150;

/** Test/dev hooks. Not part of the API surface. */
export const mockControl = {
  reset() {
    state = seed();
  },
  setLatency(ms: number) {
    latencyMs = ms;
  },
};

const settle = async <T>(value: T): Promise<T> => {
  if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
  return structuredClone(value);
};

function findProject(id: string) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) throw new MockError("not_found", `Project ${id} not found`, 404);
  return project;
}

function needsFor(m: Milestone, me: string): TaskNeeds {
  const audits = state.audits[m.id] ?? [];
  if (state.reAudit.includes(m.id)) return "re_audit";
  const awaitingAudits = m.status === "evidence_submitted" || (m.status === "audited" && audits.length < m.requiredInspectors);
  return awaitingAudits && !audits.some((a) => a.inspector === me) ? "audit" : "none";
}

// ---------------------------------------------------------------- route 18

export async function listInspectors(): Promise<Inspector[]> {
  return settle(fx.INSPECTORS);
}

export async function inspectorQueue(address: string): Promise<InspectorTask[]> {
  if (!fx.INSPECTORS.some((i) => i.address === address)) throw new MockError("not_found", `Inspector ${address} not found`, 404);
  const tasks: InspectorTask[] = [];
  for (const p of state.projects) {
    if (!(state.assignments[p.id] ?? []).includes(address)) continue;
    const base = { projectId: p.id, projectName: p.name, siteGeo: p.siteGeo };
    if (p.status === "verifying") {
      tasks.push({ ...base, sov: p.sov ?? [], evidence: [], needs: "pre_visit", priorAudits: [] });
      continue;
    }
    for (const m of p.milestones) {
      tasks.push({
        ...base,
        milestone: m,
        sov: (p.sov ?? []).filter((l) => m.sovCodes?.includes(l.code)),
        evidence: state.evidence[m.id] ?? [],
        needs: needsFor(m, address),
        priorAudits: state.audits[m.id] ?? [],
      });
    }
  }
  return settle(tasks);
}

// ---------------------------------------------------------------- route 2

export async function getProject(id: string): Promise<ProjectDetail> {
  const project = findProject(id);
  const builder = fx.BUILDERS.find((b) => b.id === project.builderId);
  if (!builder) throw new MockError("not_found", `Builder ${project.builderId} not found`, 404);
  const mids = new Set(project.milestones.map((m) => m.id));
  const pick = <T>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => mids.has(k)));
  return settle({
    project,
    builder,
    verification: fx.VERIFICATIONS[id],
    inspectors: fx.INSPECTORS.filter((i) => (state.assignments[id] ?? []).includes(i.address)),
    investments: fx.INVESTMENTS.filter((i) => i.projectId === id),
    events: state.events.filter((e) => e.projectId === id).sort((a, b) => b.at.localeCompare(a.at)),
    checks: pick(state.checks),
    audits: pick(state.audits),
    attestations: pick(state.attestations),
    vault: fx.VAULTS[id],
    loan: fx.LOANS[id],
  });
}

// ---------------------------------------------------------------- route 10

export type MockAuditInput = {
  projectId: string;
  milestoneId: string;
  report: InspectorAudit;
  photos: Blob[];
  signedTxBlob?: string;
};

export async function submitAudit({ projectId, milestoneId, report, photos, signedTxBlob }: MockAuditInput): Promise<SubmitAuditResult> {
  const project = findProject(projectId);
  const milestone = project.milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new MockError("not_found", `Milestone ${milestoneId} not found`, 404);
  if (report.milestoneId !== milestoneId) throw new MockError("validation", "report.milestoneId does not match the route", 400);
  if (!(state.assignments[projectId] ?? []).includes(report.inspector)) {
    throw new MockError("validation", `${report.inspector} is not the assigned inspector for ${project.name}`, 403);
  }
  const unknown = report.checklist.filter((c) => !milestone.sovCodes?.includes(c.sovCode)).map((c) => c.sovCode);
  if (unknown.length) throw new MockError("validation", `Checklist has SoV lines outside this milestone: ${unknown.join(", ")}`, 400);
  if (needsFor(milestone, report.inspector) === "none") {
    throw new MockError("invalid_state", `Milestone is ${milestone.status}; no audit is due from this inspector`, 409);
  }
  // Core's suite fails `inspector_audit_present` on a stale bundle; the mock refuses up front so client bugs surface here.
  if (report.evidenceBundleHash !== (await evidenceBundleHash(state.evidence[milestoneId] ?? []))) {
    throw new MockError("validation", "evidenceBundleHash does not match the builder evidence on file; reload and re-review", 400);
  }

  if (signedTxBlob) await verifyAttestation(signedTxBlob, report, photos, milestone);

  // App-signed: the attestation's hash is the signed tx's hash, as on devnet. Unsigned: core would sign with the demo key.
  const txHash = signedTxBlob ? hashes.hashSignedTx(signedTxBlob) : fx.fakeHash(`audit:${milestoneId}:${report.inspector}:${report.at}`);
  const audit: InspectorAudit = {
    ...report,
    // Core stores the uploads and serves them at /api/files/:id; mock keeps the browser's object URLs instead.
    photos: report.photos.map((p, i) => {
      const file = photos[i];
      return file && typeof URL.createObjectURL === "function" ? { ...p, uri: URL.createObjectURL(file) } : p;
    }),
    txHash,
  };

  const reAudit = state.reAudit.includes(milestoneId);
  // A re-audit supersedes the audit it replaces (INS-07); otherwise audits accumulate up to requiredInspectors.
  state.audits[milestoneId] = reAudit
    ? [...(state.audits[milestoneId] ?? []).filter((a) => a.inspector !== report.inspector), audit]
    : [...(state.audits[milestoneId] ?? []), audit];
  state.reAudit = state.reAudit.filter((id) => id !== milestoneId);
  if (reAudit || state.audits[milestoneId].length >= milestone.requiredInspectors) milestone.status = "audited";

  const event = fx.chainEvent({ projectId, milestoneId, kind: "audit_attested", actor: report.inspector, at: report.at, txHash });
  state.events.push(event);
  return settle({ milestone, audit, events: [event] });
}

/**
 * What core does with `signedTxBlob` (packages/xrpl verifyAttestBlob + the audit binding): a valid single signature by the
 * assigned inspector on a 1-drop Payment to this milestone's SPV, whose memo commits to exactly this audit. Photo hashes
 * come from the uploaded bytes, as core derives them, not from the report.
 */
async function verifyAttestation(blob: string, report: InspectorAudit, photos: Blob[], milestone: Milestone) {
  const bad = (why: string): never => {
    throw new MockError("validation", `signedTxBlob rejected: ${why}`, 400);
  };
  let tx: Transaction & { TxnSignature?: string; Signers?: unknown };
  try {
    tx = decode(blob) as unknown as typeof tx;
    verifySignedBlob(blob);
  } catch (err) {
    return bad((err as Error).message);
  }
  if (tx.TransactionType !== "Payment" || tx.Amount !== ATTEST_AMOUNT_DROPS || tx.Flags) bad("not a 1-drop attestation Payment");
  if (tx.Signers || !tx.TxnSignature) bad("must be single-signed");
  if ((tx.Memos ?? []).length !== 1) bad("exactly one memo expected");
  const att = parseAttestationTx(tx);
  if (!att) return bad("no valid xrlp/attest/v1 memo");
  if (att.signer !== report.inspector) bad(`signed by ${att.signer}, report is from ${report.inspector}`);
  if (milestone.escrow && att.destination !== milestone.escrow.owner) bad(`sent to ${att.destination}, not the project account ${milestone.escrow.owner}`);
  if (att.kind !== "audit" || att.milestoneId !== milestone.id) bad(`memo is ${att.kind} for ${att.milestoneId}`);
  const photoHashes = await Promise.all(photos.map(async (p) => ({ sha256: await sha256Hex(await p.arrayBuffer()) })));
  if (att.hash !== (await auditHash({ ...report, photos: photoHashes }))) bad("memo hash does not match this audit");
}
