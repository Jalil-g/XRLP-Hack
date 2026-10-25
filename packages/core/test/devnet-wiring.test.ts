// CORE-05: LEDGER_MODE=devnet / VERIFIER_MODE wiring, devnet identities, ledger error mapping, and the devnet e2e flow
// (scripts/devnet-e2e.ts) over real HTTP on a fake ledger + the real verifier in mock mode. Offline: no network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { serve, type ServerType } from "@hono/node-server";
import { LedgerError } from "@xrlp/shared";
import { XrplLedgerAdapter, XrplLedgerError, type WalletFile } from "@xrlp/xrpl";
import { DEVNET_ROLE_MAP, identitiesFromWalletFile, seedDevnetParticipants } from "../src/adapters/devnet-identities.ts";
import { UploadedEvidenceMeta } from "../src/adapters/evidence-meta.ts";
import { CoreVerifierAdapter, evidencePath } from "../src/adapters/verifier.ts";
import { FakeClock } from "../src/clock.ts";
import { DEMO_ADDRESSES } from "../src/demo/scenario.ts";
import { DomainError, ledgerErrorCode, toApiError } from "../src/errors.ts";
import { cancelAfterFromEnv, createCore, devnetConfigFromEnv, DEVNET_COVER_BPS, type Core } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";
import { FakeVerifier } from "../src/fakes/fake-verifier.ts";
import { FileStore } from "../src/file-store.ts";
import { createHttpServer } from "../src/http/app.ts";
import { fakeAddress } from "../src/ids.ts";
import { KYC_ALREADY_ON_LEDGER } from "../src/service.ts";
import { markdownTable, restampedPhoto, runDevnetFlow } from "../scripts/devnet-e2e.ts";

const ROLES = ["issuer", "platform", "releaseService", "builder", "investor1", "investor2", "investor3", "inspector1", "inspector2", "inspector3", "aiAgent", "trustee"] as const;
const walletFile = (network = "devnet"): WalletFile => ({
  network,
  createdAt: "2026-10-24T00:00:00.000Z",
  wallets: Object.fromEntries(ROLES.map((r) => [r, { address: fakeAddress(`devnet:${r}`), seed: "sNOT_A_REAL_SEED" }])) as WalletFile["wallets"],
  spvs: {},
});

let dir: string;
let walletsPath: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "core05-"));
  walletsPath = join(dir, "wallets.json");
  writeFileSync(walletsPath, JSON.stringify(walletFile()));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const devnetEnv = (extra: Record<string, string> = {}) => ({ LEDGER_MODE: "devnet", XRPL_NETWORK: "devnet", XRPL_WS_URL: "wss://s.devnet.rippletest.net:51233", WALLETS_FILE: walletsPath, ...extra });

describe("devnet identities", () => {
  it("maps core's demo parties onto the xrpl wallet roles", () => {
    const f = walletFile();
    const ids = identitiesFromWalletFile(f);
    const a = (r: (typeof ROLES)[number]) => f.wallets[r]!.address;
    assert.equal(ids.platform, a("platform"));
    assert.equal(ids.aiAgent, a("aiAgent"));
    assert.equal(ids.releaseService, a("releaseService"));
    assert.equal(ids.trustee, a("trustee"));
    assert.equal(ids.issuer, a("issuer"), "issuer read for #149 reserved addresses");
    assert.equal(ids.builder.address, a("builder"));
    assert.equal(ids.builder.id, "bld-hudson-valley");
    assert.deepEqual(ids.investors.map((i) => [i.name, i.address, i.kyc]), [["Ava Chen", a("investor1"), true], ["Marcus Johnson", a("investor2"), true], ["Priya Patel", a("investor3"), false]]);
    assert.deepEqual(ids.inspectors.map((i) => i.address), DEVNET_ROLE_MAP.inspectors.map(a));
    assert.deepEqual(ids.inspectors.map((i) => i.licenseNumber), ["NYS-CEO-3341", "NYS-CEO-5120", "NYS-CEO-7781"]);
    assert.ok(!JSON.stringify(ids).includes("sNOT_A_REAL_SEED"), "identities never carry seeds");
  });
  it("refuses a non-devnet wallet file and a missing role", () => {
    assert.throws(() => identitiesFromWalletFile(walletFile("testnet")), /network "testnet"/);
    const f = walletFile();
    delete (f.wallets as Record<string, unknown>).inspector2;
    assert.throws(() => identitiesFromWalletFile(f), /no "inspector2" wallet; re-run: pnpm --filter @xrlp\/xrpl bootstrap/);
  });
});

