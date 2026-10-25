// XLS-70 Credentials issued by the platform (VERIFIED_BUILDER, VERIFIED_INSPECTOR, KYC_INVESTOR) and the XLS-80
// Permissioned Domain that gates the private vaults (AcceptedCredentials = [platform, KYC_INVESTOR]).
import { convertHexToString, convertStringToHex, type Wallet } from "xrpl";
import { createdNodeId, getClient, isNotFound, signAndSubmit, type TxResult } from "./client.ts";

export const CREDENTIAL_TYPES = ["VERIFIED_BUILDER", "VERIFIED_INSPECTOR", "KYC_INVESTOR"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];
export type CredentialStatus = "accepted" | "pending" | "none";

/** CredentialType on the ledger = hex of the ASCII name, e.g. KYC_INVESTOR -> 4B59435F494E564553544F52. */
export const credentialTypeHex = (t: CredentialType) => convertStringToHex(t);
/** Inverse of credentialTypeHex (returns the raw ASCII for unknown types). */
export const credentialTypeFromHex = (hex: string): string => convertHexToString(hex);

const LSF_ACCEPTED = 0x00010000;

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

/** The Credential ledger object (subject's owner directory). */
export interface CredentialEntry {
  index: string;
  Subject: string;
  Issuer: string;
  CredentialType: string;
  Flags: number;
  /** Last tx that touched it (the CredentialCreate, or the CredentialAccept once accepted). */
  PreviousTxnID: string;
}

/** The subject's credential from `issuer` of `type`, or undefined (also for an unfunded subject). */
export async function getCredential(subject: string, issuer: string, type: CredentialType): Promise<CredentialEntry | undefined> {
  const client = await getClient();
  let objects: (CredentialEntry & { LedgerEntryType?: string })[] = [];
  try {
    for (let marker: unknown = undefined, first = true; first || marker; first = false) {
      const res = await client.request({
        command: "account_objects",
        account: subject,
        type: "credential",
        ledger_index: "validated",
        ...(marker ? { marker } : {}),
      });
      objects = objects.concat(res.result.account_objects as unknown as typeof objects);
      marker = res.result.marker;
    }
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
  const hex = credentialTypeHex(type).toUpperCase();
  return objects.find((o) => o.Issuer === issuer && o.CredentialType.toUpperCase() === hex);
}

/** Returns "accepted" | "pending" | "none" for a subject/issuer/type. */
export async function credentialStatus(subject: string, issuer: string, type: CredentialType): Promise<CredentialStatus> {
  const c = await getCredential(subject, issuer, type);
  if (!c) return "none";
  return c.Flags & LSF_ACCEPTED ? "accepted" : "pending";
}

/** CredentialDelete by the issuer. Idempotent: no tx (undefined) if the subject holds no such credential. */
export async function revokeCredential(issuer: Wallet, subject: string, type: CredentialType): Promise<TxResult | undefined> {
  if (!(await getCredential(subject, issuer.classicAddress, type))) return undefined;
  return signAndSubmit(issuer, {
    TransactionType: "CredentialDelete",
    Account: issuer.classicAddress,
    Subject: subject,
    CredentialType: credentialTypeHex(type),
  });
}

export interface EnsureCredentialResult {
  status: CredentialStatus;
  createTx?: TxResult;
  acceptTx?: TxResult;
}

/**
 * Idempotent issue (+ accept): CredentialCreate only if none exists, CredentialAccept only if still pending.
 * `subject` must be a Wallet when `accept` is true (the subject signs CredentialAccept).
 */
export async function ensureCredential(p: {
  issuer: Wallet;
  subject: Wallet | string;
  type: CredentialType;
  uri?: string;
  accept?: boolean;
}): Promise<EnsureCredentialResult> {
  const subjectAddr = typeof p.subject === "string" ? p.subject : p.subject.classicAddress;
  const accept = p.accept ?? true;
  const out: EnsureCredentialResult = { status: await credentialStatus(subjectAddr, p.issuer.classicAddress, p.type) };
  if (out.status === "none") {
    out.createTx = await createCredential(p.issuer, subjectAddr, p.type, p.uri);
    out.status = "pending";
  }
  if (accept && out.status === "pending") {
    if (typeof p.subject === "string") throw new Error(`ensureCredential: accepting ${p.type} needs the subject's Wallet`);
    out.acceptTx = await acceptCredential(p.subject, p.issuer.classicAddress, p.type);
    out.status = "accepted";
  }
  return out;
}

// ---------------------------------------------------------------- permissioned domain (XLS-80)

export interface AcceptedCredential {
  issuer: string;
  type: CredentialType;
}

export interface PermissionedDomainEntry {
  index: string;
  Owner: string;
  Sequence: number;
  AcceptedCredentials: { Credential: { Issuer: string; CredentialType: string } }[];
}

const sameCredentialSet = (d: PermissionedDomainEntry, want: AcceptedCredential[]) => {
  const key = (issuer: string, hex: string) => `${issuer}:${hex.toUpperCase()}`;
  const have = new Set(d.AcceptedCredentials.map((c) => key(c.Credential.Issuer, c.Credential.CredentialType)));
  return have.size === want.length && want.every((w) => have.has(key(w.issuer, credentialTypeHex(w.type))));
};

/** All PermissionedDomain objects owned by `owner`. */
export async function listDomains(owner: string): Promise<PermissionedDomainEntry[]> {
  const client = await getClient();
  try {
    const res = await client.request({ command: "account_objects", account: owner, type: "permissioned_domain", ledger_index: "validated" });
    return res.result.account_objects as unknown as PermissionedDomainEntry[];
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

/**
 * PermissionedDomainSet by `owner`. Idempotent: reuses an owned domain with exactly the same AcceptedCredentials
 * (then `tx` is undefined).
 */
export async function ensureDomain(owner: Wallet, accepted: AcceptedCredential[]): Promise<{ domainId: string; tx?: TxResult }> {
  if (accepted.length < 1 || accepted.length > 10) throw new Error("PermissionedDomain needs 1..10 AcceptedCredentials");
  const existing = (await listDomains(owner.classicAddress)).find((d) => sameCredentialSet(d, accepted));
  if (existing) return { domainId: existing.index };
  const tx = await signAndSubmit(owner, {
    TransactionType: "PermissionedDomainSet",
    Account: owner.classicAddress,
    AcceptedCredentials: accepted.map((a) => ({ Credential: { Issuer: a.issuer, CredentialType: credentialTypeHex(a.type) } })),
  });
  const domainId = createdNodeId(tx, "PermissionedDomain");
  if (!domainId) throw new Error(`PermissionedDomainSet ${tx.hash}: no PermissionedDomain node in metadata`);
  return { domainId, tx };
}
