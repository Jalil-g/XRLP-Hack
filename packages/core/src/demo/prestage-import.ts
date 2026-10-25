// CORE-07: load the XRPL prestage (`pnpm --filter @xrlp/xrpl prestage`, XRPL-11) into core. Devnet route 21 only;
// fake mode keeps the back-dated scenario in scenario.ts.
//
//   importPrestage()        pure store + preimage vault: no ledger writes. Validates everything first, then REPLACES the
//                           store and the vault (it is the demo seed), so a stale/missing file leaves the current state as is.
//                           Optional ledger reads check that A's / B's escrows still exist (a rehearsal may have consumed them).
//   stagePrestageEvidence() what 04 §Pre-staged adds on top of the ledger state: Project A M1 evidence + audit, M2 evidence
//                           (with a photo reused from Project C) + audit. Goes through CoreService (2 audit attestations).
//
// Prestage A/B/C -> core (docs/04-demo-script.md):
//   A "ready"   -> `escrowed`, 3 milestones `escrowed` (Maple St SoV/fixtures, prestage amounts)
//   B "stalled" -> `escrowed`, M1 `released`, M2 `escrowed` with CancelAfter past (route 13 / keeper: cancel + refund LoanPay)
//   C "repaid"  -> `completed`, all `released`, LoanPays recorded, past RedemptionDate (route 15 withdraw)
//
// Preimages are imported keyed {projectId, milestoneId} exactly like ReleaseService.conditionsForClose stores them, after
// checking conditionFromPreimage(preimage) === the escrow's condition. They are never logged or put in an error message.
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { auditMemo, buildAttestationTx, SoftwareSigner, type AuditForHash } from "@xrlp/attest-signer";
import {
  conditionFromPreimage,
  getClient,
  parsePrestageFile,
  type PrestageEscrow,
  type PrestageFile,
  type PrestageKey,
  type PrestagePreimagesFile,
  type PrestageProject,
} from "@xrlp/xrpl";
import { explorerTxUrl, type Builder, type ChainEvent, type ChainEventKind, type Inspector, type LedgerPort, type Milestone, type Project, type XrplAddress } from "@xrlp/shared";
import { FakeClock } from "../clock.ts";
import { DomainError } from "../errors.ts";
import { FakeVerifier } from "../fakes/fake-verifier.ts";
import { resolveDataDir } from "../file-store.ts";
import { canonicalJson, sha256Hex } from "../ids.ts";
import { fromMicro, sumMicro, toMicro } from "../money.ts";
import type { PreimageEntry, PreimageVault } from "../release-service.ts";
import type { CoreService, EvidenceFile } from "../service.ts";
import { emptyDb, type DbState, type EvidenceRecord, type Repayment, type Store } from "../store.ts";
import { demoPhoto, nearby } from "./fixtures.ts";
import { auditBody, DEMO, doc, invoice, mapleInput, photos, sovFromTemplate, type Log } from "./scenario.ts";

/** prestage.json paths (`preimagesFile`) are relative to the repo root. */
const REPO_ROOT = dirname(resolveDataDir({}));

export const RESTAGE_HINT = "pnpm --filter @xrlp/xrpl prestage --only A,B";
/** A's earliest CancelAfter must be at least this far out (release preflight wants >= 300 s; leave room for the demo). */
export const DEFAULT_MIN_LEAD_MS = 60 * 60_000;

export interface PrestagePaths {
  prestagePath: string;
  preimagesPath?: string;
}

/** PRESTAGE_FILE / PRESTAGE_PREIMAGES_FILE env, else `<dataDir>/prestage.json` and the file's own `preimagesFile`. */
export function prestagePathsFromEnv(env: Record<string, string | undefined>, dataDir: string): PrestagePaths {
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));
  return {
    prestagePath: env.PRESTAGE_FILE ? abs(env.PRESTAGE_FILE) : join(dataDir, "prestage.json"),
    ...(env.PRESTAGE_PREIMAGES_FILE ? { preimagesPath: abs(env.PRESTAGE_PREIMAGES_FILE) } : {}),
  };
}