describe("factory: LEDGER_MODE / VERIFIER_MODE selection", () => {
  it("fake mode is unchanged (FakeLedger, FakeVerifier, fake demo addresses)", () => {
    const core = createCore({ inMemory: true, env: {} });
    assert.ok(core.ledger instanceof FakeLedger);
    assert.ok(core.verifier instanceof FakeVerifier);
    assert.equal(core.service.platformAddress, DEMO_ADDRESSES.platform);
    assert.equal(core.service.releaseServiceAddress, DEMO_ADDRESSES.releaseService);
    assert.ok(createCore({ inMemory: true, env: { VERIFIER_MODE: "mock" } }).verifier instanceof FakeVerifier);
  });
  it("LEDGER_MODE=devnet -> XrplLedgerAdapter with the WALLETS_FILE identities (no network at construction)", () => {
    const core = createCore({ inMemory: true, env: devnetEnv() });
    assert.ok(core.ledger instanceof XrplLedgerAdapter);
    assert.ok(core.verifier instanceof FakeVerifier, "in-memory: no upload dir to read metadata from");
    const filed = createCore({ dataDir: join(dir, "devnet-data"), env: devnetEnv() });
    assert.ok(filed.verifier instanceof UploadedEvidenceMeta && filed.verifier.inner instanceof FakeVerifier);
    assert.equal(core.ledger.mode, "devnet");
    const f = walletFile();
    assert.equal(core.service.platformAddress, f.wallets.platform!.address);
    assert.equal(core.service.aiAgentAddress, f.wallets.aiAgent!.address);
    assert.equal(core.service.releaseServiceAddress, f.wallets.releaseService!.address);
    const coverBps = (s: unknown) => (s as { opts: { coverBps?: number } }).opts.coverBps;
    assert.equal(coverBps(core.service), DEVNET_COVER_BPS, "cover >= 10% of principal + interest on the real ledger");
    assert.equal(coverBps(createCore({ inMemory: true, env: {} }).service), undefined, "fake mode keeps the 10% default");
  });
  it("devnet env validation: missing WALLETS_FILE, mainnet endpoint, non-devnet network, unknown mode", () => {
    assert.throws(() => devnetConfigFromEnv(devnetEnv({ WALLETS_FILE: join(dir, "nope.json") })), /WALLETS_FILE .*nope\.json not found\. Run: .*bootstrap/);
    assert.throws(() => devnetConfigFromEnv(devnetEnv({ XRPL_WS_URL: "wss://xrplcluster.com" })), /Refusing to run against mainnet/);
    assert.throws(() => devnetConfigFromEnv(devnetEnv({ XRPL_NETWORK: "mainnet" })), /Refusing to run against mainnet/);
    assert.throws(() => devnetConfigFromEnv(devnetEnv({ XRPL_NETWORK: "testnet" })), /needs XRPL_NETWORK=devnet/);
    assert.throws(() => createCore({ inMemory: true, env: { LEDGER_MODE: "testnet" } }), /LEDGER_MODE=testnet not supported \(fake \| devnet\)/);
  });
  it("VERIFIER_MODE=live / CORE_VERIFIER=verifier -> ClaudeVerifierAdapter; bad values throw", () => {
    const live = createCore({ inMemory: true, env: { VERIFIER_MODE: "live" } }).verifier;
    assert.ok(live instanceof CoreVerifierAdapter);
    assert.equal(live.mode, "live");
    const mock = createCore({ inMemory: true, env: { CORE_VERIFIER: "verifier" } }).verifier;
    assert.ok(mock instanceof CoreVerifierAdapter);
    assert.equal(mock.mode, "mock");
    assert.ok(createCore({ inMemory: true, env: { VERIFIER_MODE: "live", CORE_VERIFIER: "fake" } }).verifier instanceof FakeVerifier);
    assert.throws(() => createCore({ inMemory: true, env: { VERIFIER_MODE: "turbo" } }), /VERIFIER_MODE=turbo not supported/);
    assert.throws(() => createCore({ inMemory: true, env: { CORE_VERIFIER: "x" } }), /CORE_VERIFIER=x not supported/);
  });
  it("DEMO_CANCEL_AFTER_S: per-milestone seconds after close (last value repeats)", () => {
    const f = cancelAfterFromEnv({ DEMO_CANCEL_AFTER_S: "600, 900" })!;
    const at = new Date("2026-10-24T12:00:00Z");
    const m = (index: number) => ({ index }) as never;
    assert.deepEqual([0, 1, 2].map((i) => f({} as never, m(i), at).toISOString()), ["2026-10-24T12:10:00.000Z", "2026-10-24T12:15:00.000Z", "2026-10-24T12:15:00.000Z"]);
    assert.equal(cancelAfterFromEnv({}), undefined);
    assert.throws(() => cancelAfterFromEnv({ DEMO_CANCEL_AFTER_S: "60,soon" }), /positive integers/);
  });
  it("evidence URIs resolve to DATA_DIR/files for the verifier", () => {
    const id = "0f8b4a8e-1f43-4a6e-9a51-2b7c3d9e0a11";
    assert.equal(evidencePath(`/api/files/${id}`, "/data"), `/data/files/${id}`);
    assert.equal(evidencePath("data:text/plain,hi", "/data"), "data:text/plain,hi");
    assert.equal(evidencePath("/api/files/../../etc/passwd", "/data"), "/api/files/../../etc/passwd");
  });
});

