// #149 (xrpl security review, core side): platform-held addresses refused at registration.
// C1 (release outcomes) is elmir's #172, tested in release-service.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "../src/errors.ts";
import { createCore } from "../src/factory.ts";
import { FakeClock } from "../src/clock.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";

const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

describe("#149: platform-held addresses can't register", () => {
  it("platform / AI / release service / configured reserved addresses are refused as builder, inspector or investor", async () => {
    const clock = new FakeClock("2026-10-01T12:00:00.000Z");
    const issuer = "rEhKZcz5Ndjm9BzZmmKrtvhXPnSWByssDv";
    const svc = createCore({ inMemory: true, clock, ledger: new FakeLedger({ clock }), reservedAddresses: [issuer] }).service;
    await assert.rejects(svc.kycInvestor(svc.platformAddress), isCode("FORBIDDEN"));
    await assert.rejects(svc.kycInvestor(issuer), isCode("FORBIDDEN"));
    await assert.rejects(
      svc.registerInspector({ address: svc.releaseServiceAddress, name: "x", licenseNumber: "L", company: "c" } as never),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      svc.registerBuilder({ name: "x", address: svc.aiAgentAddress, licenseNumber: "L", insurancePolicy: "I", completedProjects: 1, riskTier: "low" } as never),
      isCode("FORBIDDEN"),
    );
    assert.deepEqual((await svc.kycInvestor("rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH")).events.length > 0, true, "ordinary investors still work");
  });
});