export interface ImportPrestageOptions extends PrestagePaths {
  store: Store;
  /** The SAME vault instance the ReleaseService uses (factory), so released keys are found by release(). */
  vault: PreimageVault;
  /** If given, every open/expired escrow of A and B must still exist on-ledger with the same condition. */
  ledger?: Pick<LedgerPort, "getEscrow">;
  now?: () => Date;
  /** Platform address of core's wallet store (CORE-05 identities); the prestage must have used the same WALLETS_FILE. */
  walletsPlatform?: string;
  /** Expected `network` of the file (default "devnet"). */
  network?: string;
  minLeadMs?: number;
  log?: Log;
}

export interface ImportedPrestage {
  /** Prestage key -> core project id (= the prestage projectId: it is in tx Data fields and the wallet store). */
  ids: Partial<Record<PrestageKey, string>>;
  /** Donor photo (already in the store) that Project A's M2 re-uploads for the fraud beat. */
  reusedPhoto?: EvidenceFile;
  file: PrestageFile;
}

type Preimages = PrestagePreimagesFile["projects"];

const fail = (code: "VALIDATION" | "CONFLICT", msg: string): never => {
  throw new DomainError(code, `${msg}. Re-run the XRPL prestage: ${RESTAGE_HINT} (or without --only for A,B,C)`);
};

async function readJson(path: string, what: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fail("VALIDATION", `${what} not found at ${path}`);
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fail("VALIDATION", `${what} at ${path} is not valid JSON`);
  }
}

