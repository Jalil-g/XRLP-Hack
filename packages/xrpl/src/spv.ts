// Per-project SPV account: borrower of the loan, owner of milestone escrows.
// After setup: master key disabled, only the SignerList {platform, builder, inspector, trustee} (w1 each, quorum 3)
// can act for it. The AI key is NOT a signer (it only attests). See docs/03-architecture.md "SPV signer list".
import { AccountSetAsfFlags, hashes, isValidClassicAddress, multisign, Wallet, type SubmittableTransaction } from "xrpl";
import { getClient, signAndSubmit, submitWithSigner, XrplTxError, type SubmitOptions, type TxResult } from "./client.ts";
import { fundFromFaucet } from "./wallets.ts";
import { ensureTrustline } from "./rlusd.ts";

export const SPV_QUORUM = 3;
export const SPV_SIGNER_WEIGHT = 1;

/** The four SPV signers (addresses). inspector = the project's assigned inspector; builder = the project's builder. */
export interface SpvSigners {
  platform: string;
  builder: string;
  inspector: string;
  trustee: string;
}

/**
 * Pure (security review M6): why these signers must not go on an SPV list. Each slot must be a classic address, and none
 * may be a key that must never control the SPV (`forbidden`: role → address, e.g. aiAgent, releaseService, issuer):
 * the AI only attests, and with platform + trustee also server-held, one more server key would reach quorum alone.
 */
export function spvSignerProblems(s: SpvSigners, forbidden: Record<string, string> = {}): string[] {
  const issues: string[] = [];
  for (const [slot, address] of Object.entries(s)) {
    if (typeof address !== "string" || !isValidClassicAddress(address)) {
      issues.push(`SPV signer ${slot} is not a classic XRPL address`);
      continue;
    }
    const role = Object.entries(forbidden).find(([, a]) => a === address)?.[0];
    if (role) issues.push(`SPV signer ${slot} ${address} is the ${role} key, which must never be an SPV signer`);
  }
  return issues;
}

/**
 * Pure: why `signerAddresses` can't countersign for this SPV with its multisig quorum. Adds the master-key check
 * (security review L3): while the master key is enabled the SPV's own seed controls the principal alone, so the
 * multisig close path refuses it (the explicit single-key fallback is a separate option).
 */
export function spvCountersignProblems(info: Pick<SpvInfo, "signerQuorum" | "signers" | "masterDisabled">, signerAddresses: string[]): string[] {
  if (info.signerQuorum == null) return ["SPV has no SignerList"];
  const issues: string[] = [];
  const q = checkSignerQuorum({ quorum: info.signerQuorum, signers: info.signers }, signerAddresses);
  if (!q.ok) {
    issues.push(
      q.unknown.length ? `not on the SPV list: ${q.unknown.join(", ")}` : q.duplicates.length ? `duplicate signers: ${q.duplicates.join(", ")}` : `weight ${q.weight} < quorum ${q.quorum}`,
    );
  }
  if (!info.masterDisabled) issues.push("SPV master key is still enabled (lock the SPV first, or use the single-key fallback explicitly)");
  return issues;
}

/** {platform, builder, inspector, trustee} weight 1 each. Throws on duplicates (rippled: temBAD_SIGNER). */
export function spvSignerEntries(s: SpvSigners) {
  const accounts = [s.platform, s.builder, s.inspector, s.trustee];
  if (new Set(accounts).size !== accounts.length) throw new Error(`SPV signers must be 4 distinct accounts: ${accounts.join(", ")}`);
  return accounts.map((Account) => ({ SignerEntry: { Account, SignerWeight: SPV_SIGNER_WEIGHT } }));
}

/** Create + fund a fresh SPV account and open its RLUSD trust line (master key still enabled). */
export async function createSpvAccount(issuer: string): Promise<{ wallet: Wallet; trustTx?: TxResult }> {
  const wallet = Wallet.generate();
  await fundFromFaucet(wallet);
  const trustTx = await ensureTrustline(wallet, issuer);
  return { wallet, trustTx };
}

