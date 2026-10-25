// CORE-07: route 21 wiring for LEDGER_MODE=devnet. `seed: "prestage"` loads the XRPL prestage instead of the fake
// back-dated scenario. So do `seed: "maple-st"` (the web's /demo Reset button always sends it, apps/web/lib/api.ts) and
// an empty body: on devnet the Maple St story IS the prestage. `seed: "participants"` goes to `other` (CORE-05: devnet
// builder/panel/KYC'd investors, no projects; the live-flow e2e script uses it). prestage-import.ts (and with it
// @xrlp/xrpl) is loaded lazily, so fake-mode cores never import it.
import type { LedgerPort } from "@xrlp/shared";
import type { PrestageFile } from "@xrlp/xrpl";
import type { DemoSeed } from "../api-surface.ts";
import type { AttestAutofill } from "./prestage-import.ts";
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
  /** Seed "participants" (CORE-05's devnet participants for a live flow). Without it, that seed is refused. */
  other?: CoreServiceOptions["seed"];
  /**
   * WALLETS_FILE holding the assigned inspector's devnet key: Project A's prestaged audits are then signed by the inspector
   * (route 10's signed path). Without it they are platform-attested, which a devnet core refuses once #173 lands.
   */
  walletsFile?: string;
  /** Fee/Sequence/LastLedgerSequence for those audits. Default: devnet autofill (tests pass an offline one). */
  autofill?: AttestAutofill;
}

/** Devnet route 21: "maple-st" (the web's Reset button) and no seed mean the prestage; "participants" stays as is. */
export function devnetSeed(name: DemoSeed | undefined): DemoSeed {
  return !name || name === "maple-st" ? "prestage" : name;
}

export function prestageSeedOptions(d: PrestageSeedDeps): Pick<CoreServiceOptions, "seed" | "checkSeed" | "defaultSeed"> {
  const load = () => import("./prestage-import.ts");
  const opts = async () => {
    const m = await load();
    return { ...m.prestagePathsFromEnv(d.env, d.dataDir), store: d.store, vault: d.vault, ledger: d.ledger, walletsPlatform: d.walletsPlatform, now: () => d.service().clock.now(), log: d.log };
  };
  type ImportModule = Awaited<ReturnType<typeof load>>;
  const signer = (m: ImportModule, file: PrestageFile) => {
    const inspector = file.projects.A?.assignedInspector;
    return d.walletsFile && inspector ? m.walletAuditSigner(d.walletsFile, inspector, d.autofill) : undefined;
  };
  const refuse = (name: DemoSeed) => {
    throw new DomainError("VALIDATION", `Seed "${name}" needs the WALLETS_FILE identities (CORE-05 wiring); with LEDGER_MODE=devnet use seed "prestage"`);
  };
  return {
    defaultSeed: "prestage",
    checkSeed: async (requested) => {
      const name = devnetSeed(requested);
      if (name !== "prestage") return d.other ? undefined : refuse(name);
      const m = await load();
      const plan = await m.planPrestageImport(await opts());
      await signer(m, plan.result.file); // the inspector key must be there BEFORE the reset wipes anything
    },
    seed: async (requested) => {
      const name = devnetSeed(requested);
      if (name !== "prestage") return d.other ? d.other(name) : refuse(name);
      const m = await load();
      const imported = await m.importPrestage(await opts());
      await m.stagePrestageEvidence(d.service(), imported, d.log, await signer(m, imported.file));
    },
  };
}