/** Reads + validates both files and builds the new DbState and vault entries. Throws DomainError (4xx) on any problem. */
export async function planPrestageImport(opts: ImportPrestageOptions): Promise<{ db: DbState; entries: PreimageEntry[]; result: ImportedPrestage }> {
  const now = (opts.now ?? (() => new Date()))();
  let file: PrestageFile;
  try {
    file = parsePrestageFile(await readJson(opts.prestagePath, "prestage.json"));
  } catch (e) {
    if (e instanceof DomainError) throw e;
    return fail("VALIDATION", `${opts.prestagePath}: ${(e as Error).message}`);
  }
  const network = opts.network ?? "devnet";
  if (file.network !== network) fail("VALIDATION", `prestage.json is for ${file.network}, core expects ${network}`);
  if (opts.walletsPlatform && file.accounts.platform !== opts.walletsPlatform)
    fail("VALIDATION", `prestage.json was made with another wallet store (platform ${file.accounts.platform}, core uses ${opts.walletsPlatform}); use the same WALLETS_FILE`);
  const preimagesPath = opts.preimagesPath ?? resolve(REPO_ROOT, file.preimagesFile);
  const pf = (await readJson(preimagesPath, "prestage-preimages.json")) as Partial<PrestagePreimagesFile>;
  if (!pf || typeof pf !== "object" || !pf.projects || typeof pf.projects !== "object") fail("VALIDATION", `${preimagesPath} has no projects`);
  const preimages = pf.projects as Preimages;

  const { A, B, C } = file.projects;
  if (!A || A.scenario !== "ready") return fail("VALIDATION", "prestage.json has no Project A (ready)");
  if (!B || B.scenario !== "stalled") return fail("VALIDATION", "prestage.json has no Project B (stalled)");
  if (C && C.scenario !== "repaid") fail("VALIDATION", `Project C is ${C.scenario}, expected repaid`);

  // ---- staleness (offline): A's escrows open and far enough from CancelAfter; B has its expired-but-open escrow
  const minLead = opts.minLeadMs ?? DEFAULT_MIN_LEAD_MS;
  for (const e of A.escrows) {
    if (e.state !== "open") fail("CONFLICT", `Project A escrow ${e.milestoneId} is ${e.state}, expected open`);
    if (Date.parse(e.cancelAfter) - now.getTime() < minLead)
      fail("CONFLICT", `Project A escrow ${e.milestoneId} CancelAfter ${e.cancelAfter} is too close (needs >= ${Math.round(minLead / 60_000)} min)`);
  }
  if (A.escrows.length !== A.milestones.length) fail("CONFLICT", "Project A has a milestone without an escrow");
  const stall = B.escrows.find((e) => e.state !== "finished" && Date.parse(e.cancelAfter) <= now.getTime());
  if (!stall) fail("CONFLICT", "Project B has no open escrow past its CancelAfter (the stall beat needs one)");
  if (C && Date.parse(C.dates.redemptionDate) > now.getTime()) fail("CONFLICT", `Project C RedemptionDate ${C.dates.redemptionDate} is not past yet (withdraw would be TOO_SOON)`);

  // ---- preimages: every unfinished escrow needs one; every present one must match its escrow's condition
  const entries: PreimageEntry[] = [];
  const conditions = new Set<string>();
  for (const p of [A, B, C]) {
    if (!p) continue;
    for (const e of p.escrows) {
      const cond = e.condition.toUpperCase();
      if (conditions.has(cond)) fail("CONFLICT", `Duplicate escrow condition (${p.key} ${e.milestoneId}); refusing to import`);
      conditions.add(cond);
      const rec = preimages[p.projectId]?.[e.milestoneId];
      if (!rec) {
        if (e.state === "finished") continue; // history only, nothing left to release
        fail("VALIDATION", `No preimage for Project ${p.key} escrow ${e.milestoneId} in ${preimagesPath}`);
      }
      if (typeof rec!.preimage !== "string" || !/^[0-9a-fA-F]{64}$/.test(rec!.preimage)) fail("VALIDATION", `Malformed preimage for ${p.key} ${e.milestoneId}`);
      const preimage = Buffer.from(rec!.preimage, "hex");
      if (conditionFromPreimage(preimage) !== cond) {
        fail("CONFLICT", `Preimage for Project ${p.key} escrow ${e.milestoneId} does not match the escrow condition; refusing to import`);
      }
      entries.push({
        projectId: p.projectId,
        milestoneId: e.milestoneId,
        condition: cond,
        preimage,
        createdAt: rec!.createdAt ?? e.createdAt ?? file.createdAt,
        ...(e.state === "finished" ? { releasedAt: file.finishedAt } : {}),
      });
    }
  }

  // ---- optional ledger reads: a rehearsal may have finished/cancelled what the file still calls open
  if (opts.ledger) {
    for (const p of [A, B]) {
      for (const e of p.escrows) {
        if (e.state === "finished") continue;
        const on = await opts.ledger.getEscrow(e.owner, e.offerSequence);
        if (!on) fail("CONFLICT", `Project ${p.key} escrow ${e.milestoneId} (${e.owner}/${e.offerSequence}) is no longer on the ledger (used by a rehearsal?)`);
        if (on!.condition && on!.condition.toUpperCase() !== e.condition.toUpperCase()) fail("CONFLICT", `Project ${p.key} escrow ${e.milestoneId}: on-ledger condition differs`);
      }
    }
  }

  // ---- DbState
  const db = emptyDb();
  const acct = (role: string): XrplAddress => {
    const a = file.accounts[role];
    if (!a) return fail("VALIDATION", `prestage.json accounts has no ${role}`);
    return a;
  };
  const builder: Builder = { ...DEMO.builders.hudson, address: A.builder || acct("builder"), verified: true, riskTier: "medium" };
  db.builders.push(builder);
  const panel: [keyof typeof DEMO.inspectors, string][] = [["dana", "inspector1"], ["tom", "inspector2"], ["lee", "inspector3"]];
  for (const [k, role] of panel) {
    const i = DEMO.inspectors[k];
    db.inspectors.push({ address: acct(role), name: i.name, licenseNumber: i.licenseNumber, trades: [...i.trades], homeGeo: i.homeGeo, verified: true } satisfies Inspector);
  }
  const kycd = new Set([A, B, C].flatMap((p) => p?.investments.map((i) => i.investor) ?? []));
  DEMO.investors.forEach((inv, i) => {
    const address = acct(`investor${i + 1}`);
    // investor3 deliberately has no KYC_INVESTOR on devnet (beat: tecNO_AUTH); route 19 can issue it live.
    db.investors.push({ address, name: inv.name, createdAt: file.createdAt, ...(kycd.has(address) ? { kycCredentialTx: "prestage" } : {}) });
  });

  const ids: ImportedPrestage["ids"] = {};
  for (const p of [A, B, C]) {
    if (!p) continue;
    ids[p.key] = p.projectId;
    addProject(db, p, builder);
  }
  await addVerifications(db, builder);

  // Donor photos for the cross-project duplicate check: released milestones' evidence (C framing, else B's first).
  let reusedPhoto: EvidenceFile | undefined;
  for (const p of [B, C]) {
    if (!p) continue;
    for (const m of p.milestones) {
      if (m.status !== "released") continue;
      const ev = donorEvidence(p, m);
      db.evidence.push(...ev.records);
      if (!reusedPhoto || m.templateKey === "framing") reusedPhoto = ev.photo;
    }
  }

  return { db, entries, result: { ids, file, ...(reusedPhoto ? { reusedPhoto } : {}) } };
}

