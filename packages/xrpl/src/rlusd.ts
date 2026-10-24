// Mock RLUSD issuer: account flags, trust lines, issuance, balances.
import { AccountSetAsfFlags, type IssuedCurrencyAmount, type Wallet } from "xrpl";
import { RLUSD_CURRENCY } from "./config.ts";
import { getClient, signAndSubmit, type TxResult } from "./client.ts";

export interface RlusdAsset {
  currency: string;
  issuer: string;
}

export const rlusdAsset = (issuer: string): RlusdAsset => ({ currency: RLUSD_CURRENCY, issuer });

export const rlusdAmount = (issuer: string, value: string): IssuedCurrencyAmount => ({
  currency: RLUSD_CURRENCY,
  issuer,
  value,
});

const LSF_DEFAULT_RIPPLE = 0x00800000;
const LSF_ALLOW_TRUSTLINE_LOCKING = 0x40000000;

/**
 * Issuer flags: DefaultRipple (holder<->vault/escrow transfers ripple through the issuer)
 * and AllowTrustLineLocking (required for IOU escrows, XLS-85 TokenEscrow). Idempotent.
 */
export async function configureIssuer(issuer: Wallet): Promise<TxResult[]> {
  const client = await getClient();
  const info = await client.request({ command: "account_info", account: issuer.classicAddress, ledger_index: "validated" });
  const flags = info.result.account_data.Flags;
  const out: TxResult[] = [];
  if (!(flags & LSF_DEFAULT_RIPPLE)) {
    out.push(await signAndSubmit(issuer, { TransactionType: "AccountSet", Account: issuer.classicAddress, SetFlag: AccountSetAsfFlags.asfDefaultRipple }));
  }
  if (!(flags & LSF_ALLOW_TRUSTLINE_LOCKING)) {
    out.push(
      await signAndSubmit(issuer, { TransactionType: "AccountSet", Account: issuer.classicAddress, SetFlag: AccountSetAsfFlags.asfAllowTrustLineLocking }),
    );
  }
  return out;
}

/** Trust line from `holder` to the RLUSD issuer. Returns undefined if it already exists. */
export async function ensureTrustline(holder: Wallet, issuer: string, limit = "1000000000"): Promise<TxResult | undefined> {
  const client = await getClient();
  const lines = await client.request({ command: "account_lines", account: holder.classicAddress, peer: issuer, ledger_index: "validated" });
  if (lines.result.lines.some((l) => l.currency === RLUSD_CURRENCY)) return undefined;
  return signAndSubmit(holder, {
    TransactionType: "TrustSet",
    Account: holder.classicAddress,
    LimitAmount: rlusdAmount(issuer, limit),
  });
}

export async function rlusdBalance(address: string, issuer: string): Promise<string> {
  const client = await getClient();
  try {
    const lines = await client.request({ command: "account_lines", account: address, peer: issuer, ledger_index: "validated" });
    return lines.result.lines.find((l) => l.currency === RLUSD_CURRENCY)?.balance ?? "0";
  } catch (e) {
    if (String((e as Error).message).includes("actNotFound") || String((e as Error).message).includes("Account not found")) return "0";
    throw e;
  }
}

/** Issue RLUSD from the issuer to a holder (holder must have a trust line). */
export async function issueRlusd(issuer: Wallet, to: string, value: string): Promise<TxResult> {
  return signAndSubmit(issuer, {
    TransactionType: "Payment",
    Account: issuer.classicAddress,
    Destination: to,
    Amount: rlusdAmount(issuer.classicAddress, value),
  });
}

/** Top a holder up to at least `target` RLUSD. Returns undefined if already there. */
export async function topUpRlusd(issuer: Wallet, to: string, target: number): Promise<TxResult | undefined> {
  const bal = Number(await rlusdBalance(to, issuer.classicAddress));
  if (bal >= target) return undefined;
  return issueRlusd(issuer, to, String(target - bal));
}

/** Plain RLUSD payment between two holders. */
export async function payRlusd(from: Wallet, to: string, issuer: string, value: string): Promise<TxResult> {
  return signAndSubmit(from, { TransactionType: "Payment", Account: from.classicAddress, Destination: to, Amount: rlusdAmount(issuer, value) });
}
