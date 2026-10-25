// XRPL-11: shape of `.data/prestage.json`, written by `pnpm --filter @xrlp/xrpl prestage` and read by core (CORE-07).
// Pure (no network). Preimages NEVER appear here: they go to the separate `.data/prestage-preimages.json`
// (release-service stand-in, see PrestagePreimagesFile), which core's release service imports into its encrypted store.

export const PRESTAGE_VERSION = 1 as const;
/** Default paths, relative to the repo root (both gitignored under .data/). */
export const PRESTAGE_FILE = ".data/prestage.json";
export const PRESTAGE_PREIMAGES_FILE = ".data/prestage-preimages.json";

export const PRESTAGE_KEYS = ["A", "B", "C"] as const;
export type PrestageKey = (typeof PRESTAGE_KEYS)[number];

/**
 * What each pre-staged project is for on stage (docs/04-demo-script.md):
 *  - A `ready`:   verified + funded + closed, 3 escrows open, generous RedemptionDate (beats 2-5: release M1, fraud M2, try-steal)
 *  - B `stalled`: M1 released, M2 escrow's CancelAfter already PAST, long PaymentInterval (beat 6: cancel -> on-time refund LoanPay)
 *  - C `repaid`:  all escrows released, loan fully repaid, vault past RedemptionDate (investors can withdraw)
 */
export type PrestageScenario = "ready" | "stalled" | "repaid";

/** Ledger-side state of one milestone escrow at the time prestage finished. */
export type PrestageEscrowState = "open" | "expired" | "finished" | "cancelled";

export interface PrestageEscrow {
  milestoneId: string;
  /** Milestone index (0-based), same order as `milestones`. */
  index: number;
  /** Escrow owner = project SPV. */
  owner: string;
  /** Sequence of the EscrowCreate (EscrowFinish/EscrowCancel `OfferSequence`). */
  offerSequence: number;
  /** Hex PREIMAGE-SHA-256 condition (public; the preimage is only in the preimages file). */
  condition: string;
  /** ISO. EscrowCancel is possible once the validated ledger close time is past this. */
  cancelAfter: string;
  /** RLUSD. */
  amount: string;
  destination: string;
  createTx: string;
  /** ISO validation time of the EscrowCreate (photo-freshness checks). */
  createdAt?: string;
  state: PrestageEscrowState;
  finishTx?: string;
  cancelTx?: string;
}

export interface PrestageMilestone {
  id: string;
  index: number;
  templateKey: string;
  title: string;
  amount: string;
  /** Status core should import (shared MilestoneStatus values). */
  status: "pending" | "released" | "refunded";
}

export interface PrestageTx {
  step: string;
  type: string;
  /** Engine result; expected failures (tecNO_AUTH ...) are recorded too. */
  result: string;
  hash: string;
  explorerUrl: string;
}

export interface PrestageProject {
  key: PrestageKey;
  scenario: PrestageScenario;
  /** Project id used in tx Data fields and the wallet store (`spvs[projectId]`). Fresh on every run. */
  projectId: string;
  name: string;
  /** shared ProjectType. */
  type: "residential_new" | "residential_renovation" | "commercial_small";
  siteAddress: string;
  siteGeo: { lat: number; lng: number; radiusM: number };
  /** Shared `ProjectStatus` core should import. */
  status: "escrowed" | "stalled" | "completed";
  builder: string;
  /** Inspector the AI assigned (on the SPV signer list, VERIFIED_INSPECTOR). */
  assignedInspector: string;
  terms: {
    principal: string;
    interestRateBps: number;
    /** On-ledger schedule (the source of truth; the termDays/paymentIntervalDays in core's LoanTerms are derived). */
    paymentTotal: number;
    paymentIntervalS: number;
    originationFee: string;
  };
  milestones: PrestageMilestone[];
  chain: {
    spv: string;
    vaultId: string;
    vaultPseudoAccount: string;
    shareMptIssuanceId: string;
    loanBrokerId: string;
    loanId: string;
    domainId: string;
  };
  /** SPV SignerList (each weight 1, quorum 3), master key disabled. */
  spv: { address: string; signers: { platform: string; builder: string; inspector: string; trustee: string }; quorum: number };
  cover: { amount: string; minimum: string; txHash: string };
  /** Fee Payment builder -> platform (VERIFIED_BUILDER per project). */
  verificationFee: { amount: string; txHash: string };
  investments: { role: string; investor: string; amount: string; txHash: string }[];
  escrows: PrestageEscrow[];
  dates: {
    /** Vault SubscriptionDate (= funding deadline), ISO. */
    subscriptionDate: string;
    /** Vault RedemptionDate (withdrawals reopen), ISO. */
    redemptionDate: string;
    loanSetAt: string;
    /** ISO; "" once the loan is paid off. */
    nextPaymentDueDate: string;
  };
  /** Snapshot at the end of prestage (read models, docs/05-api.md §2). */
  snapshot: {
    vault?: { assetsTotal: string; assetsAvailable: string; sharesOutstanding: string; sharePrice: string; phase: string };
    loan?: { principalOutstanding: string; totalValueOutstanding: string; periodicPayment: string; paymentRemaining: number; nextPaymentDueDate: string };
    spvRlusd: string;
  };
  txs: PrestageTx[];
}