/** Validate, then replace the store and the preimage vault with the prestaged A/B/C. Idempotent. */
export async function importPrestage(opts: ImportPrestageOptions): Promise<ImportedPrestage> {
  const plan = await planPrestageImport(opts);
  await opts.store.reset(plan.db);
  await opts.vault.save(plan.entries);
  const log = opts.log ?? (() => {});
  for (const [k, id] of Object.entries(plan.result.ids)) log(`prestage ${k}: ${id} (${plan.db.projects.find((p) => p.id === id)?.status})`);
  log(`prestage: ${plan.entries.length} escrow keys imported into the release service vault`);
  return plan.result;
}

// ---------- mapping ----------

const TX_KIND: Record<string, ChainEventKind> = {
  VaultCreate: "vault_created",
  LoanBrokerSet: "loan_broker_created",
  LoanBrokerCoverDeposit: "cover_deposited",
  VaultDeposit: "vault_deposit",
  LoanSet: "loan_set",
  EscrowCreate: "escrow_created",
  EscrowFinish: "escrow_finished",
  EscrowCancel: "escrow_cancelled",
  LoanPay: "loan_payment",
  CredentialCreate: "credential_issued",
  CredentialAccept: "credential_accepted",
};

function stepKind(type: string, step: string): ChainEventKind | undefined {
  if (type === "Payment") {
    if (/verification fee/i.test(step)) return "verification_fee_paid";
    if (/^attest audit/i.test(step)) return "audit_attested";
    if (/^attest verdict/i.test(step)) return "verdict_attested";
    if (/^attest release/i.test(step)) return "approval_attested";
    return undefined; // RLUSD top-ups, builder -> SPV funding
  }
  return TX_KIND[type];
}

const isoOr = (s: string | undefined, fallback: string) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : fallback);