export async function setSpvSignerList(spv: Wallet, signers: SpvSigners): Promise<TxResult> {
  if (Object.values(signers).includes(spv.classicAddress)) throw new Error("the SPV cannot be its own signer");
  return signAndSubmit(spv, {
    TransactionType: "SignerListSet",
    Account: spv.classicAddress,
    SignerQuorum: SPV_QUORUM,
    SignerEntries: spvSignerEntries(signers),
  });
}

export async function disableMasterKey(spv: Wallet): Promise<TxResult> {
  return signAndSubmit(spv, { TransactionType: "AccountSet", Account: spv.classicAddress, SetFlag: AccountSetAsfFlags.asfDisableMaster });
}

export interface CreatedSpv {
  address: string;
  /** Master-key wallet. Useless once locked (master disabled); kept for the fallback path / records. */
  wallet: Wallet;
  txs: { trustSet?: TxResult; signerListSet?: TxResult; disableMaster?: TxResult };
}

/**
 * Fund a fresh SPV, open its RLUSD trust line, SignerListSet {platform, builder, inspector, trustee} w1 quorum 3,
 * then asfDisableMaster. `lock: false` stops after the trust line (fallback: master key countersigns, lock later).
 */
export async function createSpv(p: { issuer: string; signers: SpvSigners; lock?: boolean }): Promise<CreatedSpv> {
  spvSignerEntries(p.signers); // validate before spending a faucet call
  const { wallet, trustTx } = await createSpvAccount(p.issuer);
  const txs: CreatedSpv["txs"] = trustTx ? { trustSet: trustTx } : {};
  if (p.lock !== false) Object.assign(txs, await lockSpv(wallet, p.signers));
  return { address: wallet.classicAddress, wallet, txs };
}

/** SignerListSet (v2 list) + disable master. Run once; afterwards only the signer list can act for the SPV. */
export async function lockSpv(spv: Wallet, signers: SpvSigners): Promise<{ signerListSet: TxResult; disableMaster: TxResult }> {
  const signerListSet = await setSpvSignerList(spv, signers);
  const disableMaster = await disableMasterKey(spv);
  return { signerListSet, disableMaster };
}

// ---------------------------------------------------------------- multisig

export interface QuorumCheck {
  ok: boolean;
  weight: number;
  quorum: number;
  /** Signers not on the list (rippled: tefBAD_SIGNATURE). */
  unknown: string[];
  /** Same signer given twice (rippled: temBAD_SIGNATURE / dup). */
  duplicates: string[];
}

/** Pure: would these signer addresses satisfy this signer list? Mirrors rippled's checks so we fail fast. */
export function checkSignerQuorum(list: { quorum: number; signers: { account: string; weight: number }[] }, signerAddresses: string[]): QuorumCheck {
  const weights = new Map(list.signers.map((e) => [e.account, e.weight]));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  let weight = 0;
  for (const a of signerAddresses) {
    if (seen.has(a)) duplicates.push(a);
    seen.add(a);
    const w = weights.get(a);
    if (w == null) unknown.push(a);
    else if (!duplicates.includes(a)) weight += w;
  }
  return { ok: unknown.length === 0 && duplicates.length === 0 && weight >= list.quorum, weight, quorum: list.quorum, unknown, duplicates };
}

/** `sign` callback for submitWithSigner: each signer signs the prepared tx for multisig, then the blobs are combined. */
export function multisignWith(signers: Wallet[]): <T extends SubmittableTransaction>(prepared: T) => string {
  return (prepared) => multisign(signers.map((w) => w.sign(prepared, true).tx_blob));
}

/**
 * Autofill (fee sized for `signers.length`), sign with each signer (multisign) and combine. No network submit.
 * Returns the combined blob + its hash. Not locked: submitting this blob later can race other txs from the same
 * account on Sequence. To submit, use submitMultisigned.
 */
export async function multisignBlob<T extends SubmittableTransaction>(tx: T, signers: Wallet[]): Promise<{ blob: string; hash: string }> {
  if (!signers.length) throw new Error(`${tx.TransactionType}: multisig needs at least one signer`);
  const client = await getClient();
  const prepared = await client.autofill({ ...tx, SigningPubKey: "" }, signers.length);
  const blob = multisignWith(signers)(prepared);
  return { blob, hash: hashes.hashSignedTx(blob) };
}

