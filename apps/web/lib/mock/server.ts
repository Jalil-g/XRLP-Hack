// In-memory stand-in for @xrlp/core's HTTP API (docs/05-api.md routes 1–23) for NEXT_PUBLIC_API_MODE=mock.
// It gates on state the way core does (invalid_state, too_soon, validation) and keeps balances as bookkeeping.
// It never decides anything: verdicts, verifications and assignments are played back from ./fixtures (MockScript).
// Vault/loan snapshots mimic devnet's cash basis: interest reaches the vault (and the share price) only on LoanPay. State lives on globalThis (shared by route handlers + server components, survives HMR).
import { explorerTxUrl } from "@xrlp/shared";
import { ApiError, type ApiRequest } from "../api";
import type {
  AuditReport,
  ChainEvent,
  ChecksStatus,
  CreateProjectInput,
  Evidence,
  EvidenceKind,
  InspectorAudit,
  InspectorTask,
  Milestone,
  PortfolioPosition,
  Project,
  ProjectDetail,
  ProjectSummary,
  Rlusd,
  TxRef,
} from "../contract";
import { fromCents, toCents } from "../utils";
import { AI_AGENT, PLATFORM, RELEASE_SERVICE, SUITE, fakeAddress, fakeHash, seed, type MockDb, type MockScript } from "./fixtures";

// ---------------------------------------------------------------- state

const g = globalThis as unknown as { __drawproofMock?: { db: MockDb; script: MockScript } };
const state = () => (g.__drawproofMock ??= seed());

const now = () => new Date().toISOString();
const DAY = 86_400_000;
const addMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const fail = (code: ConstructorParameters<typeof ApiError>[0], message: string, status = 400, txResult?: string, txHash?: string) =>
  new ApiError(code, message, status, txResult, txHash);

function emit(db: MockDb, e: Omit<ChainEvent, "txHash" | "explorerUrl" | "at"> & { at?: string }): ChainEvent {
  db.seq += 1;
  const txHash = fakeHash(`live:${db.seq}:${e.kind}:${e.projectId}:${e.milestoneId ?? ""}:${Date.now()}`);
  const ev: ChainEvent = { ...e, at: e.at ?? now(), txHash, explorerUrl: explorerTxUrl(txHash) };
  db.events.push(ev);
  return ev;
}

function project(db: MockDb, id: string): Project {
  const p = db.projects.find((x) => x.id === id);
  if (!p) throw fail("not_found", `No project ${id}`, 404);
  return p;
}

function milestone(p: Project, mid: string): Milestone {
  const m = p.milestones.find((x) => x.id === mid);
  if (!m) throw fail("not_found", `No milestone ${mid} on ${p.name}`, 404);
  return m;
}

function requireStatus<T extends string>(actual: T, allowed: T[], what: string) {
  if (!allowed.includes(actual)) throw fail("invalid_state", `${what} is ${actual.replace(/_/g, " ")}; this needs ${allowed.join(" or ").replace(/_/g, " ")}`, 409);
}

function requirePlatform(actor: unknown) {
  if (actor !== PLATFORM.address) throw fail("validation", "Only the platform account can do this", 403);
}

function requireAmount(amount: unknown): Rlusd {
  if (typeof amount !== "string" || !/^\d+(\.\d{1,6})?$/.test(amount) || toCents(amount) <= 0) throw fail("validation", "Enter an amount in RLUSD, e.g. 5000.00");
  return fromCents(toCents(amount));
}

const raisedCents = (db: MockDb, id: string) => db.investments.filter((i) => i.projectId === id).reduce((a, i) => a + toCents(i.amount), 0);
const builderOf = (db: MockDb, p: Project) => db.builders.find((b) => b.id === p.builderId)!;
const addBalance = (db: MockDb, account: string | undefined, cents: number) => {
  if (!account) return;
  db.balances[account] = fromCents(toCents(db.balances[account] ?? "0") + cents);
};
const pendingChecks = (): ChecksStatus => ({ required: [], optional: [], outcome: "pending", suite: [...SUITE] });

// ---------------------------------------------------------------- read models

