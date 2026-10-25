// Wiring. One core per process: `const core = createCore()`. Fake mode by default (LEDGER_MODE=fake, CORE_VERIFIER=fake).
// LEDGER_MODE=devnet -> @xrlp/xrpl XrplLedgerAdapter + WALLETS_FILE identities; VERIFIER_MODE=live (or CORE_VERIFIER=verifier)
// -> @xrlp/verifier ClaudeVerifierAdapter (CORE-05).
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { LedgerPort, VerifierPort } from "@xrlp/shared";
import { assertNotMainnet, REPO_ROOT as XRPL_REPO_ROOT, config as xrplConfig, XrplLedgerAdapter } from "@xrlp/xrpl";
import { DevnetConfigError, loadDevnetIdentities, seedDevnetParticipants, type DevnetIdentities } from "./adapters/devnet-identities.ts";
import { UploadedEvidenceMeta } from "./adapters/evidence-meta.ts";
import { CoreVerifierAdapter } from "./adapters/verifier.ts";
import type { ReleaseServicePort } from "./api-surface.ts";
import { FakeClock, systemClock, type Clock } from "./clock.ts";
import { DEMO_ADDRESSES, demoCancelAfter, seedDemo, SEED_BACKDATE_MS } from "./demo/scenario.ts";
import { FakeLedger } from "./fakes/fake-ledger.ts";
import { FakeVerifier } from "./fakes/fake-verifier.ts";
import { releaseKeyFromEnv } from "./env.ts";
import { FileStore, resolveDataDir } from "./file-store.ts";
import { FilePreimageVault, MemoryPreimageVault, ReleaseService } from "./release-service.ts";
import { CoreService, type CoreServiceOptions } from "./service.ts";
import { MemoryStore, type Store } from "./store.ts";

export interface Core {
  service: CoreService;
  store: Store;
  ledger: LedgerPort;
  verifier: VerifierPort;
  release: ReleaseServicePort;
  clock: Clock;
  /** undefined for in-memory cores. */
  dataDir?: string;
}

export interface CreateCoreOptions extends Partial<CoreServiceOptions> {
  /** In-memory store, ledger state and preimage vault (tests / simulate). Default false -> files under DATA_DIR. */
  inMemory?: boolean;
  dataDir?: string;
  env?: Record<string, string | undefined>;
}

type Env = Record<string, string | undefined>;

/** LEDGER_MODE=devnet preconditions: devnet endpoint (xrpl's mainnet guard + XRPL_NETWORK), a bootstrapped WALLETS_FILE. */
export function devnetConfigFromEnv(env: Env): { walletsFile: string; identities: DevnetIdentities } {
  const network = env.XRPL_NETWORK ?? xrplConfig.network;
  const wsUrl = env.XRPL_WS_URL ?? xrplConfig.wsUrl;
  assertNotMainnet(wsUrl, network);
  if (network !== "devnet") throw new DevnetConfigError(`LEDGER_MODE=devnet needs XRPL_NETWORK=devnet, got "${network}" (Vault/Loan are devnet-only)`);
  const raw = env.WALLETS_FILE ?? xrplConfig.walletsFile;
  const walletsFile = isAbsolute(raw) ? raw : resolve(XRPL_REPO_ROOT, raw); // same rule as @xrlp/xrpl: relative to the repo root
  if (!existsSync(walletsFile)) throw new DevnetConfigError(`LEDGER_MODE=devnet: WALLETS_FILE ${walletsFile} not found. Run: WALLETS_FILE=${walletsFile} pnpm --filter @xrlp/xrpl bootstrap`);
  return { walletsFile, identities: loadDevnetIdentities(walletsFile) };
}

/** First-loss cover on devnet, bps of principal (see createCore). */
export const DEVNET_COVER_BPS = 1100;