/** Throws the XrplTxError rippled would return (tefNOT_MULTI_SIGNING / tefBAD_QUORUM / tefBAD_SIGNATURE), or returns. */
export function assertSignerQuorum(txType: string, info: Pick<SpvInfo, "signerQuorum" | "signers">, signerAddresses: string[]): void {
  if (info.signerQuorum == null) throw new XrplTxError(txType, "tefNOT_MULTI_SIGNING");
  const q = checkSignerQuorum({ quorum: info.signerQuorum, signers: info.signers }, signerAddresses);
  if (q.ok) return;
  const code = q.unknown.length || q.duplicates.length ? "tefBAD_SIGNATURE" : "tefBAD_QUORUM";
  const why = q.unknown.length ? ` not on signer list: ${q.unknown.join(", ")}` : q.duplicates.length ? ` duplicate: ${q.duplicates.join(", ")}` : ` weight ${q.weight} < quorum ${q.quorum}`;
  throw new XrplTxError(txType, `${code} (local check:${why})`);
}

/** Network seams of submitMultisigned (tests inject fakes; defaults are the real devnet calls). */
export interface MultisigDeps {
  getSpvInfo: (address: string) => Promise<Pick<SpvInfo, "signerQuorum" | "signers">>;
  submitWithSigner: typeof submitWithSigner;
}

export interface SubmitMultisignedOptions extends SubmitOptions {
  /** Check the signers against the on-ledger SignerList first. Default true. */
  checkQuorum?: boolean;
  /** Test seam. */
  deps?: Partial<MultisigDeps>;
}

/**
 * Multi-sign `tx` (whose Account is the SPV / any multisig account) with `signers` and submit it.
 * Before submitting, checks the signers against the account's on-ledger SignerList and throws an XrplTxError
 * (`tefBAD_QUORUM` / `tefBAD_SIGNATURE`, no hash: tef results never reach the ledger) instead of waiting
 * for LastLedgerSequence to expire (what xrpl.js submitAndWait does with a tef). `checkQuorum: false` skips that.
 * Goes through submitWithSigner, so autofill → multisign → submit → validation holds `withAccountLock(tx.Account)`:
 * concurrent multisig txs for the same SPV never race on Sequence, and transient failures re-sign with all signers.
 */
export async function submitMultisigned<T extends SubmittableTransaction>(tx: T, signers: Wallet[], opts: SubmitMultisignedOptions = {}): Promise<TxResult> {
  const { checkQuorum, deps, ...submitOpts } = opts;
  if (!signers.length) throw new Error(`${tx.TransactionType}: multisig needs at least one signer`);
  if (checkQuorum !== false) {
    const info = await (deps?.getSpvInfo ?? getSpvInfo)(tx.Account);
    assertSignerQuorum(tx.TransactionType, info, signers.map((w) => w.classicAddress));
  }
  const submit = deps?.submitWithSigner ?? submitWithSigner;
  return submit(tx.Account, { ...tx, SigningPubKey: "" }, multisignWith(signers), { ...submitOpts, signersCount: signers.length });
}

/** @deprecated compat alias for loan.ts / escrow.ts; use submitMultisigned. */
export const multisignAndSubmit = submitMultisigned;

export interface SpvInfo {
  address: string;
  masterDisabled: boolean;
  signerQuorum?: number;
  signers: { account: string; weight: number }[];
}

export async function getSpvInfo(address: string): Promise<SpvInfo> {
  const client = await getClient();
  const info = await client.request({ command: "account_info", account: address, signer_lists: true, ledger_index: "validated" } as Parameters<typeof client.request>[0]) as { result: unknown };
  const r = info.result as unknown as {
    account_data: { Flags: number; signer_lists?: SignerListNode[] };
    signer_lists?: SignerListNode[];
  };
  const list = (r.signer_lists ?? r.account_data.signer_lists ?? [])[0];
  return {
    address,
    masterDisabled: (r.account_data.Flags & 0x00100000) !== 0,
    signerQuorum: list?.SignerQuorum,
    signers: (list?.SignerEntries ?? []).map((e) => ({ account: e.SignerEntry.Account, weight: e.SignerEntry.SignerWeight })),
  };
}

interface SignerListNode {
  SignerQuorum: number;
  SignerEntries: { SignerEntry: { Account: string; SignerWeight: number } }[];
}