function summary(db: MockDb, p: Project): ProjectSummary {
  const b = builderOf(db, p);
  const inv = db.investments.filter((i) => i.projectId === p.id);
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    status: p.status,
    siteAddress: p.siteAddress,
    principal: p.terms.principal,
    raised: fromCents(raisedCents(db, p.id)),
    investorCount: new Set(inv.map((i) => i.investor)).size,
    builderName: b.name,
    fundingDeadline: p.terms.fundingDeadline,
    verified: db.verifications[p.id]?.decision === "pass",
    interestRateBps: p.terms.interestRateBps,
    builderId: b.id,
    builderVerified: b.verified,
  };
}

function detail(db: MockDb, p: Project): ProjectDetail {
  const b = builderOf(db, p);
  const ids = new Set(p.milestones.map((m) => m.id));
  const pick = <T>(rec: Record<string, T>, fallback: () => T) => Object.fromEntries(p.milestones.map((m) => [m.id, rec[m.id] ?? fallback()]));
  const assigned = db.assignments[p.id]?.inspectors ?? [];
  return {
    project: p,
    builder: b,
    verification: db.verifications[p.id],
    inspectors: db.inspectors.filter((i) => assigned.includes(i.address)),
    investments: db.investments.filter((i) => i.projectId === p.id),
    events: db.events.filter((e) => e.projectId === p.id).sort((a, z) => z.at.localeCompare(a.at)),
    checks: pick(db.checks, pendingChecks),
    audits: pick(db.audits, () => []),
    attestations: Object.fromEntries(Object.entries(db.attestations).filter(([mid]) => ids.has(mid))),
    vault: db.vaults[p.id],
    loan: db.loans[p.id],
    evidence: pick(db.evidence, () => []),
    balances: { spv: db.balances[p.chain.spv ?? ""] ?? "0.00", builder: db.balances[b.address] ?? "0.00" },
  };
}

// ---------------------------------------------------------------- shared transitions

/** Release attestation by the release service, then EscrowFinish to the builder. */
function release(db: MockDb, p: Project, m: Milestone): { events: ChainEvent[]; release: TxRef } {
  const b = builderOf(db, p);
  const at = now();
  (db.attestations[m.id] ??= []).push({
    milestoneId: m.id,
    role: "release_service",
    kind: "release",
    hash: fakeHash(`release:${m.id}:${at}`).toLowerCase(),
    signer: RELEASE_SERVICE.address,
    decision: "approve",
    notes: "Suite green; finishing escrow",
    txHash: fakeHash(`att-release:${m.id}:${at}`),
    at,
  });
  // The release service submits the finish; the builder is the escrow's fixed destination.
  const fin = emit(db, { projectId: p.id, milestoneId: m.id, kind: "escrow_finished", actor: RELEASE_SERVICE.address, amount: m.amount });
  m.status = "released";
  if (m.escrow) m.escrow.finishTx = fin.txHash;
  addBalance(db, b.address, toCents(m.amount));
  if (p.milestones.every((x) => x.status === "released" || x.status === "refunded")) p.status = "repaying";
  return { events: [fin], release: { txHash: fin.txHash, explorerUrl: fin.explorerUrl } };
}

function cancel(db: MockDb, p: Project, m: Milestone): ChainEvent[] {
  const c = emit(db, { projectId: p.id, milestoneId: m.id, kind: "escrow_cancelled", actor: RELEASE_SERVICE.address, amount: m.amount });
  const pay = emit(db, { projectId: p.id, milestoneId: m.id, kind: "loan_payment", actor: p.chain.spv, amount: m.amount });
  m.status = "refunded";
  if (m.escrow) m.escrow.cancelTx = c.txHash;
  const v = db.vaults[p.id];
  if (v) v.assetsAvailable = fromCents(toCents(v.assetsAvailable) + toCents(m.amount));
  const l = db.loans[p.id];
  if (l) {
    l.principalOutstanding = fromCents(Math.max(0, toCents(l.principalOutstanding) - toCents(m.amount)));
    l.totalValueOutstanding = fromCents(Math.max(0, toCents(l.totalValueOutstanding) - toCents(m.amount)));
  }
  p.status = "stalled";
  return [c, pay];
}

// ---------------------------------------------------------------- multipart → plain body

type Upload = { name: string; type: string; size: number; dataUrl?: string };

