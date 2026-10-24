// XLS-70 Credentials issued by the platform: VERIFIED_BUILDER, KYC_INVESTOR.
// TODO(ticket): PermissionedDomainSet + private vault (DomainID) so only KYC_INVESTOR holders can deposit.
import { convertStringToHex, type Wallet } from "xrpl";
import { getClient, signAndSubmit, type TxResult } from "./client.ts";

export type CredentialType = "VERIFIED_BUILDER" | "KYC_INVESTOR";

export const credentialTypeHex = (t: CredentialType) => convertStringToHex(t);

export async function createCredential(issuer: Wallet, subject: string, type: CredentialType, uri?: string): Promise<TxResult> {
  return signAndSubmit(issuer, {
    TransactionType: "CredentialCreate",
    Account: issuer.classicAddress,
    Subject: subject,
    CredentialType: credentialTypeHex(type),
    ...(uri ? { URI: convertStringToHex(uri) } : {}),
  });
}

export async function acceptCredential(subject: Wallet, issuer: string, type: CredentialType): Promise<TxResult> {
  return signAndSubmit(subject, {
    TransactionType: "CredentialAccept",
    Account: subject.classicAddress,
    Issuer: issuer,
    CredentialType: credentialTypeHex(type),
  });
}

/** Returns "accepted" | "pending" | "none" for a subject/issuer/type. */
export async function credentialStatus(subject: string, issuer: string, type: CredentialType): Promise<"accepted" | "pending" | "none"> {
  const client = await getClient();
  const res = await client.request({ command: "account_objects", account: subject, type: "credential", ledger_index: "validated" });
  const hex = credentialTypeHex(type);
  const c = (res.result.account_objects as unknown as { Issuer: string; CredentialType: string; Flags: number }[]).find(
    (o) => o.Issuer === issuer && o.CredentialType === hex,
  );
  if (!c) return "none";
  return c.Flags & 0x00010000 ? "accepted" : "pending";
}
