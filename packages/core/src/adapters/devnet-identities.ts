// CORE-05 · Demo identities for LEDGER_MODE=devnet. Core's demo parties (scenario.ts DEMO / DEMO_ADDRESSES) are
// deterministic fake addresses; on devnet every signing party must be a wallet in WALLETS_FILE (written by
// `pnpm --filter @xrlp/xrpl bootstrap`), so the same names map onto the xrpl roles here. Only addresses are read:
// seeds stay in the file and are used by the xrpl adapter alone.
import { existsSync, readFileSync } from "node:fs";
import type { XrplAddress } from "@xrlp/shared";
import type { WalletFile, WalletRole } from "@xrlp/xrpl";
import { DEMO } from "../demo/scenario.ts";
import type { CoreService, RegisterBuilderInput, RegisterInspectorInput } from "../service.ts";

export interface DevnetIdentities {
  platform: XrplAddress;
  aiAgent: XrplAddress;
  releaseService: XrplAddress;
  /** 4th SPV signer (never signs in core; listed for the role picker / docs). */
  trustee: XrplAddress;
  builder: RegisterBuilderInput & { id: string; address: XrplAddress };
  /** investor1/2 hold KYC_INVESTOR after bootstrap; investor3 never does (the tecNO_AUTH beat). */
  investors: { name: string; address: XrplAddress; role: WalletRole; kyc: boolean }[];
  /** The verified inspector panel (VERIFIED_INSPECTOR from bootstrap). */
  inspectors: (RegisterInspectorInput & { role: WalletRole })[];
}

/** Core demo party -> xrpl wallet role. One builder wallet exists, so only Hudson Valley Builders maps. */
export const DEVNET_ROLE_MAP = {
  platform: "platform",
  aiAgent: "aiAgent",
  releaseService: "releaseService",
  trustee: "trustee",
  builder: "builder",
  investors: ["investor1", "investor2", "investor3"],
  inspectors: ["inspector1", "inspector2", "inspector3"],
} as const satisfies Record<string, WalletRole | readonly WalletRole[]>;

export class DevnetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevnetConfigError";
  }
}

/** Pure: wallet file -> demo identities. Throws DevnetConfigError on a non-devnet file or a missing role. */
export function identitiesFromWalletFile(file: WalletFile, path = "WALLETS_FILE"): DevnetIdentities {
  if (file.network !== "devnet") throw new DevnetConfigError(`${path} is for network "${file.network}"; LEDGER_MODE=devnet needs a devnet wallet file`);
  const addr = (role: WalletRole): XrplAddress => {
    const a = file.wallets?.[role]?.address;
    if (!a) throw new DevnetConfigError(`${path} has no "${role}" wallet; re-run: pnpm --filter @xrlp/xrpl bootstrap`);
    return a;
  };
  const investors = DEMO.investors.map((inv, i) => {
    const role = DEVNET_ROLE_MAP.investors[i]!;
    return { name: inv.name, address: addr(role), role, kyc: role !== "investor3" };
  });
  const inspectors = Object.values(DEMO.inspectors).map((ins, i) => {
    const role = DEVNET_ROLE_MAP.inspectors[i]!;
    return { ...ins, trades: [...ins.trades], address: addr(role), role };
  });
  return {
    platform: addr("platform"),
    aiAgent: addr("aiAgent"),
    releaseService: addr("releaseService"),
    trustee: addr("trustee"),
    builder: { ...DEMO.builders.hudson, address: addr("builder") },
    investors,
    inspectors,
  };
}

export function loadDevnetIdentities(walletsFile: string): DevnetIdentities {
  if (!existsSync(walletsFile)) throw new DevnetConfigError(`WALLETS_FILE ${walletsFile} not found. Run: WALLETS_FILE=${walletsFile} pnpm --filter @xrlp/xrpl bootstrap`);
  let file: WalletFile;
  try {
    file = JSON.parse(readFileSync(walletsFile, "utf8")) as WalletFile;
  } catch (e) {
    throw new DevnetConfigError(`WALLETS_FILE ${walletsFile} is not valid JSON: ${(e as Error).message}`);
  }
  return identitiesFromWalletFile(file, walletsFile);
}

/**
 * Route 21 seed on devnet: register the demo builder + inspector panel and KYC investor1/2 under their devnet addresses.
 * No projects (those come from the XRPL prestage, CORE-07). Credentials bootstrap already issued are not re-submitted
 * (the adapter returns []).
 */
export async function seedDevnetParticipants(svc: CoreService, ids: DevnetIdentities, log: (line: string) => void = () => {}): Promise<void> {
  await svc.registerBuilder(ids.builder);
  for (const { role: _role, ...i } of ids.inspectors) await svc.registerInspector(i);
  for (const i of ids.investors.filter((x) => x.kyc)) await svc.kycInvestor(i.address, i.name);
  log(`devnet participants: builder ${ids.builder.address}, ${ids.inspectors.length} panel inspectors, ${ids.investors.filter((x) => x.kyc).length} KYC'd investors`);
}