async function toUpload(f: File): Promise<Upload> {
  const out: Upload = { name: f.name, type: f.type || "application/octet-stream", size: f.size };
  if (f.type.startsWith("image/") && f.size <= 1_500_000) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.dataUrl = `data:${f.type};base64,${btoa(bin)}`;
  }
  return out;
}

async function fromForm(form: FormData) {
  const files = await Promise.all(form.getAll("files[]").filter((v): v is File => v instanceof File).map(toUpload));
  const photos = await Promise.all(form.getAll("photos[]").filter((v): v is File => v instanceof File).map(toUpload));
  return {
    files,
    kind: form.getAll("kind[]").map(String),
    report: form.get("report")?.toString(),
    photos,
    signedTxBlob: form.get("signedTxBlob")?.toString(),
  };
}

function uploadToEvidence(u: Upload, id: string, kind: EvidenceKind, at: string): Evidence {
  const art = kind === "photo" ? "/evidence/foundation-1.svg" : kind === "invoice" ? "/evidence/invoice-1.svg" : "/evidence/document-1.svg";
  return {
    id,
    kind,
    filename: u.name,
    mimeType: u.type,
    uri: u.dataUrl ?? art,
    sha256: fakeHash(`upload:${u.name}:${u.size}`).toLowerCase(),
    meta: {},
    uploadedAt: at,
  };
}

// ---------------------------------------------------------------- routes

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are validated per route
type Body = any;
type Route = [method: "GET" | "POST", pattern: RegExp, handler: (db: MockDb, script: MockScript, params: string[], body: Body, query: URLSearchParams) => unknown];

const KINDS: EvidenceKind[] = ["photo", "invoice", "document", "inspector_report"];

