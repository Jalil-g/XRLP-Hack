// CORE-07: route 21 wiring for LEDGER_MODE=devnet. `seed: "prestage"` (also the default when the body names no seed)
// loads the XRPL prestage instead of the fake back-dated scenario; any other seed goes to `other` (CORE-05: devnet
// participants). prestage-import.ts (and with it @xrlp/xrpl) is loaded lazily, so fake-mode cores never import it.
import type { LedgerPort } from "@xrlp/shared";
import type { DemoSeed } from "../api-surface.ts";
import { DomainError } from "../errors.ts";
import type { PreimageVault } from "../release-service.ts";
import type { CoreService, CoreServiceOptions } from "../service.ts";
import type { Store } from "../store.ts";
import type { Log } from "./scenario.ts";

export interface PrestageSeedDeps {
  env: Record<string, string | undefined>;
  dataDir: string;
  store: Store;
  /** The ReleaseService's own vault. */
  vault: PreimageVault;
  ledger: LedgerPort;
  /** Late-bound: the service is created after its options. */
  service: () => CoreService;
  log?: Log;
  /** CORE-05 devnet identity (WALLETS_FILE): the prestage must have been made with the same wallets. */
  walletsPlatform?: string;
  /** Seeds other than "prestage" (CORE-05's devnet participants for a live flow). Without it they are refused. */
  other?: CoreServiceOptions["seed"];
}

export function prestageSeedOptions(d: PrestageSeedDeps): Pick<CoreServiceOptions, "seed" | "checkSeed" | "defaultSeed"> {
  const load = () => import("./prestage-import.ts");
  const opts = async () => {
    const m = await load();
    return { ...m.prestagePathsFromEnv(d.env, d.dataDir), store: d.store, vault: d.vault, ledger: d.ledger, walletsPlatform: d.walletsPlatform, now: () => d.service().clock.now(), log: d.log };
  };
  const refuse = (name: DemoSeed) => {
    throw new DomainError("VALIDATION", `Seed "${name}" is the fake-ledger scenario; with LEDGER_MODE=devnet use seed "prestage"`);
  };
  return {
    defaultSeed: "prestage",
    checkSeed: async (name) => {
      if (name !== "prestage") return d.other ? undefined : refuse(name);
      await (await load()).planPrestageImport(await opts());
    },
    seed: async (name) => {
      if (name !== "prestage") return d.other ? d.other(name) : refuse(name);
      const m = await load();
      const imported = await m.importPrestage(await opts());
      await m.stagePrestageEvidence(d.service(), imported, d.log);
    },
  };
}
