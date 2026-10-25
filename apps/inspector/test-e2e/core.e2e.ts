// Integration test: inspector app client (http mode) -> a running core -> (devnet). Run before the demo:
//   pnpm --filter @xrlp/inspector test:e2e            (CORE_URL defaults to http://localhost:4000)
//   INSPECTOR_SEED=s... pnpm --filter @xrlp/inspector test:e2e   (adds the devnet tier, once core runs LEDGER_MODE=devnet)
//
// WARNING: resets core's demo data (POST /api/admin/demo/reset {seed:"maple-st"}) before each case and at the end.
// Not part of `pnpm test`: it needs a live core. Every case skips, with the reason, when what it needs is unavailable.
//
// Maple M1's audit is pre-staged in core's seed (demo script) and its suite passes and releases it, so a live audit is
// exercised on M3: the test uploads builder evidence (route 9, acting as the builder), which opens an audit for Dana.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it, type TestContext } from "node:test";
import { SoftwareSigner, auditHash, buildAttestationTx, auditMemo } from "@xrlp/attest-signer";
import { Client, Wallet, isValidClassicAddress } from "xrpl";

process.env.NEXT_PUBLIC_API_MODE = "http";
const CORE = (process.env.CORE_URL ?? "http://localhost:4000").replace(/\/$/, "");
process.env.CORE_URL = CORE;
const WS = process.env.XRPL_WS_URL ?? "wss://s.devnet.rippletest.net:51233";
process.env.NEXT_PUBLIC_XRPL_WS_URL = WS;

const { api, ApiError } = await import("../lib/api.ts");
const { buildAudit, emptyDraft, photoEvidence, sha256Hex } = await import("../lib/audit.ts");
const { signAuditAttestation } = await import("../lib/signing.ts");
type InspectorTask = import("../lib/types.ts").InspectorTask;
type Inspector = import("../lib/types.ts").Inspector;

const PROJECT = "maple-st-duplex";
const PHOTO = readFileSync(new URL("../test/fixtures/audit-foundation-02-site.jpg", import.meta.url));

// ---------------------------------------------------------------- environment probes

