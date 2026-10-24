// XRPL-08 devnet proof: credentials x3 roles, permissioned domain, private closed-ended vault, verification fee,
// one attestation per kind (xrlp/attest/v1).
//   pnpm --filter @xrlp/xrpl compliance            (~1-2 min, fresh faucet wallets)
// Proves on devnet:
//   - CredentialCreate + CredentialAccept for VERIFIED_BUILDER, VERIFIED_INSPECTOR, KYC_INVESTOR; re-run is a no-op
//   - PermissionedDomainSet (platform, AcceptedCredentials = [platform, KYC_INVESTOR]); re-run reuses the domain
//   - VaultCreate closed-ended + tfVaultPrivate + tfVaultShareNonTransferable + DomainID
//   - investor1 (accepted KYC) VaultDeposit -> tesSUCCESS; investor2 (KYC issued, NOT accepted) and investor3 (no KYC) -> tecNO_AUTH
//   - builder -> platform 250 RLUSD verification fee
//   - attestations: audit (inspector-app flow: prepare -> sign offline -> submitSignedBlob), verdict, decision, release
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { rippleTimeToISOTime } from "xrpl";
import { decodeAttestMemo, prepareAttestTx, sha256Hex, verifyAttestBlob, type AttestMemo } from "../src/attest.ts";
import { disconnect, getClient, ledgerTime } from "../src/client.ts";
import { attest, createDomain, grantCredential, payVerificationFee, submitSignedBlob } from "../src/compliance.ts";
import { config } from "../src/config.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdBalance } from "../src/rlusd.ts";
import { createVault, depositToVaultTx, getShareBalance, getVault } from "../src/vault.ts";
import { Spike } from "./spike-lib.ts";

const spike = new Spike("xrpl08-compliance");
const ROLES = ["issuer", "platform", "builder", "investor1", "investor2", "investor3", "inspector1", "aiAgent", "releaseService", "spv"] as const;
const PROJECT = "proj-xrpl08";
const MILESTONE = "m1-foundation";