describe("ledger errors -> HTTP (05-api §1)", () => {
  it("maps shared LedgerError codes and the adapter's apiCode", () => {
    assert.equal(ledgerErrorCode(new LedgerError("too_soon", "x")), "TOO_SOON");
    assert.equal(ledgerErrorCode(new LedgerError("unsafe_release", "x")), "UNSAFE_RELEASE");
    assert.equal(ledgerErrorCode(new LedgerError("ledger_error", "x")), "LEDGER_ERROR");
    assert.equal(ledgerErrorCode(new XrplLedgerError("not_found", "vault gone")), "NOT_FOUND");
    assert.equal(ledgerErrorCode(new XrplLedgerError("validation", "no key")), "VALIDATION");
    const status = (c: Parameters<typeof ledgerErrorCode>[0]) => toApiError(new DomainError(ledgerErrorCode(c), "m")).status;
    assert.deepEqual([status({ code: "too_soon" }), status({ code: "unsafe_release" }), status({ code: "ledger_error", apiCode: "not_found" }), status({ code: "ledger_error", apiCode: "validation" }), status({ code: "ledger_error" })], [409, 409, 404, 400, 502]);
  });
  it("service surfaces an adapter not_found as 404 with txResult/txHash kept", async () => {
    const ledger = new FakeLedger();
    ledger.issueCredential = async () => {
      throw new XrplLedgerError("not_found", "subject account not found", { txResult: "tecNO_TARGET" });
    };
    const core = createCore({ inMemory: true, env: {}, ledger });
    await assert.rejects(core.service.kycInvestor(fakeAddress("x")), (e: unknown) => {
      const { status, body } = toApiError(e);
      return status === 404 && body.error.code === "not_found" && body.error.txResult === "tecNO_TARGET";
    });
  });
  it("an already-accepted credential (adapter returns []) still counts as KYC'd", async () => {
    const ledger = new FakeLedger();
    ledger.issueCredential = async () => [];
    const core = createCore({ inMemory: true, env: {}, ledger });
    const addr = fakeAddress("investor:already");
    assert.deepEqual(await core.service.kycInvestor(addr), { events: [] });
    assert.equal(await core.store.read((db) => db.investors.find((i) => i.address === addr)?.kycCredentialTx), KYC_ALREADY_ON_LEDGER);
  });
});

describe("devnet e2e flow over HTTP (fake ledger, devnet verifier wiring, offline)", () => {
  let server: ServerType;
  let core: Core;
  const clock = new FakeClock("2026-10-24T15:00:00.000Z");
  const ids = identitiesFromWalletFile(walletFile());
  let dataDir: string;

  before(async () => {
    dataDir = join(dir, "flow");
    const ledger = new FakeLedger({ clock, platformAddress: ids.platform });
    const store = new FileStore(dataDir);
    core = createCore({
      dataDir,
      env: { DEMO_CANCEL_AFTER_S: "1500,1800,420" },
      clock,
      store,
      ledger,
      // what LEDGER_MODE=devnet VERIFIER_MODE=mock wires: FakeVerifier + metadata from the uploaded bytes
      verifier: new UploadedEvidenceMeta(new FakeVerifier(clock), dataDir),
      platformAddress: ids.platform,
      aiAgentAddress: ids.aiAgent,
      releaseServiceAddress: ids.releaseService,
      seed: () => seedDevnetParticipants(core.service, ids),
      resetLedger: () => ledger.reset(),
    });
    const app = createHttpServer(core.service, { dataDir });
    await new Promise<void>((r) => (server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => r())));
  });
  after(() => server?.close());

  it("fee -> verify -> lock -> KYC -> invest x2 -> close -> M1 pass+release, M2 fraud held, try-steal refused, M3 cancel+refund", async () => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const rows = await runDevnetFlow({
      base,
      ids,
      now: () => clock.now(),
      waitUntil: async (t) => {
        if (clock.now() < t) clock.set(new Date(t.getTime() + 1_000));
      },
    });
    const by = (s: string) => rows.find((r) => r.step.startsWith(s))!;
    assert.equal(by("11 M1 run checks").outcome, "pass -> released");
    assert.match(by("11 M2 run checks").outcome, /^fail: .*no_duplicate_photo.*, no release$/);
    assert.equal(by("23 try-steal").outcome, "tecCRYPTOCONDITION_ERROR");
    assert.equal(by("8 close before").status, 409);
    assert.equal(by("15 withdraw before").status, 409);
    assert.equal(by("7 invest investor3").status, 403);
    assert.equal(by("13 cancel M3 after").outcome, "refunded");
    assert.match(markdownTable(rows), /^\| step \| HTTP \| result \| txs \|/);
  });

  it("restamped fixture photos keep their size and carry the new EXIF time", () => {
    const at = new Date("2026-10-24T16:30:05Z");
    const b = restampedPhoto("foundation/foundation-01-wide.jpg", at);
    assert.ok(b.toString("latin1").includes("2026:10:24 16:30:05"));
    assert.ok(!b.toString("latin1").includes("2026:10:19 14:05:00"));
  });
});
