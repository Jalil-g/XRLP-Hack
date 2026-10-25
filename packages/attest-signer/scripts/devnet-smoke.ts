// Devnet smoke test for the INS-04 path, minus the browser: two fresh faucet wallets (inspector + an SPV stand-in), an audit
// attestation built + autofilled + signed exactly as apps/inspector/lib/signing.ts does in http mode, checked with core's
// verifyAttestBlob (packages/xrpl), then submitted. Throwaway wallets only; nothing is stored.
// Run: pnpm --filter @xrlp/attest-signer smoke:devnet
import { Client } from "xrpl";
import { verifyAttestBlob } from "@xrlp/xrpl";
import { SoftwareSigner, auditMemo, buildAttestationTx, parseAttestationTx } from "../src/index.ts";

const WS = process.env.XRPL_WS_URL ?? "wss://s.devnet.rippletest.net:51233";
if (!/devnet/.test(WS)) throw new Error(`devnet only (XRPL_WS_URL=${WS})`);

const client = new Client(WS);
await client.connect();
try {
  const [{ wallet: inspectorWallet }, { wallet: spv }] = await Promise.all([client.fundWallet(), client.fundWallet()]);
  const inspector = new SoftwareSigner(inspectorWallet);
  console.log(`inspector ${inspectorWallet.classicAddress} · spv ${spv.classicAddress}`);

  const memo = await auditMemo({
    milestoneId: "smoke:m1",
    inspector: inspectorWallet.classicAddress,
    evidenceBundleHash: "b47b3eca9fc519229eb8ef082426353de50ad7ea1bc11ff2e1967257741b168c",
    checklist: [{ sovCode: "03-100", status: "done" }],
    notes: "devnet smoke",
    photos: [],
  });
  const ledger = await client.getLedgerIndex();
  const tx = await client.autofill({ ...buildAttestationTx({ account: inspectorWallet.classicAddress, spv: spv.classicAddress, memo }), LastLedgerSequence: ledger + 75 });
  const signed = await inspector.signAttestation(tx);

  verifyAttestBlob(signed.tx_blob, { signer: inspectorWallet.classicAddress, spv: spv.classicAddress });
  console.log("verifyAttestBlob (core's check): ok");

  const res = await client.submitAndWait(signed.tx_blob);
  const meta = res.result.meta;
  const code = typeof meta === "object" && meta ? meta.TransactionResult : "?";
  const onLedger = parseAttestationTx(res.result.tx_json as never);
  console.log(`result ${code} · memo on ledger ${JSON.stringify(onLedger)}`);
  console.log(`https://devnet.xrpl.org/transactions/${res.result.hash}`);
  if (code !== "tesSUCCESS" || res.result.hash !== signed.hash || onLedger?.hash !== memo.hash) process.exitCode = 1;
} finally {
  await client.disconnect();
}