function addProject(db: DbState, p: PrestageProject, builder: Builder): void {
  const isMaple = p.key === "A";
  const loanSetAt = isoOr(p.dates.loanSetAt, p.dates.subscriptionDate);
  const escrowOf = (mid: string) => p.escrows.find((e) => e.milestoneId === mid);
  const termDays = Math.max(1, Math.round((p.terms.paymentTotal * p.terms.paymentIntervalS) / 86_400));
  const milestones: Milestone[] = p.milestones.map((m) => {
    const e = escrowOf(m.id);
    const finished = e?.state === "finished" || m.status === "released";
    return {
      id: m.id,
      index: m.index,
      templateKey: m.templateKey,
      title: m.title,
      amount: m.amount,
      requiredInspectors: 1,
      status: finished ? "released" : e ? "escrowed" : "pending",
      sovCodes: [m.templateKey],
      ...(e
        ? {
            cancelAfter: new Date(e.cancelAfter).toISOString(),
            escrow: {
              owner: e.owner,
              offerSequence: e.offerSequence,
              condition: e.condition.toUpperCase(),
              createTx: e.createTx,
              createdAt: isoOr(e.createdAt, loanSetAt),
              ...(e.finishTx ? { finishTx: e.finishTx } : {}),
              ...(e.cancelTx ? { cancelTx: e.cancelTx } : {}),
            },
          }
        : {}),
    };
  });
  const project: Project = {
    id: p.projectId,
    name: isMaple ? DEMO.maple.name : p.name,
    type: p.type,
    builderId: builder.id,
    siteAddress: isMaple ? DEMO.maple.siteAddress : p.siteAddress,
    siteGeo: isMaple ? DEMO.maple.siteGeo : p.siteGeo,
    description: isMaple ? mapleInput(new Date(p.dates.subscriptionDate)).description : `${p.name} (prestaged on devnet).`,
    terms: {
      principal: p.terms.principal,
      interestRateBps: p.terms.interestRateBps,
      termDays,
      paymentIntervalDays: Math.max(1, Math.round(p.terms.paymentIntervalS / 86_400)),
      fundingDeadline: new Date(p.dates.subscriptionDate).toISOString(),
    },
    status: p.status === "completed" ? "completed" : p.status === "stalled" ? "stalled" : "escrowed",
    milestones,
    sov: sovFromTemplate(p.milestones.map((m) => ({ key: m.templateKey, amount: m.amount, title: m.title }))),
    chain: {
      spv: p.chain.spv,
      vaultId: p.chain.vaultId,
      loanBrokerId: p.chain.loanBrokerId,
      loanId: p.chain.loanId,
      shareMptIssuanceId: p.chain.shareMptIssuanceId,
      subscriptionDate: new Date(p.dates.subscriptionDate).toISOString(),
      redemptionDate: new Date(p.dates.redemptionDate).toISOString(),
    },
  };
  db.projects.push(project);

  // Onboarding + deposits happened before SubscriptionDate (prestage txs carry no timestamps).
  const fileAt = new Date(Date.parse(project.terms.fundingDeadline) - 60_000).toISOString();
  const assignTx = p.txs.find((t) => t.type === "SignerListSet")?.hash; // inspector put on the SPV signer list
  db.projectMeta.push({
    projectId: p.projectId,
    documents: mapleInput(new Date()).documents,
    createdAt: fileAt,
    verificationFee: { amount: p.verificationFee.amount, tx: p.verificationFee.txHash, at: fileAt },
    assignment: {
      inspectors: [p.assignedInspector],
      scores: { [p.assignedInspector]: 1 },
      reasons: ["prestaged: on the SPV signer list (VERIFIED_INSPECTOR)"],
      at: fileAt,
      ...(assignTx ? { tx: assignTx } : {}),
    },
    verifiedAt: fileAt,
    fundingOpenedAt: fileAt,
    escrowedAt: loanSetAt,
    ...(project.status === "completed" ? { completedAt: isoOr(p.dates.redemptionDate, loanSetAt) } : {}),
  });

  for (const inv of p.investments) db.investments.push({ projectId: p.projectId, investor: inv.investor, amount: inv.amount, tx: inv.txHash, at: fileAt });
  db.repayments.push(...repayments(p, loanSetAt));
  db.chainEvents.push(...chainEvents(p, project, loanSetAt));
}

/**
 * Route 5's report for every imported project (beat 1: identity / feasibility / capability). The XRPL prestage verifies
 * off-core and attests no project verification, so the report comes from core's deterministic mock verifier (the one fake
 * mode's maple-st seed goes through) over the imported documents, SoV and builder, dated at the import's onboarding time.
 * No txHash: nothing was attested for it. A non-pass report would contradict the imported `escrowed`/`completed` status.
 */
async function addVerifications(db: DbState, builder: Builder): Promise<void> {
  for (const project of db.projects) {
    const meta = db.projectMeta.find((m) => m.projectId === project.id)!;
    const verifier = new FakeVerifier(new FakeClock(meta.verifiedAt ?? meta.createdAt));
    const verification = await verifier.verifyProject({ project, builder, sov: project.sov ?? [], documents: meta.documents });
    if (verification.decision !== "pass") throw new Error(`prestage import: mock verification of ${project.id} is ${verification.decision} (${verification.summary})`);
    db.verifications.push({ ...verification, projectId: project.id, verificationHash: sha256Hex(canonicalJson(verification)) });
    builder.riskTier = verification.riskTier; // as route 5 does on a pass
  }
}