export interface PrestageFile {
  version: typeof PRESTAGE_VERSION;
  network: string;
  createdAt: string;
  finishedAt: string;
  rlusd: { currency: string; issuer: string };
  /** Platform PermissionedDomain (AcceptedCredentials = [platform, KYC_INVESTOR]) gating every private vault. */
  domainId: string;
  /** Demo account addresses by role (no seeds). investor3 deliberately has no KYC_INVESTOR. */
  accounts: Record<string, string>;
  /** Path of the preimages file (relative to the repo root). */
  preimagesFile: string;
  projects: Partial<Record<PrestageKey, PrestageProject>>;
}

/** `.data/prestage-preimages.json`. SECRET: release-service stand-in until CORE-12 owns preimage generation. */
export interface PrestagePreimagesFile {
  version: typeof PRESTAGE_VERSION;
  warning: string;
  /** projectId -> milestoneId -> { condition, preimage }. Entries of older runs are kept (never lose a secret). */
  projects: Record<string, Record<string, { condition: string; preimage: string; createdAt: string }>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Light structural check of a parsed prestage.json (throws with the first problem). Also refuses a file that
 * contains anything looking like a preimage/fulfillment/seed, so a secret never travels with it.
 */
export function parsePrestageFile(json: unknown): PrestageFile {
  if (!isObj(json)) throw new Error("prestage: not an object");
  if (json.version !== PRESTAGE_VERSION) throw new Error(`prestage: unsupported version ${String(json.version)}`);
  for (const k of ["network", "createdAt", "domainId", "preimagesFile"] as const) {
    if (typeof json[k] !== "string") throw new Error(`prestage: ${k} must be a string`);
  }
  if (!isObj(json.accounts) || !isObj(json.projects) || !isObj(json.rlusd)) throw new Error("prestage: accounts/projects/rlusd missing");
  const text = JSON.stringify(json);
  if (/"(preimage|fulfillment|seed|secret)"\s*:/i.test(text)) throw new Error("prestage: contains a secret-looking field (preimage/fulfillment/seed)");
  for (const [key, p] of Object.entries(json.projects)) {
    if (!(PRESTAGE_KEYS as readonly string[]).includes(key)) throw new Error(`prestage: unknown project key ${key}`);
    if (!isObj(p)) throw new Error(`prestage: project ${key} not an object`);
    if (p.key !== key) throw new Error(`prestage: project ${key} has key ${String(p.key)}`);
    if (!isObj(p.chain) || typeof p.chain.loanId !== "string" || typeof p.chain.vaultId !== "string") throw new Error(`prestage: project ${key} chain incomplete`);
    if (!Array.isArray(p.escrows) || !Array.isArray(p.milestones)) throw new Error(`prestage: project ${key} escrows/milestones missing`);
    for (const e of p.escrows as unknown[]) {
      if (!isObj(e) || typeof e.offerSequence !== "number" || typeof e.condition !== "string" || typeof e.cancelAfter !== "string") {
        throw new Error(`prestage: project ${key} has a malformed escrow`);
      }
    }
  }
  return json as unknown as PrestageFile;
}

/**
 * Vault dates + escrow CancelAfters for a pre-staged project, all in Ripple-epoch seconds. Pure, unit-tested.
 * `subscriptionDate` is when deposits close; LoanSet must land in (subscriptionDate, subscriptionDate + closeWindowS]
 * so that LoanSet + interval x total + 60 <= RedemptionDate holds (XLS-66 tecNO_PERMISSION otherwise).
 */
export function prestageVaultDates(p: { subscriptionDate: number; paymentTotal: number; paymentIntervalS: number; closeWindowS: number; bufferS?: number }): {
  subscriptionDate: number;
  redemptionDate: number;
  loanSetDeadline: number;
} {
  if (p.paymentTotal < 1 || p.paymentIntervalS < 1 || p.closeWindowS < 1) throw new Error("prestage: schedule values must be >= 1");
  const loanSetDeadline = p.subscriptionDate + p.closeWindowS;
  const redemptionDate = Math.max(loanSetDeadline + p.paymentTotal * p.paymentIntervalS + 60 + (p.bufferS ?? 0), p.subscriptionDate + 180);
  return { subscriptionDate: p.subscriptionDate, redemptionDate, loanSetDeadline };
}