async function coreUnreachable(): Promise<string | null> {
  try {
    const res = await fetch(`${CORE}/api/inspectors`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? null : `core at ${CORE} answered HTTP ${res.status}`;
  } catch (err) {
    return `core unreachable at ${CORE} (${(err as Error).message}). Start it: DATA_DIR=/tmp/core-data pnpm --filter @xrlp/core serve`;
  }
}

async function devnetUnreachable(): Promise<string | null> {
  const client = new Client(WS, { connectionTimeout: 8000 });
  try {
    await client.connect();
    return null;
  } catch (err) {
    return `devnet unreachable at ${WS} (${(err as Error).message})`;
  } finally {
    await client.disconnect().catch(() => {});
  }
}

let coreSkip: string | null = null;
let dana: Inspector | undefined;

async function post(path: string, body: unknown) {
  const res = await fetch(`${CORE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => undefined)) as unknown;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const resetDemo = () => post("/api/admin/demo/reset", { seed: "maple-st" });

/** Fresh seed + builder evidence on Maple M3 (route 9) -> Dana's audit task for it (route 18). */
async function openAudit(): Promise<InspectorTask & { milestone: NonNullable<InspectorTask["milestone"]> }> {
  await resetDemo();
  const detail = await api.getProject(PROJECT);
  const m3 = detail.project.milestones.find((m) => m.status === "escrowed");
  assert.ok(m3, "core's maple-st seed should leave a milestone escrowed (M3) for a live audit");
  const form = new FormData();
  form.append("files", new Blob([PHOTO], { type: "image/jpeg" }), "builder-site.jpg");
  form.append("kind", "photo");
  form.append("files", new Blob(["Atlantic Lumber Supply\nTotal: 36,000.00 RLUSD\n"], { type: "text/plain" }), "invoice.txt");
  form.append("kind", "invoice");
  const res = await fetch(`${CORE}/api/projects/${PROJECT}/milestones/${encodeURIComponent(m3.id)}/evidence`, { method: "POST", body: form });
  assert.equal(res.status, 200, `route 9 evidence upload: ${await res.clone().text()}`);
  const task = (await api.getQueue(dana!.address)).find((t) => t.milestone?.id === m3.id);
  assert.ok(task?.milestone, `route 18: Dana should have a task for ${m3.id}`);
  assert.equal(task.needs, "audit", "route 18: builder evidence should put an audit due for Dana");
  return task as InspectorTask & { milestone: NonNullable<InspectorTask["milestone"]> };
}

async function auditFor(task: Awaited<ReturnType<typeof openAudit>>) {
  const file = new Blob([PHOTO], { type: "image/jpeg" });
  const draft = {
    ...emptyDraft(task),
    checklist: Object.fromEntries(task.sov.map((l) => [l.code, { status: "done" as const, note: "" }])),
    photos: [{ file, evidence: await photoEvidence(file, new Date().toISOString()) }],
    notes: "Integration test audit.",
  };
  return { report: await buildAudit(task, dana!.address, draft, new Date().toISOString()), file };
}

async function runChecks(milestoneId: string) {
  await post(`/api/projects/${PROJECT}/milestones/${encodeURIComponent(milestoneId)}/run-checks`, {});
  const checks = (await api.getProject(PROJECT)).checks[milestoneId];
  assert.ok(checks, "route 2 should carry the milestone's checks after route 11");
  return Object.fromEntries([...checks.required, ...checks.optional].map((c) => [c.check, c]));
}

before(async () => {
  coreSkip = await coreUnreachable();
  if (coreSkip) return;
  dana = (await api.listInspectors()).find((i) => /^Dana/.test(i.name));
  if (!dana) coreSkip = "core's inspector panel has no Dana (expected after demo/reset seed maple-st)";
});

after(async () => {
  if (!coreSkip) await resetDemo().catch(() => {});
});

function needCore(t: TestContext): boolean {
  if (coreSkip) t.skip(coreSkip);
  return !coreSkip;
}

// ---------------------------------------------------------------- tier 1: app -> core (any ledger mode)

describe("inspector app -> core (http mode)", () => {
  it("files an audit through route 10 and core's suite passes inspector_audit_present + audit_checklist_complete", async (t) => {
    if (!needCore(t)) return;
    const task = await openAudit();
    const { report, file } = await auditFor(task);
    const res = await api.submitAudit({ projectId: PROJECT, milestoneId: task.milestone.id, report, photos: [file] });
    assert.equal(res.milestone.status, "audited");
    assert.match(res.audit.txHash ?? "", /^[0-9A-F]{64}$/i, "core should record the audit attestation tx hash");
    assert.equal(res.audit.evidenceBundleHash, report.evidenceBundleHash);
    const checks = await runChecks(task.milestone.id);
    assert.equal(checks.inspector_audit_present?.result, "pass", checks.inspector_audit_present?.reason);
    assert.equal(checks.audit_checklist_complete?.result, "pass", checks.audit_checklist_complete?.reason);
  });

  it("core rejects an audit attestation that the assigned inspector did not sign", async (t) => {
    if (!needCore(t)) return;
    const task = await openAudit();
    const { report, file } = await auditFor(task);
    // A valid XRPL-08 attestation for this audit, signed by someone who is not Dana.
    const stranger = Wallet.generate();
    const spv = Wallet.generate().classicAddress; // core's fake-mode SPV is not a real account; any 1-drop target works here
    const memo = await auditMemo({ ...report, inspector: stranger.classicAddress });
    const blob = (
      await new SoftwareSigner(stranger).signAttestation({
        ...buildAttestationTx({ account: stranger.classicAddress, spv, memo }),
        Fee: "12",
        Sequence: 1,
        LastLedgerSequence: 100_000_000,
      })
    ).tx_blob;
    await assert.rejects(
      api.submitAudit({ projectId: PROJECT, milestoneId: task.milestone.id, report, photos: [file], signedTxBlob: blob }),
      (e) => e instanceof ApiError && e.code === "validation",
      "core must verify signedTxBlob (signer = report.inspector, destination = SPV, memo hash = audit) before accepting it",
    );
  });
});

// ---------------------------------------------------------------- tier 2: app -> core -> devnet, signed by Dana

describe("inspector app -> core -> devnet (signed with Dana's seed)", () => {
  let skip: string | null = null;
  let signer: SoftwareSigner | undefined;

  before(async () => {
    if (coreSkip) return void (skip = coreSkip);
    if (!isValidClassicAddress(dana!.address)) {
      return void (skip =
        `core is in fake ledger mode: its inspectors are not real accounts (${dana!.address}). ` +
        `Needs core with LEDGER_MODE=devnet (CORE-03 factory.ts: "not wired yet") and the bootstrap wallets.`);
    }
    const seed = process.env.INSPECTOR_SEED;
    if (!seed) return void (skip = `set INSPECTOR_SEED to Dana's devnet seed (${dana!.address}), from the bootstrap store .data/wallets.json`);
    signer = SoftwareSigner.fromSeed(seed);
    if (signer.wallet.classicAddress !== dana!.address) {
      return void (skip = `INSPECTOR_SEED is for ${signer.wallet.classicAddress}, but core's Dana is ${dana!.address}`);
    }
    skip = await devnetUnreachable();
  });

  it("core rejects a Dana-signed attestation whose memo hash does not match the filed audit", async (t) => {
    if (skip) return t.skip(skip);
    const task = await openAudit();
    const { report, file } = await auditFor(task);
    const spv = task.milestone.escrow!.owner;
    const signedForOther = await signAuditAttestation({ ...report, notes: "A different report" }, spv, { signer: signer!, source: "imported" });
    await assert.rejects(
      api.submitAudit({ projectId: PROJECT, milestoneId: task.milestone.id, report, photos: [file], signedTxBlob: signedForOther.blob }),
      (e) => e instanceof ApiError && e.code === "validation",
      "core must recompute auditHash and reject a memo that commits to another report",
    );
  });

  it("files Dana's signed audit: core submits the Payment, devnet validates it, the suite passes inspector_audit_present", async (t) => {
    if (skip) return t.skip(skip);
    const task = await openAudit();
    const { report, file } = await auditFor(task);
    const spv = task.milestone.escrow!.owner;
    const signed = await signAuditAttestation(report, spv, { signer: signer!, source: "imported" });
    const res = await api.submitAudit({ projectId: PROJECT, milestoneId: task.milestone.id, report, photos: [file], signedTxBlob: signed.blob });
    assert.equal(res.audit.txHash?.toUpperCase(), signed.txHash.toUpperCase(), "core should submit exactly the blob signed in the app");

    const client = new Client(WS);
    await client.connect();
    try {
      let tx: Record<string, unknown> | undefined;
      for (let i = 0; i < 20 && !tx?.validated; i++) {
        tx = (await client.request({ command: "tx", transaction: signed.txHash }).catch(() => ({ result: undefined }))).result as Record<string, unknown> | undefined;
        if (!tx?.validated) await new Promise((r) => setTimeout(r, 1500));
      }
      assert.ok(tx?.validated, `devnet did not validate ${signed.txHash}`);
      const meta = tx.meta as { TransactionResult?: string };
      const json = (tx.tx_json ?? tx) as { Account: string; Destination: string; Amount: string };
      assert.equal(meta.TransactionResult, "tesSUCCESS");
      assert.equal(json.Account, dana!.address);
      assert.equal(json.Destination, spv);
      assert.equal(json.Amount, "1");
      const expected = await auditHash({ ...report, photos: [{ sha256: await sha256Hex(await file.arrayBuffer()) }] });
      assert.equal(signed.memo.hash, expected);
      console.log(`devnet audit attestation: https://devnet.xrpl.org/transactions/${signed.txHash}`);
    } finally {
      await client.disconnect();
    }
    const checks = await runChecks(task.milestone.id);
    assert.equal(checks.inspector_audit_present?.result, "pass", checks.inspector_audit_present?.reason);
  });
});