const loanPayAmount = (step: string) => /^LoanPay\s+(\d+(?:\.\d+)?)/.exec(step)?.[1];

/**
 * One repayment per successful SPV LoanPay (C, in practice). With a vault snapshot the total is what the vault actually
 * received (AssetsAvailable - deposits + principal: net of the broker's management fee), split evenly over the LoanPays,
 * so route 15's withdrawable amount matches the ledger. Without one, the amounts in the step labels are used.
 */
function repayments(p: PrestageProject, at: string): Repayment[] {
  const pays = p.txs.filter((t) => t.type === "LoanPay" && t.result === "tesSUCCESS" && t.hash);
  if (!pays.length) return [];
  const v = p.snapshot.vault;
  const received = v ? toMicro(v.assetsAvailable) - sumMicro(p.investments.map((i) => i.amount)) + toMicro(p.terms.principal) : 0n;
  if (v && received > 0n) {
    const each = received / BigInt(pays.length);
    return pays.map((t, i) => ({
      projectId: p.projectId,
      amount: fromMicro(i === pays.length - 1 ? received - each * BigInt(pays.length - 1) : each),
      source: "builder" as const,
      tx: t.hash,
      at,
    }));
  }
  return pays.flatMap((t) => {
    const amount = loanPayAmount(t.step);
    return amount ? [{ projectId: p.projectId, amount: fromMicro(toMicro(amount)), source: "builder" as const, tx: t.hash, at }] : [];
  });
}

function chainEvents(p: PrestageProject, project: Project, at: string): ChainEvent[] {
  const byCreate = new Map(p.escrows.map((e) => [e.createTx, e] as const));
  const byFinish = new Map(p.escrows.filter((e) => e.finishTx).map((e) => [e.finishTx!, e] as const));
  const out: ChainEvent[] = [];
  const nextFinish = (i: number): PrestageEscrow | undefined => {
    for (let j = i + 1; j < p.txs.length; j++) {
      const t = p.txs[j]!;
      if (t.type === "EscrowFinish") return byFinish.get(t.hash);
    }
    return undefined;
  };
  const investor = new Map(p.investments.map((i) => [i.txHash, i] as const));
  p.txs.forEach((t, i) => {
    const kind = stepKind(t.type, t.step);
    if (!kind || !t.hash) return;
    let milestoneId: string | undefined;
    let amount: string | undefined;
    let actor: string | undefined;
    if (kind === "escrow_created") milestoneId = byCreate.get(t.hash)?.milestoneId;
    else if (kind === "escrow_finished") milestoneId = byFinish.get(t.hash)?.milestoneId;
    else if (kind === "audit_attested" || kind === "verdict_attested" || kind === "approval_attested") milestoneId = nextFinish(i)?.milestoneId;
    const m = milestoneId ? project.milestones.find((x) => x.id === milestoneId) : undefined;
    if (m && (kind === "escrow_created" || kind === "escrow_finished")) amount = m.amount;
    if (kind === "loan_set") amount = p.terms.principal;
    if (kind === "loan_payment") amount = loanPayAmount(t.step);
    if (kind === "cover_deposited") amount = p.cover.amount;
    if (kind === "vault_deposit") {
      const inv = investor.get(t.hash);
      if (inv) [amount, actor] = [inv.amount, inv.investor];
    }
    if (kind === "escrow_finished") actor = p.builder;
    if (kind === "loan_set" || kind === "escrow_created" || kind === "loan_payment") actor = p.chain.spv;
    out.push({
      projectId: p.projectId,
      ...(milestoneId ? { milestoneId } : {}),
      kind,
      txHash: t.hash,
      explorerUrl: t.explorerUrl?.startsWith("https://") ? t.explorerUrl : explorerTxUrl(t.hash),
      ...(t.result && t.result !== "tesSUCCESS" ? { result: t.result } : {}),
      ...(actor ? { actor } : {}),
      ...(amount ? { amount: fromMicro(toMicro(amount)) } : {}),
      at,
    });
  });
  return out;
}

