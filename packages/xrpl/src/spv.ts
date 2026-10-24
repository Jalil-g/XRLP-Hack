// Per-project SPV account: borrower of the loan, owner of milestone escrows.
// After setup: master key disabled, only the SignerList (quorum 3) can move funds.
import { AccountSetAsfFlags, multisign, Wallet, type SubmittableTransaction } from "xrpl";
import { getClient, signAndSubmit, submitBlob, type TxResult } from "./client.ts";
import { fundFromFaucet } from "./wallets.ts";
import { ensureTrustline } from "./rlusd.ts";

export const SPV_QUORUM = 3;

export interface SpvSigners {
  inspectorA: string;
  inspectorB: string;
  aiAgent: string;
  platform: string;
}

/** inspectors w2, aiAgent w1, platform w1, quorum 3 -> every action needs an inspector. */
export function spvSignerEntries(s: SpvSigners) {
  return [
    { SignerEntry: { Account: s.inspectorA, SignerWeight: 2 } },
    { SignerEntry: { Account: s.inspectorB, SignerWeight: 2 } },
    { SignerEntry: { Account: s.aiAgent, SignerWeight: 1 } },
    { SignerEntry: { Account: s.platform, SignerWeight: 1 } },
  ];
}

/** Create + fund a fresh SPV account and open its RLUSD trust line (master key still enabled). */
export async function createSpvAccount(issuer: string): Promise<{ wallet: Wallet; trustTx?: TxResult }> {
  const wallet = Wallet.generate();
  await fundFromFaucet(wallet);
  const trustTx = await ensureTrustline(wallet, issuer);
  return { wallet, trustTx };
}

export async function setSpvSignerList(spv: Wallet, signers: SpvSigners): Promise<TxResult> {
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

/**
 * Multi-sign a transaction for `account` (the SPV) with `signers` and submit it.
 * Callers pick signers whose weights reach quorum (e.g. inspectorA + aiAgent = 3).
 */
export async function multisignAndSubmit<T extends SubmittableTransaction>(tx: T, signers: Wallet[]): Promise<TxResult> {
  const client = await getClient();
  const prepared = await client.autofill({ ...tx, SigningPubKey: "" }, signers.length);
  const blobs = signers.map((w) => w.sign(prepared, true).tx_blob);
  return submitBlob(multisign(blobs), tx.TransactionType);
}

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
