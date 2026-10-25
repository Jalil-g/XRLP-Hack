// CORE-11: the rehearsal harness (scripts/rehearse.ts) against a self-hosted fake core over real HTTP.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { rehearse, startSelfHosted } from "../scripts/rehearse.ts";

let srv: Awaited<ReturnType<typeof startSelfHosted>>;
before(async () => {
  srv = await startSelfHosted();
});
after(() => srv.close());

describe("CORE-11 rehearse over HTTP (fake core)", () => {
  it("walks docs/04 beats 1-6 with no drift; falls back to maple-st on a fake core", async () => {
    const lines: string[] = [];
    const r = await rehearse({ base: srv.base, log: (l) => lines.push(l) });
    assert.equal(r.seed, "maple-st");
    assert.deepEqual(r.scenes.map((s) => s.id), ["setup", "1", "2", "3", "4", "5", "6", "6b"]);
    const failed = r.scenes.flatMap((s) => [...(s.error ? [`${s.id}: ${s.error}`] : []), ...s.checks.filter((c) => !c.ok).map((c) => `${s.id}: ${c.name}`)]);
    assert.deepEqual(failed, []);
    assert.equal(r.ok, true);
    assert.equal(r.drift, 0);
    for (const id of ["3", "5", "6"]) assert.ok(r.scenes.find((s) => s.id === id)!.links.length > 0, `beat ${id} shows explorer links`);
    assert.ok(lines.some((l) => /^\| 3 Money shot/.test(l)), "timing table printed");
    assert.match(lines.at(-1)!, /REHEARSAL OK/);
  });

  it("reports drift (exit 1) when the state is not the pre-staged one", async () => {
    // Same server, no reset: M1 is already released, so there is no Project A to run the money shot on.
    const r = await rehearse({ base: srv.base, reset: false });
    assert.equal(r.ok, false);
    assert.ok(r.drift > 0);
    assert.deepEqual(r.scenes.map((s) => s.id), ["setup"]);
    assert.ok(r.scenes[0]!.checks.some((c) => !c.ok && /Project A/.test(c.name)));
  });
});