/** Fixture evidence of a released milestone (history for the cross-project duplicate-photo check). */
function donorEvidence(p: PrestageProject, m: PrestageProject["milestones"][number]): { records: EvidenceRecord[]; photo: EvidenceFile } {
  const e = p.escrows.find((x) => x.milestoneId === m.id);
  const created = Date.parse(isoOr(e?.createdAt, p.dates.loanSetAt));
  const takenAt = new Date(Number.isNaN(created) ? Date.parse(p.dates.subscriptionDate) : created);
  const label = `${m.title} — ${p.name}`;
  const slug = `${p.key.toLowerCase()}-${m.templateKey}`;
  const photo = demoPhoto({ label, filename: `${slug}-01.jpg`, takenAt, gps: nearby(p.siteGeo, 12), hue: 18 });
  const files: EvidenceFile[] = [photo, ...photos(p.siteGeo, label, 2, new Date(takenAt.getTime() + 60_000), slug, 18).map((f, i) => ({ ...f, filename: `${slug}-${String(i + 2).padStart(2, "0")}.jpg` })), invoice(`${slug}-invoice.pdf`, m.amount)];
  const at = new Date(takenAt.getTime() + 5 * 60_000).toISOString();
  const records = files.map((f, i) => ({
    id: `ev-prestage-${sha256Hex(`${m.id}:${i}`).slice(0, 12)}`,
    kind: f.kind,
    filename: f.filename,
    mimeType: f.mimeType,
    uri: f.uri,
    sha256: f.sha256,
    meta: f.meta ?? {},
    uploadedAt: at,
    projectId: p.projectId,
    milestoneId: m.id,
    round: 1,
  }));
  return { records, photo };
}

// ---------- signed audits (the inspector app's route 10 `signedTxBlob`) ----------

/** The unsigned attestation Payment (attest-signer's `buildAttestationTx`). */
export type AttestTx = ReturnType<typeof buildAttestationTx>;
/** Fills Fee / Sequence / LastLedgerSequence (devnet by default; tests pass an offline one). */
export type AttestAutofill = (tx: AttestTx) => Promise<AttestTx>;
/** Signs an audit's attestation as its inspector: returns the signed tx blob for route 10 / `submitAudit`. */
export type AuditBlobSigner = (audit: AuditForHash, spv: XrplAddress) => Promise<string>;

/** Ledgers of headroom between signing and core submitting the blob (the inspector app uses the same). */
const AUDIT_LLS_MARGIN = 75;

/** Autofill on devnet through @xrlp/xrpl's shared client (its devnet network-id guard applies). */
export const devnetAutofill: AttestAutofill = async (tx) => {
  const client = await getClient();
  const ledger = await client.getLedgerIndex();
  return client.autofill({ ...tx, LastLedgerSequence: ledger + AUDIT_LLS_MARGIN });
};

/**
 * The assigned inspector's software key from WALLETS_FILE (looked up by address: inspector1 in the standard prestage),
 * signing exactly what the inspector app signs (attest-signer: `auditMemo` + `buildAttestationTx`, master key): a 1-drop
 * Payment inspector -> project SPV with one `xrlp/attest/v1` audit memo whose hash is attest-signer's canonical
 * `auditHash` of the report. That is what #173's `verifyAuditBlob` checks. The seed stays in this closure: it is never
 * logged or put in an error message.
 */
