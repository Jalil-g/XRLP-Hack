// INS-04: audit attestation signed in the app (mock keys), carried as signedTxBlob, verified by mock route 10 like core.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { decode, hashes, Wallet } from "xrpl";
import { parseAttestationTx } from "@xrlp/attest-signer";
import { api } from "../lib/api.ts";
import { buildAudit, emptyDraft, photoEvidence, type AuditDraft } from "../lib/audit.ts";
import { mockControl } from "../lib/mock/backend.ts";
import { ADDR } from "../lib/mock/fixtures.ts";
import { mockSigner } from "../lib/mock/keys.ts";
import { forgetKey, importKey, inspectorKey, signAuditAttestation } from "../lib/signing.ts";
import type { InspectorAudit, InspectorTask } from "../lib/types.ts";

const SITE_PHOTO = readFileSync(new URL("./fixtures/audit-foundation-02-site.jpg", import.meta.url));

beforeEach(() => {
  mockControl.reset();
  mockControl.setLatency(0);
});

type AuditTask = InspectorTask & { milestone: NonNullable<InspectorTask["milestone"]> };

async function ready(): Promise<{ task: AuditTask; audit: InspectorAudit; file: Blob; spv: string }> {
  const task = (await api.getQueue(ADDR.dana)).find((t) => t.milestone?.id === "maple-st-duplex:m1") as AuditTask;
  const file = new Blob([SITE_PHOTO], { type: "image/jpeg" });
  const draft: AuditDraft = {
    ...emptyDraft(task),
    checklist: Object.fromEntries(task.sov.map((l) => [l.code, { status: "done" as const, note: "" }])),
    photos: [{ file, evidence: await photoEvidence(file, "2026-10-25T10:00:00Z") }],
    notes: "Matches the SoV.",
  };
  return { task, audit: await buildAudit(task, ADDR.dana, draft, "2026-10-25T10:00:00Z"), file, spv: task.milestone.escrow!.owner };
}

describe("mock keys", () => {
  it("every fixture inspector has a key matching its address; anyone else has none", async () => {
    for (const a of [ADDR.dana, ADDR.marcus, ADDR.priya]) assert.equal((await mockSigner(a))?.wallet.classicAddress, a);
    assert.equal(await mockSigner(ADDR.platform), null);
    assert.equal((await inspectorKey(ADDR.dana))?.source, "mock");
  });
});

describe("signed submission (route 10 with signedTxBlob)", () => {
  it("signs the XRPL-08 attestation to the SPV; the filed audit's txHash is the signed tx's hash", async () => {
    const { task, audit, file, spv } = await ready();
    const signed = await signAuditAttestation(audit, spv, (await inspectorKey(ADDR.dana))!);

    const att = parseAttestationTx(decode(signed.blob) as never);
    assert.deepEqual(att, { ...signed.memo, signer: ADDR.dana, destination: spv });
    assert.equal(signed.memo.kind, "audit");
    assert.equal(signed.txHash, hashes.hashSignedTx(signed.blob));

    const res = await api.submitAudit({ projectId: task.projectId, milestoneId: task.milestone.id, report: audit, photos: [file], signedTxBlob: signed.blob });
    assert.equal(res.milestone.status, "audited");
    assert.equal(res.audit.txHash, signed.txHash);
    assert.equal(res.events[0]?.txHash, signed.txHash);
    assert.match(res.events[0]!.explorerUrl, new RegExp(signed.txHash));
  });

  it("rejects an audit changed after signing", async () => {
    const { task, audit, file, spv } = await ready();
    const signed = await signAuditAttestation(audit, spv, (await inspectorKey(ADDR.dana))!);
    const edited = { ...audit, checklist: audit.checklist.map((c, i) => (i === 0 ? { ...c, status: "partial" as const, note: "Edited later" } : c)) };
    await assert.rejects(
      api.submitAudit({ projectId: task.projectId, milestoneId: task.milestone.id, report: edited, photos: [file], signedTxBlob: signed.blob }),
      /memo hash does not match/,
    );
  });

  it("rejects different photo bytes than the ones signed", async () => {
    const { task, audit, file, spv } = await ready();
    const signed = await signAuditAttestation(audit, spv, (await inspectorKey(ADDR.dana))!);
    await assert.rejects(
      api.submitAudit({ projectId: task.projectId, milestoneId: task.milestone.id, report: audit, photos: [new Blob(["other"])], signedTxBlob: signed.blob }),
      /memo hash does not match/,
    );
    assert.ok(file);
  });

  it("rejects a blob signed by another inspector, or sent to another account", async () => {
    const { task, audit, file, spv } = await ready();
    const asMarcus = await signAuditAttestation({ ...audit, inspector: ADDR.marcus }, spv, (await inspectorKey(ADDR.marcus))!);
    await assert.rejects(
      api.submitAudit({ projectId: task.projectId, milestoneId: task.milestone.id, report: audit, photos: [file], signedTxBlob: asMarcus.blob }),
      /signed by rKMQ/,
    );
    const elsewhere = await signAuditAttestation(audit, ADDR.platform, (await inspectorKey(ADDR.dana))!);
    await assert.rejects(
      api.submitAudit({ projectId: task.projectId, milestoneId: task.milestone.id, report: audit, photos: [file], signedTxBlob: elsewhere.blob }),
      /not the project account/,
    );
  });

  it("rejects garbage", async () => {
    const { task, audit, file } = await ready();
    await assert.rejects(
      api.submitAudit({ projectId: task.projectId, milestoneId: task.milestone.id, report: audit, photos: [file], signedTxBlob: "DEADBEEF" }),
      /signedTxBlob rejected/,
    );
  });
});

describe("imported keys (http mode)", () => {
  it("accepts only a seed for this inspector's account", () => {
    const store = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    });
    const w = Wallet.generate();
    assert.throws(() => importKey(w.classicAddress, "not-a-seed"), /not a valid XRPL seed/);
    assert.throws(() => importKey(ADDR.dana, w.seed!), /not this inspector/);
    importKey(w.classicAddress, ` ${w.seed!} `);
    assert.equal(store.get(`drawproof.key.${w.classicAddress}`), w.seed);
    forgetKey(w.classicAddress);
    assert.equal(store.size, 0);
  });
});