const routes: Route[] = [
  // 1
  ["GET", /^\/api\/projects$/, (db, _s, _p, _b, q) => {
    const status = q.get("status");
    const listed = (p: Project) => (status === "verified" ? !["draft", "verifying", "rejected"].includes(p.status) : !status || p.status === status);
    return db.projects.filter(listed).map((p) => summary(db, p));
  }],
  // 2
  ["GET", /^\/api\/projects\/([^/]+)$/, (db, _s, [id]) => detail(db, project(db, id!))],
  // 3
  ["POST", /^\/api\/projects$/, (db, _s, _p, body: CreateProjectInput) => {
    if (!body?.name?.trim()) throw fail("validation", "Give the project a name");
    if (!db.builders.some((b) => b.id === body.builderId)) throw fail("validation", "Unknown builder");
    if (!Array.isArray(body.sov) || body.sov.length === 0) throw fail("validation", "Add at least one Schedule of Values line");
    const base = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
    let id = base;
    for (let n = 2; db.projects.some((p) => p.id === id); n++) id = `${base}-${n}`;
    const p: Project = {
      id,
      name: body.name.trim(),
      type: body.type,
      builderId: body.builderId,
      siteAddress: body.siteAddress,
      siteGeo: body.siteGeo,
      description: body.description,
      terms: body.terms,
      status: "draft",
      sov: body.sov,
      // Mock maps SoV lines 1:1 to milestones; core/verifier owns the real grouping.
      milestones: body.sov.map((l, i) => ({ id: `${id}-m${i + 1}`, index: i, templateKey: l.code, title: l.title, amount: l.amount, sovCodes: [l.code], requiredInspectors: 1, status: "pending" })),
      chain: {},
    };
    db.projects.push(p);
    return p;
  }],
  // 4
  ["POST", /^\/api\/projects\/([^/]+)\/verification-fee$/, (db, _s, [id], body) => {
    const p = project(db, id!);
    requireStatus(p.status, ["draft"], p.name);
    const b = builderOf(db, p);
    if (body?.builder !== b.address) throw fail("validation", `The fee is paid from ${b.name}'s account`);
    const ev = emit(db, { projectId: p.id, kind: "verification_fee_paid", actor: b.address, amount: "250.00" });
    addBalance(db, b.address, -25_000);
    p.status = "verifying";
    return { project: p, events: [ev] };
  }],
  // 5
  ["POST", /^\/api\/projects\/([^/]+)\/verify-project$/, (db, s, [id]) => {
    const p = project(db, id!);
    requireStatus(p.status, ["verifying"], p.name);
    const verification = (s.verifications[p.id] ?? s.genericVerification)(now());
    db.verifications[p.id] = verification;
    const events = [emit(db, { projectId: p.id, kind: "project_verified", actor: PLATFORM.address })];
    const b = builderOf(db, p);
    if (verification.decision === "pass" && !b.verified) {
      const issued = emit(db, { projectId: p.id, kind: "credential_issued", actor: PLATFORM.address });
      events.push(issued, emit(db, { projectId: p.id, kind: "credential_accepted", actor: b.address }));
      b.verified = true;
      b.credentialTx = issued.txHash;
    }
    if (verification.decision === "pass") p.status = "verified";
    if (verification.decision === "fail") p.status = "rejected";
    return { verification, project: p, events };
  }],
  // 6
  ["POST", /^\/api\/projects\/([^/]+)\/lock-terms$/, (db, s, [id], body) => {
    const p = project(db, id!);
    requirePlatform(body?.actor);
    requireStatus(p.status, ["verified"], p.name);
    const assignment = s.assignments[p.id] ?? s.genericAssignment;
    db.assignments[p.id] = assignment;
    p.chain = {
      spv: fakeAddress(`spv:${p.id}`),
      vaultId: fakeHash(`vault:${p.id}`),
      loanBrokerId: fakeHash(`broker:${p.id}`),
      shareMptIssuanceId: fakeHash(`mpt:${p.id}`).slice(0, 48),
    };
    db.balances[p.chain.spv!] = "0.00";
    // Demo subscription window, like the devnet script's DEMO_SUBSCRIPTION_S.
    db.vaults[p.id] = {
      assetsTotal: "0.00",
      assetsAvailable: "0.00",
      sharesOutstanding: "0.000000",
      sharePrice: "1.000000",
      subscriptionDate: addMs(60_000),
      redemptionDate: addMs((p.terms.termDays + 30) * DAY),
      phase: "subscription",
    };
    const cover = fromCents(Math.round(toCents(p.terms.principal) / 10));
    const events = [
      emit(db, { projectId: p.id, kind: "inspector_assigned", actor: PLATFORM.address }),
      emit(db, { projectId: p.id, kind: "vault_created", actor: PLATFORM.address }),
      emit(db, { projectId: p.id, kind: "loan_broker_created", actor: PLATFORM.address }),
      emit(db, { projectId: p.id, kind: "cover_deposited", actor: PLATFORM.address, amount: cover }),
    ];
    for (const m of p.milestones) db.checks[m.id] = pendingChecks();
    p.status = "funding";
    return { project: p, assignment, events };
  }],
  // 7
  ["POST", /^\/api\/projects\/([^/]+)\/investments$/, (db, _s, [id], body) => {
    const p = project(db, id!);
    requireStatus(p.status, ["funding"], p.name);
    const inv = db.parties.find((x) => x.address === body?.investor && x.role === "investor");
    if (!inv) throw fail("validation", "Unknown investor account");
    const amount = requireAmount(body?.amount);
    if (!inv.kyc) {
      throw fail("ledger_error", `${inv.name} has no KYC_INVESTOR credential, so the vault refused the deposit`, 400, "tecNO_AUTH", fakeHash(`noauth:${inv.address}:${Date.now()}`));
    }
    const remaining = toCents(p.terms.principal) - raisedCents(db, p.id);
    if (toCents(amount) > remaining) throw fail("validation", `Only ${fromCents(remaining)} RLUSD is left to raise`);
    const ev = emit(db, { projectId: p.id, kind: "vault_deposit", actor: inv.address, amount });
    const investment = { projectId: p.id, investor: inv.address, amount, tx: ev.txHash, at: ev.at };
    db.investments.push(investment);
    const h = (db.holdings[p.id] ??= {});
    h[inv.address] = (Number(h[inv.address] ?? 0) + Number(amount)).toFixed(6);
    const v = db.vaults[p.id];
    if (v) {
      v.assetsTotal = fromCents(toCents(v.assetsTotal) + toCents(amount));
      v.assetsAvailable = fromCents(toCents(v.assetsAvailable) + toCents(amount));
      v.sharesOutstanding = (Number(v.sharesOutstanding) + Number(amount)).toFixed(6);
    }
    if (raisedCents(db, p.id) >= toCents(p.terms.principal)) p.status = "funded";
    return { investment, events: [ev] };
  }],
  // 8
  ["POST", /^\/api\/projects\/([^/]+)\/close$/, (db, s, [id], body) => {
    const p = project(db, id!);
    requirePlatform(body?.actor);
    requireStatus(p.status, ["funding", "funded"], p.name);
    const v = db.vaults[p.id];
    if (v && Date.now() < Date.parse(v.subscriptionDate)) throw fail("too_soon", `Funding is open until ${fmtDate(v.subscriptionDate)}; the loan can close after that`, 409, "tecTOO_SOON");
    const raised = raisedCents(db, p.id);
    if (raised < toCents(p.terms.principal)) throw fail("invalid_state", `Raised ${fromCents(raised)} of ${p.terms.principal} RLUSD; the loan closes only when fully funded`, 409);
    p.chain.loanId = fakeHash(`loan:${p.id}`);
    const events = [emit(db, { projectId: p.id, kind: "loan_set", actor: PLATFORM.address, amount: p.terms.principal })];
    p.milestones.forEach((m, i) => {
      const createTx = fakeHash(`escrow:${m.id}:${Date.now()}`);
      m.escrow = { owner: p.chain.spv!, offerSequence: 1201 + i * 2, condition: `A0258020${fakeHash(`cond:${m.id}`)}810120`, createTx };
      m.cancelAfter = addMs((i + 1) * 60 * DAY);
      m.status = "escrowed";
      events.push(emit(db, { projectId: p.id, milestoneId: m.id, kind: "escrow_created", actor: p.chain.spv, amount: m.amount }));
      m.escrow.createTx = events[events.length - 1]!.txHash;
    });
    if (v) {
      // Devnet: AssetsTotal stays at principal after LoanSet; the money is lent out, so nothing is available.
      v.phase = "investment";
      v.assetsAvailable = "0.00";
    }
    const periods = Math.max(2, Math.ceil(p.terms.termDays / p.terms.paymentIntervalDays));
    const total = toCents(p.terms.principal) + Math.round((toCents(p.terms.principal) * p.terms.interestRateBps * p.terms.termDays) / (10_000 * 365));
    db.loans[p.id] = {
      principalOutstanding: p.terms.principal,
      totalValueOutstanding: fromCents(total),
      periodicPayment: fromCents(Math.round(total / periods)),
      paymentRemaining: periods,
      nextPaymentDueDate: addMs(p.terms.paymentIntervalDays * DAY),
    };
    p.status = "escrowed";
    return { project: p, events };
  }],
  // 9
  ["POST", /^\/api\/projects\/([^/]+)\/milestones\/([^/]+)\/evidence$/, (db, _s, [id, mid], body: { files?: Upload[]; kind?: string[] }) => {
    const p = project(db, id!);
    const m = milestone(p, mid!);
    requireStatus(m.status, ["escrowed", "evidence_submitted", "failed"], m.title);
    const files = body?.files ?? [];
    if (!files.length) throw fail("validation", "Attach at least one file");
    const at = now();
    const added = files.map((f, i) => {
      const kind = (KINDS.includes(body.kind?.[i] as EvidenceKind) ? body.kind![i] : "photo") as EvidenceKind;
      db.seq += 1;
      return uploadToEvidence(f, `${m.id}-u${db.seq}`, kind, at);
    });
    db.evidence[m.id] = m.status === "failed" ? added : [...(db.evidence[m.id] ?? []), ...added];
    if (m.status === "failed") {
      db.checks[m.id] = pendingChecks();
      db.resubmitted[m.id] = true;
    }
    m.status = (db.audits[m.id]?.length ?? 0) > 0 && m.status !== "failed" ? "audited" : "evidence_submitted";
    return { milestone: m, evidence: added };
  }],
  // 10
  ["POST", /^\/api\/projects\/([^/]+)\/milestones\/([^/]+)\/audit$/, (db, _s, [id, mid], body: { report?: string; photos?: Upload[] }) => {
    const p = project(db, id!);
    const m = milestone(p, mid!);
    requireStatus(m.status, ["evidence_submitted", "audited", "failed"], m.title);
    let report: AuditReport;
    try {
      report = JSON.parse(body?.report ?? "") as AuditReport;
    } catch {
      throw fail("validation", "The audit report is not valid JSON");
    }
    if (!db.assignments[p.id]?.inspectors.includes(report.inspector)) throw fail("validation", "Only the assigned inspector can file this audit", 403);
    const ev = emit(db, { projectId: p.id, milestoneId: m.id, kind: "audit_attested", actor: report.inspector });
    const photos = (body.photos ?? []).map((u, i) => uploadToEvidence(u, `${m.id}-a${db.seq}-${i}`, "photo", ev.at));
    const audit: InspectorAudit = { ...report, milestoneId: m.id, photos, txHash: ev.txHash, at: ev.at };
    (db.audits[m.id] ??= []).push(audit);
    (db.attestations[m.id] ??= []).push({
      milestoneId: m.id,
      role: "inspector",
      kind: "audit",
      hash: fakeHash(`audit:${m.id}:${ev.at}`).toLowerCase(),
      signer: report.inspector,
      decision: "approve",
      notes: report.notes,
      txHash: ev.txHash,
      at: ev.at,
    });
    m.status = "audited";
    return { milestone: m, audit, events: [ev] };
  }],
  // 11
  ["POST", /^\/api\/projects\/([^/]+)\/milestones\/([^/]+)\/run-checks$/, (db, s, [id, mid]) => {
    const p = project(db, id!);
    const m = milestone(p, mid!);
    requireStatus(m.status, ["evidence_submitted", "audited", "failed"], m.title);
    const at = now();
    const hasAudit = (db.audits[m.id]?.length ?? 0) > 0;
    // Canned playback: missing audit → fail; a resubmission after a fail → pass; otherwise the milestone's fixture verdict.
    const result = !hasAudit ? s.missingAudit(p, m, at) : db.resubmitted[m.id] ? s.genericPass(p, m, at) : (s.verdicts[m.id]?.(at) ?? s.genericPass(p, m, at));
    db.checks[m.id] = result;
    const verdict = result.verdict!;
    const v = emit(db, { projectId: p.id, milestoneId: m.id, kind: "verdict_attested", actor: AI_AGENT.address });
    (db.attestations[m.id] ??= []).push({
      milestoneId: m.id,
      role: "ai_agent",
      kind: "verdict",
      hash: fakeHash(`verdict:${m.id}:${at}`).toLowerCase(),
      signer: AI_AGENT.address,
      decision: verdict.decision === "pass" ? "approve" : "reject",
      notes: verdict.summary,
      txHash: v.txHash,
      at,
    });
    if (verdict.decision === "pass") {
      const r = release(db, p, m);
      return { verdict, release: r.release, events: [v, ...r.events] };
    }
    m.status = verdict.decision === "fail" ? "failed" : "needs_human";
    return { verdict, events: [v] };
  }],
  // 12
  ["POST", /^\/api\/projects\/([^/]+)\/milestones\/([^/]+)\/decision$/, (db, _s, [id, mid], body) => {
    const p = project(db, id!);
    const m = milestone(p, mid!);
    requirePlatform(body?.actor);
    requireStatus(m.status, ["needs_human"], m.title);
    if (body?.decision !== "approve" && body?.decision !== "reject") throw fail("validation", "Decision must be approve or reject");
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) throw fail("validation", "Write the reason; it is attested on-chain with the decision");
    const ev = emit(db, { projectId: p.id, milestoneId: m.id, kind: "decision_attested", actor: PLATFORM.address });
    (db.attestations[m.id] ??= []).push({
      milestoneId: m.id,
      role: "platform",
      kind: "decision",
      hash: fakeHash(`decision:${m.id}:${ev.at}`).toLowerCase(),
      signer: PLATFORM.address,
      decision: body.decision,
      notes: reason,
      txHash: ev.txHash,
      at: ev.at,
    });
    if (body.decision === "approve") return { milestone: m, events: [ev, ...release(db, p, m).events] };
    m.status = "failed";
    return { milestone: m, events: [ev] };
  }],
  // 13
  ["POST", /^\/api\/projects\/([^/]+)\/milestones\/([^/]+)\/cancel$/, (db, _s, [id, mid]) => {
    const p = project(db, id!);
    const m = milestone(p, mid!);
    requireStatus(m.status, ["expired"], m.title);
    return { milestone: m, events: cancel(db, p, m) };
  }],
  // 14
  ["POST", /^\/api\/projects\/([^/]+)\/repayments$/, (db, _s, [id], body) => {
    const p = project(db, id!);
    requireStatus(p.status, ["escrowed", "repaying", "stalled"], p.name);
    const amount = requireAmount(body?.amount);
    const ev = emit(db, { projectId: p.id, kind: "loan_payment", actor: p.chain.spv, amount });
    addBalance(db, builderOf(db, p).address, -toCents(amount));
    const v = db.vaults[p.id];
    const l = db.loans[p.id];
    // Split the payment pro rata between interest and principal still owed (ledger stand-in). Devnet books the interest
    // into AssetsTotal on LoanPay, which is what moves the share price.
    const owed = l ? toCents(l.totalValueOutstanding) : 0;
    const interestCents = l && owed > 0 ? Math.round((toCents(amount) * (owed - toCents(l.principalOutstanding))) / owed) : 0;
    if (l) {
      l.totalValueOutstanding = fromCents(Math.max(0, owed - toCents(amount)));
      l.principalOutstanding = fromCents(Math.max(0, toCents(l.principalOutstanding) - (toCents(amount) - interestCents)));
      l.paymentRemaining = Math.max(0, l.paymentRemaining - 1);
    }
    if (v) {
      v.assetsAvailable = fromCents(toCents(v.assetsAvailable) + toCents(amount));
      v.assetsTotal = fromCents(toCents(v.assetsTotal) + interestCents);
      const shares = Number(v.sharesOutstanding);
      if (shares > 0) v.sharePrice = (toCents(v.assetsTotal) / 100 / shares).toFixed(6);
    }
    return { project: p, events: [ev] };
  }],
  // 15
  ["POST", /^\/api\/projects\/([^/]+)\/withdrawals$/, (db, _s, [id], body) => {
    const p = project(db, id!);
    const v = db.vaults[p.id];
    if (!v) throw fail("invalid_state", `${p.name} has no vault yet`, 409);
    if (Date.now() < Date.parse(v.redemptionDate)) throw fail("too_soon", `Withdrawals open on ${fmtDate(v.redemptionDate)}`, 409, "tecTOO_SOON");
    const amount = requireAmount(body?.amount);
    const shares = Number(db.holdings[p.id]?.[body?.investor] ?? 0);
    const sharesOut = Number(amount) / Number(v.sharePrice);
    if (sharesOut > shares + 1e-6) throw fail("validation", "That is more than your position is worth");
    if (toCents(amount) > toCents(v.assetsAvailable)) throw fail("invalid_state", `Only ${v.assetsAvailable} RLUSD is available in the vault right now`, 409);
    const ev = emit(db, { projectId: p.id, kind: "vault_withdraw", actor: body.investor, amount });
    db.holdings[p.id]![body.investor] = Math.max(0, shares - sharesOut).toFixed(6);
    v.assetsAvailable = fromCents(toCents(v.assetsAvailable) - toCents(amount));
    v.assetsTotal = fromCents(Math.max(0, toCents(v.assetsTotal) - toCents(amount)));
    v.sharesOutstanding = Math.max(0, Number(v.sharesOutstanding) - sharesOut).toFixed(6);
    return { events: [ev] };
  }],
  // 16
  ["GET", /^\/api\/projects\/([^/]+)\/events$/, (db, _s, [id]) => db.events.filter((e) => e.projectId === project(db, id!).id).sort((a, z) => z.at.localeCompare(a.at))],
  // 17
  ["GET", /^\/api\/builders$/, (db) => db.builders],
  ["GET", /^\/api\/builders\/([^/]+)$/, (db, _s, [id]) => {
    const b = db.builders.find((x) => x.id === id);
    if (!b) throw fail("not_found", `No builder ${id}`, 404);
    return b;
  }],
  // 18
  ["GET", /^\/api\/inspectors$/, (db) => db.inspectors],
  ["GET", /^\/api\/inspectors\/([^/]+)\/queue$/, (db, _s, [address]) => {
    const tasks: InspectorTask[] = [];
    for (const p of db.projects) {
      if (!db.assignments[p.id]?.inspectors.includes(address!)) continue;
      for (const m of p.milestones) {
        const needs = m.status === "evidence_submitted" ? "audit" : m.status === "failed" ? "re_audit" : "none";
        if (needs === "none" && m.status !== "audited") continue;
        tasks.push({ projectId: p.id, projectName: p.name, milestone: m, sov: (p.sov ?? []).filter((l) => (m.sovCodes ?? []).includes(l.code)), evidence: db.evidence[m.id] ?? [], needs, siteGeo: p.siteGeo, priorAudits: db.audits[m.id] ?? [] });
      }
    }
    return tasks;
  }],
  // 19
  ["POST", /^\/api\/investors\/([^/]+)\/kyc$/, (db, _s, [address]) => {
    const inv = db.parties.find((x) => x.address === address && x.role === "investor");
    if (!inv) throw fail("not_found", "Unknown investor", 404);
    if (inv.kyc) throw fail("invalid_state", `${inv.name} already holds KYC_INVESTOR`, 409);
    inv.kyc = true;
    inv.detail = "KYC_INVESTOR";
    return { events: [emit(db, { projectId: "platform", kind: "credential_issued", actor: PLATFORM.address }), emit(db, { projectId: "platform", kind: "credential_accepted", actor: inv.address })] };
  }],
  // 20
  ["GET", /^\/api\/portfolio\/([^/]+)$/, (db, _s, [investor]) => {
    const out: PortfolioPosition[] = [];
    for (const p of db.projects) {
      const shares = Number(db.holdings[p.id]?.[investor!] ?? 0);
      const v = db.vaults[p.id];
      if (!shares || !v) continue;
      out.push({ projectId: p.id, projectName: p.name, shares: shares.toFixed(6), value: (shares * Number(v.sharePrice)).toFixed(2), phase: v.phase, redemptionDate: v.redemptionDate });
    }
    return out;
  }],
  // 21
  ["POST", /^\/api\/admin\/demo\/reset$/, () => {
    g.__drawproofMock = seed();
    return { ok: true };
  }],
  // 22
  ["POST", /^\/api\/admin\/keeper\/tick$/, (db) => {
    const events: ChainEvent[] = [];
    for (const p of db.projects) for (const m of p.milestones) if (m.status === "expired") events.push(...cancel(db, p, m));
    return { events };
  }],
  // 23
  ["POST", /^\/api\/admin\/demo\/try-steal\/([^/]+)\/([^/]+)$/, (db, _s, [id, mid]) => {
    const p = project(db, id!);
    const m = milestone(p, mid!);
    if (!m.escrow || m.escrow.finishTx || m.escrow.cancelTx) throw fail("invalid_state", `${m.title} has no open escrow to try`, 409);
    const ev = emit(db, { projectId: p.id, milestoneId: m.id, kind: "release_refused", actor: PLATFORM.address, amount: m.amount, result: "tecCRYPTOCONDITION_ERROR" });
    return { result: "tecCRYPTOCONDITION_ERROR", txHash: ev.txHash, explorerUrl: ev.explorerUrl };
  }],
  // PROPOSED (#53)
  ["GET", /^\/api\/admin\/demo\/parties$/, (db) => db.parties],
];

export async function handleMock(req: ApiRequest): Promise<unknown> {
  const url = new URL(req.path, "http://mock.local");
  const body = req.body instanceof FormData ? await fromForm(req.body) : req.body;
  const { db, script } = state();
  for (const [method, pattern, handler] of routes) {
    if (method !== req.method) continue;
    const match = pattern.exec(url.pathname);
    if (!match) continue;
    const params = match.slice(1).map((s) => decodeURIComponent(s));
    return structuredClone(handler(db, script, params, body ?? {}, url.searchParams));
  }
  throw fail("not_found", `No mock route for ${req.method} ${url.pathname}`, 404);
}

/** GET /api/files/:fileId in mock mode: find the evidence / audit photo by id. */
export function mockFile(fileId: string): Evidence | undefined {
  const { db } = state();
  for (const list of Object.values(db.evidence)) {
    const hit = list.find((e) => e.id === fileId);
    if (hit) return hit;
  }
  for (const list of Object.values(db.audits)) for (const a of list) for (const e of a.photos) if (e.id === fileId) return e;
  return undefined;
}