export async function walletAuditSigner(walletsFile: string, inspector: XrplAddress, autofill: AttestAutofill = devnetAutofill): Promise<AuditBlobSigner> {
  const refuse = (why: string): never => {
    throw new DomainError("VALIDATION", `Cannot sign the prestaged audits as inspector ${inspector}: ${why}. Use the WALLETS_FILE the prestage was made with`);
  };
  let file: { wallets?: Record<string, { address?: string; seed?: string } | undefined> };
  try {
    file = JSON.parse(await readFile(walletsFile, "utf8"));
  } catch {
    return refuse(`WALLETS_FILE ${walletsFile} is missing or not valid JSON`);
  }
  const stored = Object.values(file.wallets ?? {}).find((w) => w?.address === inspector);
  if (!stored?.seed) return refuse(`WALLETS_FILE ${walletsFile} has no wallet for that address`);
  let signer: SoftwareSigner;
  try {
    signer = SoftwareSigner.fromSeed(stored.seed);
  } catch {
    return refuse("its WALLETS_FILE seed is malformed");
  }
  if (signer.wallet.classicAddress !== inspector) refuse("its WALLETS_FILE seed does not derive that address (master key required)");
  return async (audit, spv) => {
    const tx = await autofill(buildAttestationTx({ account: inspector, spv, memo: await auditMemo(audit) }));
    return (await signer.signAttestation(tx)).tx_blob;
  };
}

// ---------- 04 §Pre-staged evidence on Project A ----------

/**
 * Project A: M1 evidence + inspector audit, M2 evidence (one photo re-uploaded from a released milestone of another project)
 * + audit. With `signAudit` (devnet: the inspector's key from WALLETS_FILE) each audit goes through route 10's signed path,
 * as if the inspector app filed it; without one, CoreService attests it platform-submitted, `signed-for` the inspector
 * (fake demo only once #173 lands: a devnet core then refuses unsigned audits).
 */
export async function stagePrestageEvidence(svc: CoreService, imported: ImportedPrestage, log: Log = () => {}, signAudit?: AuditBlobSigner): Promise<void> {
  const id = imported.ids.A;
  if (!id) return;
  const { project } = await svc.getProject(id);
  const [m1, m2] = project.milestones;
  if (!m1 || !m2) return;
  const inspector = imported.file.projects.A!.assignedInspector;
  const created = Date.parse(m1.escrow?.createdAt ?? project.chain.subscriptionDate!);
  const now = svc.clock.now().getTime();
  // Photos must be after the escrow was created (photo_fresh) and not in the future.
  const span = Math.max(0, now - created);
  const at = (f: number) => new Date(created + Math.floor(span * f));
  const site = project.siteGeo;
  const m1Evidence = [
    ...photos(site, "Foundation — Maple St", 3, at(0.2), "foundation", 30),
    invoice("concrete-rebar-invoice.pdf", m1.amount),
    doc("footing-inspection.pdf", "Footing inspection: PASSED"),
  ];
  const spv = project.chain.spv;
  const audit = async (mid: string, body: ReturnType<typeof auditBody>) => {
    if (!signAudit) return svc.submitAudit(id, mid, body);
    if (!spv) throw new DomainError("VALIDATION", `Project ${id} has no SPV to address the audit attestation to`);
    const signedTxBlob = await signAudit({ ...body.report, milestoneId: mid, photos: body.photos }, spv);
    return svc.submitAudit(id, mid, { ...body, signedTxBlob });
  };
  await svc.submitEvidence(id, m1.id, m1Evidence);
  await audit(m1.id, auditBody(project, m1.id, inspector, m1Evidence, "Slab cured, anchor bolts set, no framing yet."));
  const m2Evidence = [
    ...photos(site, "Framing — Maple St", 3, at(0.5), "framing", 45),
    ...(imported.reusedPhoto ? [{ ...imported.reusedPhoto, filename: "IMG_2231.jpg" }] : []),
    invoice("lumber-package-invoice.pdf", m2.amount),
  ];
  await svc.submitEvidence(id, m2.id, m2Evidence);
  await audit(m2.id, auditBody(project, m2.id, inspector, m2Evidence, "Walls framed; sheathing started."));
  log(`${project.name}: M1 + M2 evidence and ${signAudit ? "inspector-signed" : "platform-attested"} audits uploaded (M2 contains IMG_2231.jpg reused from another project)`);
}