try {
  const w = await spike.fund(ROLES);
  const issuer = w.issuer.classicAddress;
  const platform = w.platform;

  // --- RLUSD
  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  for (const r of ["platform", "builder", "investor1", "investor2", "investor3"] as const) await spike.ok(`TrustSet ${r}`, () => ensureTrustline(w[r], issuer));
  for (const r of ["investor1", "investor2", "investor3"] as const) await spike.ok(`RLUSD -> ${r} 1000`, () => issueRlusd(w.issuer, w[r].classicAddress, "1000"));
  await spike.ok("RLUSD -> builder 500", () => issueRlusd(w.issuer, w.builder.classicAddress, "500"));

  // --- credentials x3 roles (+ idempotency)
  const grant = async (label: string, subject: (typeof w)[keyof typeof w], type: "VERIFIED_BUILDER" | "VERIFIED_INSPECTOR" | "KYC_INVESTOR", accept = true) => {
    const r = await grantCredential({ platform, subject, type, accept, projectId: PROJECT });
    const [c, a] = [r.createTx, r.acceptTx];
    if (c) spike.rows.push({ step: `CredentialCreate ${type} -> ${label}`, result: c.result, hash: c.hash });
    if (a) spike.rows.push({ step: `CredentialAccept ${type} (${label})`, result: a.result, hash: a.hash });
    spike.log(`  ✔ ${type} -> ${label}: ${r.status} (${r.txs.length} tx) ${r.txs.map((t) => t.explorerUrl).join(" ")}`);
    return r;
  };
  await grant("builder", w.builder, "VERIFIED_BUILDER");
  await grant("inspector1", w.inspector1, "VERIFIED_INSPECTOR");
  await grant("investor1", w.investor1, "KYC_INVESTOR");
  await grant("investor2", w.investor2, "KYC_INVESTOR", false); // issued, never accepted
  const again = await grantCredential({ platform, subject: w.investor1, type: "KYC_INVESTOR" });
  if (again.txs.length !== 0 || again.status !== "accepted") throw new Error("grantCredential not idempotent");
  spike.note(`grantCredential re-run for investor1/KYC_INVESTOR: status=${again.status}, 0 txs (idempotent)`);

  // --- permissioned domain (+ idempotency)
  const dom = await createDomain({ platform });
  if (!dom.tx) throw new Error("expected a fresh PermissionedDomainSet");
  spike.rows.push({ step: "PermissionedDomainSet [platform, KYC_INVESTOR]", result: dom.tx.result, hash: dom.tx.hash });
  spike.log(`  ✔ PermissionedDomainSet ${dom.domainId} ${dom.tx.explorerUrl}`);
  const dom2 = await createDomain({ platform });
  if (dom2.tx || dom2.domainId !== dom.domainId) throw new Error("createDomain not idempotent");
  spike.note(`createDomain re-run reused DomainID ${dom.domainId} (no tx)`);

  // --- private closed-ended vault
  const now = await ledgerTime();
  const sub = now + 120;
  const red = sub + 200;
  const vault = await createVault({
    owner: platform,
    issuer,
    subscriptionDate: sub,
    redemptionDate: red,
    assetsMaximum: "5000",
    data: "xrlp:xrpl08-private",
    domainId: dom.domainId,
    nonTransferableShares: true,
  });
  spike.rows.push({ step: `VaultCreate closed-ended + tfVaultPrivate + tfVaultShareNonTransferable + DomainID (sub ${rippleTimeToISOTime(sub)})`, result: vault.tx.result, hash: vault.tx.hash });
  spike.log(`  ✔ VaultCreate private ${vault.tx.explorerUrl}`);
  const v = await getVault(vault.vaultId);
  spike.note(`Vault ${vault.vaultId}: Flags=0x${Number(v?.Flags ?? 0).toString(16)} DomainID=${String(v?.DomainID)} VaultKind=${v?.VaultKind}`);
  const mpt = (await (await getClient()).request({ command: "ledger_entry", mpt_issuance: vault.shareMptIssuanceId, ledger_index: "validated" } as never)) as {
    result: { node: { Flags: number; DomainID?: string } };
  };
  spike.note(`Share MPTokenIssuance Flags=0x${mpt.result.node.Flags.toString(16)} DomainID=${String(mpt.result.node.DomainID)}`);

  await spike.ok("VaultDeposit investor1 (KYC accepted) 400", () => depositToVaultTx(w.investor1, vault.vaultId, issuer, "400"));
  spike.note(`investor1 shares=${await getShareBalance(w.investor1.classicAddress, vault.shareMptIssuanceId)}`);
  await spike.fails("VaultDeposit investor2 (KYC issued, not accepted) 400", "tecNO_AUTH", () => depositToVaultTx(w.investor2, vault.vaultId, issuer, "400"));
  await spike.fails("VaultDeposit investor3 (no KYC) 400", "tecNO_AUTH", () => depositToVaultTx(w.investor3, vault.vaultId, issuer, "400"));

  // --- verification fee
  const before = await rlusdBalance(platform.classicAddress, issuer);
  const fee = await payVerificationFee({ builder: w.builder, platform, issuer, projectId: PROJECT });
  spike.rows.push({ step: "Payment verification fee builder -> platform 250 RLUSD", result: fee.tx.result, hash: fee.tx.hash });
  spike.log(`  ✔ fee ${fee.tx.explorerUrl} (event ${fee.event.kind})`);
  spike.note(`platform RLUSD ${before} -> ${await rlusdBalance(platform.classicAddress, issuer)}`);

  // --- attestations, one per kind, to the "SPV" (a plain account here)
  const spv = w.spv.classicAddress;
  const audit = { milestoneId: MILESTONE, inspector: w.inspector1.classicAddress, checklist: [{ sovCode: "03-300", status: "done" }], notes: "footings poured" };
  const auditMemo: AttestMemo = { v: 1, kind: "audit", milestoneId: MILESTONE, hash: sha256Hex(JSON.stringify(audit)), decision: "pass" };
  // Inspector-app flow: core prepares an unsigned tx, the app signs it with its software key, core submits the blob.
  const unsigned = await prepareAttestTx({ account: w.inspector1.classicAddress, spv, memo: auditMemo });
  const { tx_blob } = w.inspector1.sign(unsigned);
  verifyAttestBlob(tx_blob, { signer: w.inspector1.classicAddress, spv });
  const auditRes = await submitSignedBlob(tx_blob, { expectSigner: w.inspector1.classicAddress, expectSpv: spv, projectId: PROJECT });
  spike.rows.push({ step: "attest audit (inspector1, signed blob -> submitSignedBlob)", result: auditRes.tx.result, hash: auditRes.tx.hash });
  spike.log(`  ✔ audit ${auditRes.tx.explorerUrl}`);

  const verdict = await attest({ signer: w.aiAgent, spv, projectId: PROJECT, memo: { v: 1, kind: "verdict", milestoneId: MILESTONE, hash: sha256Hex("verdict:pass"), decision: "pass" } });
  const decision = await attest({
    signer: platform,
    spv,
    projectId: PROJECT,
    memo: { v: 1, kind: "decision", milestoneId: MILESTONE, hash: sha256Hex("operator approved: photo angle mismatch is benign"), decision: "approve", reason: "photo angle mismatch is benign" },
  });
  const release = await attest({ signer: w.releaseService, spv, projectId: PROJECT, memo: { v: 1, kind: "release", milestoneId: MILESTONE, hash: sha256Hex("evaluateRelease:pass"), decision: "pass" } });
  for (const [k, r] of [["verdict (aiAgent)", verdict], ["decision (platform)", decision], ["release (releaseService)", release]] as const) {
    spike.rows.push({ step: `attest ${k}`, result: r.tx.result, hash: r.tx.hash });
    spike.log(`  ✔ ${k} ${r.tx.explorerUrl} (event ${r.event.kind})`);
  }

  // Round-trip from the validated ledger copy + save one tx JSON for the offline decode test.
  const client = await getClient();
  const fetched = await client.request({ command: "tx", transaction: decision.tx.hash });
  const txJson = (fetched.result as unknown as { tx_json?: Record<string, unknown> }).tx_json ?? (fetched.result as unknown as Record<string, unknown>);
  const decoded = decodeAttestMemo(txJson as never);
  if (decoded?.reason !== "photo angle mismatch is benign") throw new Error("decision memo did not round-trip from the ledger");
  spike.note(`decodeAttestMemo(validated decision tx) = ${JSON.stringify(decoded)}`);
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(join(config.dataDir, "xrpl08-attest-tx.json"), JSON.stringify({ hash: decision.tx.hash, tx_json: txJson }, null, 2) + "\n");

  spike.print();
  spike.log(`\nsaved ${spike.save({ domainId: dom.domainId, vaultId: vault.vaultId, shareMptIssuanceId: vault.shareMptIssuanceId })}`);
} catch (e) {
  spike.print();
  console.error(e);
  process.exitCode = 1;
} finally {
  await disconnect();
}
