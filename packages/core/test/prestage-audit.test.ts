// #173: outside fake mode an unsigned audit is refused over HTTP; only an in-process caller (the CORE-07 prestage import)
// can have it platform-signed, with a reason that is logged and recorded in the attestation memo.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttestMemo } from "@xrlp/shared";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { auditBody, DEMO, demoCancelAfter, doc, invoice, mapleInput, photos, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { DomainError } from "../src/errors.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";

const T0 = "2026-10-01T12:00:00.000Z";
const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

describe("platform-signed audits off fake mode", () => {
  it("refused without a reason (incl. blank); accepted in-process with a reason that lands in the memo", async () => {
    const clock = new FakeClock(T0);
    const ledger = new FakeLedger({ clock, salt: "prestage-audit" });
    const memos: AttestMemo[] = [];
    const attest = ledger.attest.bind(ledger);
    ledger.attest = async (a) => (memos.push(a.memo), attest(a));
    const svc = createCore({ inMemory: true, clock, ledger, cancelAfterFor: demoCancelAfter }).service;
    await registerParticipants(svc);
    const { project, inspectors } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
    clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
    const p = (await svc.closeLoan(project.id, { actor: svc.platformAddress })).project;
    clock.advance(DAY_MS);
    const m1 = p.milestones[0]!;
    const ev = [...photos(DEMO.maple.siteGeo, "Foundation", 3, clock.now(), "foundation"), invoice("concrete.pdf", "36000"), doc("footing.pdf", "Footing")];
    await svc.submitEvidence(p.id, m1.id, ev);
    const body = auditBody(p, m1.id, inspectors[0]!, ev);

    Object.defineProperty(ledger, "mode", { value: "devnet", configurable: true });
    await assert.rejects(svc.submitAudit(p.id, m1.id, body), isCode("FORBIDDEN"));
    await assert.rejects(svc.submitAudit(p.id, m1.id, body, { platformSignedReason: "   " }), isCode("FORBIDDEN"));
    const r = await svc.submitAudit(p.id, m1.id, body, { platformSignedReason: "prestage A" });
    assert.equal(r.milestone.status, "audited");
    const memo = memos.find((x) => x.kind === "audit")!;
    assert.match(memo.reason!, /^signed-for r\w+ \(prestage A\)$/);
  });
});