/** DEMO_CANCEL_AFTER_S="1500,1800,420": CancelAfter = close + N s for milestone i (short devnet runs). Unset -> default. */
export function cancelAfterFromEnv(env: Env): CoreServiceOptions["cancelAfterFor"] {
  const raw = env.DEMO_CANCEL_AFTER_S?.trim();
  if (!raw) return undefined;
  const secs = raw.split(",").map((x) => Number(x.trim()));
  if (secs.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error(`DEMO_CANCEL_AFTER_S must be comma-separated positive integers (seconds), got "${raw}"`);
  return (_p, m, closeAt) => new Date(closeAt.getTime() + secs[Math.min(m.index, secs.length - 1)]! * 1000);
}

function ledgerFromEnv(env: Env, clock: Clock, dataDir?: string, devnet?: { walletsFile: string }): LedgerPort {
  const mode = env.LEDGER_MODE ?? "fake";
  if (mode === "fake")
    return new FakeLedger({ clock, platformAddress: DEMO_ADDRESSES.platform, stateFile: dataDir ? join(dataDir, "fake-ledger.json") : undefined });
  if (mode === "devnet") return new XrplLedgerAdapter({ walletsFile: devnet!.walletsFile, log: (line) => console.log(`[xrpl] ${line}`) });
  throw new Error(`LEDGER_MODE=${mode} not supported (fake | devnet)`);
}

/**
 * CORE_VERIFIER=fake|verifier wins; otherwise VERIFIER_MODE=live -> ClaudeVerifierAdapter, anything else -> FakeVerifier.
 * On devnet the FakeVerifier reads uploaded files' metadata (EXIF, pHash, invoice totals) from DATA_DIR (adapters/evidence-meta.ts).
 */
function verifierFromEnv(env: Env, clock: Clock, store: Store, dataDir?: string, devnet = false): VerifierPort {
  const vmode = (env.VERIFIER_MODE ?? "mock").trim().toLowerCase();
  if (vmode !== "mock" && vmode !== "live") throw new Error(`VERIFIER_MODE=${vmode} not supported (mock | live)`);
  const mode = env.CORE_VERIFIER ?? (vmode === "live" ? "verifier" : "fake");
  if (mode === "fake") return devnet && dataDir ? new UploadedEvidenceMeta(new FakeVerifier(clock), dataDir) : new FakeVerifier(clock);
  if (mode === "verifier")
    return new CoreVerifierAdapter({ mode: vmode, store, now: () => clock.now().toISOString(), ...(dataDir ? { dataDir } : {}), ...(env.VERIFIER_MODEL ? { model: env.VERIFIER_MODEL } : {}) });
  throw new Error(`CORE_VERIFIER=${mode} not supported (fake | verifier)`);
}

export function createCore(opts: CreateCoreOptions = {}): Core {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? systemClock;
  const dataDir = opts.inMemory ? undefined : (opts.dataDir ?? resolveDataDir(env));
  const store = opts.store ?? (dataDir ? new FileStore(dataDir) : new MemoryStore());
  const devnet = !opts.ledger && env.LEDGER_MODE === "devnet" ? devnetConfigFromEnv(env) : undefined;
  const ledger = opts.ledger ?? ledgerFromEnv(env, clock, dataDir, devnet);
  const verifier = opts.verifier ?? verifierFromEnv(env, clock, store, dataDir, !!devnet);
  const release =
    opts.release ?? new ReleaseService({ ledger, vault: dataDir ? new FilePreimageVault(dataDir, releaseKeyFromEnv(env)) : new MemoryPreimageVault(), now: () => clock.now() });

  // Route 21 seeding (fake ledger with files only): replay the demo story on a back-dated clock through a twin core
  // that shares this store, the fake ledger's state file and the preimage vault.
  const canSeed = !opts.seed && dataDir && ledger instanceof FakeLedger && !opts.ledger;
  const seed: CoreServiceOptions["seed"] =
    opts.seed ??
    (devnet
      ? () => seedDevnetParticipants(service, devnet.identities, (line) => console.log(`[core] ${line}`))
      : canSeed
      ? async () => {
          const twinClock = new FakeClock(new Date(clock.now().getTime() - SEED_BACKDATE_MS));
          const twin = createCore({ dataDir, env, store, clock: twinClock, cancelAfterFor: demoCancelAfter, seed: async () => {}, resetLedger: () => {} });
          await seedDemo(twin.service, twinClock);
        }
      : undefined);

  const ids = devnet?.identities;
  const cancelAfterFor = cancelAfterFromEnv(env);
  const service: CoreService = new CoreService({
    platformAddress: ids?.platform ?? DEMO_ADDRESSES.platform,
    aiAgentAddress: ids?.aiAgent ?? DEMO_ADDRESSES.aiAgent,
    releaseServiceAddress: ids?.releaseService ?? DEMO_ADDRESSES.releaseService,
    ...(cancelAfterFor ? { cancelAfterFor } : {}),
    // The ledger's cover minimum is CoverRateMinimum (10%) of principal + interest, not of principal; 11% of principal is
    // the headroom xrpl's defaultCoverDeposit uses (covers interest up to 10% of principal). Proper fix: service.ts cover on owed.
    ...(devnet ? { coverBps: DEVNET_COVER_BPS } : {}),
    ...opts,
    store,
    ledger,
    verifier,
    release,
    clock,
    seed,
    resetLedger: opts.resetLedger ?? (ledger instanceof FakeLedger ? () => ledger.reset() : undefined),
  });
  return { service, store, ledger, verifier, release, clock, dataDir };
}
