// XRPL-08 high-level API: verification fee, credentials (3 roles), permissioned domain, attestations (xrlp/attest/v1).
// Wallet args accept a role name, a demo-store address, or a Wallet (fresh spike wallets). Platform/issuer default to
// the demo store (.data/wallets.json) when not passed.
import type { ChainEvent } from "@xrlp/shared";
import { isValidClassicAddress, type Wallet } from "xrpl";
import { PLATFORM_SCOPE } from "./api.ts";
import { submitAttest, submitSignedAttestBlob, type AttestKind, type AttestMemo } from "./attest.ts";
import type { TxResult } from "./client.ts";
import { ensureCredential, ensureDomain, type CredentialStatus, type CredentialType } from "./credentials.ts";
import { toChainEvent, type ChainEventKind } from "./events.ts";
import { payRlusd } from "./rlusd.ts";
import { loadWallets, resolveWallet, type WalletRole } from "./wallets.ts";

type WalletRef = WalletRole | string | Wallet;

/** Address of a role name, an r-address (any, not just the demo store), or a Wallet. */
const toAddress = (w: WalletRef): string => (typeof w !== "string" ? w.classicAddress : isValidClassicAddress(w) ? w : resolveWallet(w).classicAddress);

/**
 * Shared v2 ChainEvent kind per attestation kind. Shared v2 has no dedicated kind for the `release` memo (releaseService
 * attests the evaluateRelease outcome right before EscrowFinish), so it maps to `approval_attested` (noted on #53).
 */
export const ATTEST_EVENT_KIND: Record<AttestKind, ChainEventKind> = {
  audit: "audit_attested",
  verdict: "verdict_attested",
  decision: "decision_attested",
  release: "approval_attested",
};

/** Demo verification fee (docs/decisions.md: 250 RLUSD in the demo; scales with project size in the product). */
export const VERIFICATION_FEE_RLUSD = "250";

// ---------------------------------------------------------------- fee

/** builder -> platform RLUSD Payment (project verification fee). */
export async function payVerificationFee(p: {
  builder: WalletRef;
  amount?: string;
  projectId?: string;
  platform?: WalletRef;
  /** RLUSD issuer address. */
  issuer?: string;
}): Promise<{ tx: TxResult; event: ChainEvent }> {
  const builder = resolveWallet(p.builder);
  const platform = toAddress(p.platform ?? "platform");
  const issuer = p.issuer ?? loadWallets().issuer.classicAddress;
  const amount = p.amount ?? VERIFICATION_FEE_RLUSD;
  const tx = await payRlusd(builder, platform, issuer, amount);
  return {
    tx,
    event: toChainEvent(tx, { projectId: p.projectId ?? PLATFORM_SCOPE, kind: "verification_fee_paid", actor: builder.classicAddress, amount }),
  };
}

// ---------------------------------------------------------------- credentials

/**
 * Platform issues `type` to `subject`; the subject accepts (unless `accept: false`). Idempotent: skips CredentialCreate if
 * it exists and CredentialAccept if already accepted, so `txs`/`events` are empty on a re-run.
 */
export async function grantCredential(p: {
  subject: WalletRef;
  type: CredentialType;
  uri?: string;
  accept?: boolean;
  projectId?: string;
  platform?: WalletRef;
}): Promise<{ status: CredentialStatus; createTx?: TxResult; acceptTx?: TxResult; txs: TxResult[]; events: ChainEvent[] }> {
  const platform = resolveWallet(p.platform ?? "platform");
  const accept = p.accept ?? true;
  // Issue-only to an arbitrary address is fine; accepting needs the subject's key.
  const subject = !accept && typeof p.subject === "string" && isValidClassicAddress(p.subject) ? p.subject : resolveWallet(p.subject);
  const r = await ensureCredential({ issuer: platform, subject, type: p.type, ...(p.uri ? { uri: p.uri } : {}), accept });
  const projectId = p.projectId ?? PLATFORM_SCOPE;
  const txs: TxResult[] = [];
  const events: ChainEvent[] = [];
  if (r.createTx) {
    txs.push(r.createTx);
    events.push(toChainEvent(r.createTx, { projectId, kind: "credential_issued", actor: platform.classicAddress }));
  }
  if (r.acceptTx) {
    txs.push(r.acceptTx);
    events.push(toChainEvent(r.acceptTx, { projectId, kind: "credential_accepted", actor: toAddress(p.subject) }));
  }
  return { ...r, txs, events };
}

// ---------------------------------------------------------------- permissioned domain

/**
 * The platform's investor domain: AcceptedCredentials = [{platform, KYC_INVESTOR}]. Idempotent (reuses an existing
 * identical domain owned by the platform). Pass the returned `domainId` to createVault / setupProjectOnChain.
 */
export async function createDomain(p: { platform?: WalletRef; types?: CredentialType[] } = {}): Promise<{ domainId: string; tx?: TxResult }> {
  const platform = resolveWallet(p.platform ?? "platform");
  const types = p.types ?? ["KYC_INVESTOR"];
  return ensureDomain(
    platform,
    types.map((type) => ({ issuer: platform.classicAddress, type })),
  );
}

// ---------------------------------------------------------------- attestations

/** Attestation signed by a key we hold (aiAgent / platform / releaseService; inspectors' demo keys as fallback). */
export async function attest(p: {
  signer: WalletRef;
  spv: string;
  memo: AttestMemo;
  projectId?: string;
}): Promise<{ tx: TxResult; memo: AttestMemo; event: ChainEvent }> {
  const signer = resolveWallet(p.signer);
  const tx = await submitAttest(signer, p.spv, p.memo);
  return {
    tx,
    memo: p.memo,
    event: toChainEvent(tx, { projectId: p.projectId ?? PLATFORM_SCOPE, milestoneId: p.memo.milestoneId, kind: ATTEST_EVENT_KIND[p.memo.kind], actor: signer.classicAddress }),
  };
}

/**
 * Submit an attestation the inspector app signed itself. Rejects anything that is not a 1-drop, single-signed,
 * one-memo `xrlp/attest/v1` Payment (see verifyAttestBlob) before it reaches the network.
 */
export async function submitSignedBlob(
  blob: string,
  opts: { expectSigner?: string; expectSpv?: string; projectId?: string } = {},
): Promise<{ tx: TxResult; memo: AttestMemo; signer: string; event: ChainEvent }> {
  const { memo, signer, ...tx } = await submitSignedAttestBlob(blob, {
    ...(opts.expectSigner ? { signer: opts.expectSigner } : {}),
    ...(opts.expectSpv ? { spv: opts.expectSpv } : {}),
  });
  return {
    tx,
    memo,
    signer,
    event: toChainEvent(tx, { projectId: opts.projectId ?? PLATFORM_SCOPE, milestoneId: memo.milestoneId, kind: ATTEST_EVENT_KIND[memo.kind], actor: signer }),
  };
}
