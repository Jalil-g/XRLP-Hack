// Wiring. One core per process: `const core = createCore()`. Fake mode by default (LEDGER_MODE=fake, CORE_VERIFIER=fake).
import { join } from "node:path";
import type { LedgerPort, VerifierPort } from "@xrlp/shared";
import type { ReleaseServicePort } from "./api-surface.ts";
import { FakeClock, systemClock, type Clock } from "./clock.ts";
import { prestageSeedOptions } from "./demo/prestage-seed.ts";
import { DEMO_ADDRESSES, demoCancelAfter, seedDemo, SEED_BACKDATE_MS } from "./demo/scenario.ts";
import { FakeLedger } from "./fakes/fake-ledger.ts";
import { FakeVerifier } from "./fakes/fake-verifier.ts";
import { FileStore, resolveDataDir } from "./file-store.ts";
import { FilePreimageVault, MemoryPreimageVault, ReleaseService } from "./release-service.ts";
import { DomainError } from "./errors.ts";
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

function ledgerFromEnv(env: Record<string, string | undefined>, clock: Clock, dataDir?: string): LedgerPort {
  const mode = env.LEDGER_MODE ?? "fake";
  if (mode === "fake")
    return new FakeLedger({ clock, platformAddress: DEMO_ADDRESSES.platform, stateFile: dataDir ? join(dataDir, "fake-ledger.json") : undefined });
  // TODO(adapters): LEDGER_MODE=devnet -> packages/xrpl/src/adapter.ts (@Jalil-g, XRPL lane).
  throw new Error(`LEDGER_MODE=${mode} not wired yet (only "fake")`);
}

function verifierFromEnv(env: Record<string, string | undefined>, clock: Clock): VerifierPort {
  const mode = env.CORE_VERIFIER ?? "fake";
  if (mode === "fake") return new FakeVerifier(clock);
  // TODO(adapters): CORE_VERIFIER=verifier -> packages/verifier/src/adapter.ts (@elmir132).
  throw new Error(`CORE_VERIFIER=${mode} not wired yet (only "fake")`);
}

export function createCore(opts: CreateCoreOptions = {}): Core {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? systemClock;
  const dataDir = opts.inMemory ? undefined : (opts.dataDir ?? resolveDataDir(env));
  const store = opts.store ?? (dataDir ? new FileStore(dataDir) : new MemoryStore());
  const ledger = opts.ledger ?? ledgerFromEnv(env, clock, dataDir);
  const verifier = opts.verifier ?? verifierFromEnv(env, clock);
  const vault = dataDir ? new FilePreimageVault(dataDir) : new MemoryPreimageVault();
  const release = opts.release ?? new ReleaseService({ ledger, vault, now: () => clock.now() });

  // Route 21 seeding (fake ledger with files only): replay the demo story on a back-dated clock through a twin core
  // that shares this store, the fake ledger's state file and the preimage vault.
  const canSeed = !opts.seed && dataDir && ledger instanceof FakeLedger && !opts.ledger;
  const seed: CoreServiceOptions["seed"] =
    opts.seed ??
    (canSeed
      ? async (name) => {
          if (name !== "maple-st") throw new DomainError("VALIDATION", `Seed "${name}" needs LEDGER_MODE=devnet (fake mode seeds "maple-st")`);
          const twinClock = new FakeClock(new Date(clock.now().getTime() - SEED_BACKDATE_MS));
          const twin = createCore({ dataDir, env, store, clock: twinClock, cancelAfterFor: demoCancelAfter, seed: async () => {}, resetLedger: () => {} });
          await seedDemo(twin.service, twinClock);
        }
      : undefined);
  // CORE-07: devnet route 21 loads the XRPL prestage (A/B/C) into this store and the release service's vault.
  const prestage =
    !opts.seed && !opts.release && (env.LEDGER_MODE ?? "fake") === "devnet"
      ? prestageSeedOptions({ env, dataDir: dataDir ?? resolveDataDir(env), store, vault, ledger, service: () => service })
      : {};

  const service: CoreService = new CoreService({
    platformAddress: DEMO_ADDRESSES.platform,
    aiAgentAddress: DEMO_ADDRESSES.aiAgent,
    releaseServiceAddress: DEMO_ADDRESSES.releaseService,
    ...prestage,
    ...opts,
    store,
    ledger,
    verifier,
    release,
    clock,
    seed: seed ?? prestage.seed,
    resetLedger: opts.resetLedger ?? (ledger instanceof FakeLedger ? () => ledger.reset() : undefined),
  });
  return { service, store, ledger, verifier, release, clock, dataDir };
}
