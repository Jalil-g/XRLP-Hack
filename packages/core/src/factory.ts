// Wiring. The web app should create ONE core per process:  `const core = createCore()`.
import { systemClock, type Clock } from "./clock.ts";
import { FakeLedger } from "./fakes/fake-ledger.ts";
import { FakeVerifier } from "./fakes/fake-verifier.ts";
import { FileStore, resolveDataDir } from "./file-store.ts";
import type { LedgerPort, VerifierPort } from "./ports.ts";
import { ReadModels } from "./read-models.ts";
import { CoreService, type CoreServiceOptions } from "./service.ts";
import { MemoryStore, type Store } from "./store.ts";

export interface Core {
  service: CoreService;
  read: ReadModels;
  store: Store;
  ledger: LedgerPort;
  verifier: VerifierPort;
  clock: Clock;
  /** undefined for in-memory cores. */
  dataDir?: string;
}

export interface CreateCoreOptions extends Partial<CoreServiceOptions> {
  /** Use an in-memory store (tests / simulate). Default false -> FileStore under DATA_DIR. */
  inMemory?: boolean;
  dataDir?: string;
  env?: Record<string, string | undefined>;
}

function ledgerFromEnv(env: Record<string, string | undefined>, clock: Clock): LedgerPort {
  const mode = env.LEDGER_MODE ?? "fake";
  if (mode === "fake") return new FakeLedger({ clock });
  // TODO(adapters): LEDGER_MODE=devnet -> new XrplLedger(...) from src/adapters/xrpl-ledger.ts (@xrlp/xrpl).
  throw new Error(`LEDGER_MODE=${mode} not wired yet (only "fake"). See TODO in packages/core/src/ports.ts`);
}

function verifierFromEnv(env: Record<string, string | undefined>, clock: Clock): VerifierPort {
  const mode = env.CORE_VERIFIER ?? "fake";
  if (mode === "fake") return new FakeVerifier(clock);
  // TODO(adapters): CORE_VERIFIER=verifier -> adapter over @xrlp/verifier (which itself honours VERIFIER_MODE=mock|live).
  throw new Error(`CORE_VERIFIER=${mode} not wired yet (only "fake"). See TODO in packages/core/src/ports.ts`);
}

export function createCore(opts: CreateCoreOptions = {}): Core {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? systemClock;
  const dataDir = opts.inMemory ? undefined : (opts.dataDir ?? resolveDataDir(env));
  const store = opts.store ?? (dataDir ? new FileStore(dataDir) : new MemoryStore());
  const ledger = opts.ledger ?? ledgerFromEnv(env, clock);
  const verifier = opts.verifier ?? verifierFromEnv(env, clock);
  const service = new CoreService({ ...opts, store, ledger, verifier, clock });
  return { service, read: new ReadModels(store), store, ledger, verifier, clock, dataDir };
}
