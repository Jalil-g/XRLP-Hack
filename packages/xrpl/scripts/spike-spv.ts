// XRPL-05 devnet test: SPV = SignerList {platform, builder, inspector, trustee} w1, quorum 3, master disabled.
// Proves: 2 signatures fail (tefBAD_QUORUM), AI key can't sign (tefBAD_SIGNATURE), master key is dead
// (tefMASTER_DISABLED), any 3 of 4 succeed. tef* results are NOT on-ledger: no explorer link, `tx` returns txnNotFound.
//   pnpm --filter @xrlp/xrpl spike:spv
import type { Payment, Wallet } from "xrpl";
import { getClient, disconnect, XrplTxError } from "../src/client.ts";
import { configureIssuer } from "../src/rlusd.ts";
import { createSpv, getSpvInfo, multisignBlob, SPV_QUORUM, submitMultisigned } from "../src/spv.ts";
import { Spike } from "./spike-lib.ts";

const spike = new Spike("xrpl05-spv-multisig");

/** Submit a signed blob with a raw `submit` and return the preliminary engine result (tef never reaches a ledger). */
async function rawSubmit(blob: string): Promise<string> {
  const client = await getClient();
  const r = await client.request({ command: "submit", tx_blob: blob });
  return r.result.engine_result;
}

/** A tx that must be rejected before reaching the ledger with `expected`. */
async function rejected(step: string, expected: string, blob: () => Promise<{ blob: string; hash: string }>): Promise<string> {
  const { blob: b, hash } = await blob();
  const result = await rawSubmit(b);
  spike.rows.push({ step, result, expected });
  const mark = result === expected ? "✔" : "✘";
  spike.log(`  ${mark} ${step}: ${result} (expected ${expected}), hash ${hash} (not on ledger)`);
  if (result !== expected) throw new Error(`${step}: got ${result}, expected ${expected}`);
  return hash;
}

async function main() {
  const w = await spike.fund(["issuer", "platform", "builder", "inspector", "trustee", "aiAgent"] as const);
  await spike.ok("issuer AccountSet DefaultRipple", async () => (await configureIssuer(w.issuer))[0]);

  spike.log("createSpv: fund + TrustSet + SignerListSet + asfDisableMaster");
  const signers = { platform: w.platform.classicAddress, builder: w.builder.classicAddress, inspector: w.inspector.classicAddress, trustee: w.trustee.classicAddress };
  const spv = await createSpv({ issuer: w.issuer.classicAddress, signers });
  spike.accounts.spv = spv.address;
  await spike.ok("SPV TrustSet RLUSD", async () => spv.txs.trustSet);
  await spike.ok("SPV SignerListSet {platform, builder, inspector, trustee} w1, quorum 3", async () => spv.txs.signerListSet);
  await spike.ok("SPV AccountSet asfDisableMaster", async () => spv.txs.disableMaster);

  const info = await getSpvInfo(spv.address);
  spike.log(`  SPV info: ${JSON.stringify(info)}`);
  if (!info.masterDisabled || info.signerQuorum !== SPV_QUORUM || info.signers.length !== 4 || info.signers.some((s) => s.weight !== 1)) {
    throw new Error(`unexpected SPV state: ${JSON.stringify(info)}`);
  }

  let n = 0;
  const pay = (): Payment => ({ TransactionType: "Payment", Account: spv.address, Destination: w.trustee.classicAddress, Amount: String(1000 + ++n) });
  const ms = (signersW: Wallet[]) => () => multisignBlob(pay(), signersW);

  const client = await getClient();
  await rejected("master key single-sign", "tefMASTER_DISABLED", async () => {
    const prepared = await client.autofill(pay());
    const signed = spv.wallet.sign(prepared);
    return { blob: signed.tx_blob, hash: signed.hash };
  });
  const twoHash = await rejected("multisig 2 of 4 (platform + builder)", "tefBAD_QUORUM", ms([w.platform, w.builder]));
  await rejected("multisig platform + builder + aiAgent (AI not on list)", "tefBAD_SIGNATURE", ms([w.platform, w.builder, w.aiAgent]));

  try {
    await submitMultisigned(pay(), [w.platform, w.builder]);
    throw new Error("submitMultisigned with 2 signers should have thrown");
  } catch (e) {
    if (!(e instanceof XrplTxError) || !e.engineResult.startsWith("tefBAD_QUORUM")) throw e;
    spike.rows.push({ step: "submitMultisigned 2 of 4 → local fast-fail (no submit)", result: "tefBAD_QUORUM", expected: "tefBAD_QUORUM" });
    spike.log(`  ✔ submitMultisigned fast-fail: ${e.message}`);
  }

  await spike.ok("multisig 3 of 4 (platform + builder + inspector) Payment", () => submitMultisigned(pay(), [w.platform, w.builder, w.inspector]));
  await spike.ok("multisig 3 of 4 without the inspector (platform + builder + trustee)", () => submitMultisigned(pay(), [w.platform, w.builder, w.trustee]));
  await spike.ok("multisig 3 of 4 without the platform (builder + inspector + trustee)", () => submitMultisigned(pay(), [w.builder, w.inspector, w.trustee]));

  // tef results are never applied to a ledger. The submitting node may still answer `tx` from its local cache
  // right after submit (validated: false, no meta); later / from other nodes it is txnNotFound.
  const lookup = await client.request({ command: "tx", transaction: twoHash }).then(
    (r) => {
      const x = r.result as { validated?: boolean; meta?: unknown };
      return `returned, validated=${x.validated === true}, meta=${x.meta ? "yes" : "none"}`;
    },
    (e: { data?: { error?: string } }) => e?.data?.error ?? String(e),
  );
  spike.note(`tx lookup of the 2-of-4 hash ${twoHash}: ${lookup}. tef* is not on-ledger, so there is no explorer link.`);
  spike.note("xrpl.js submitAndWait does not throw on tef*: it waits until LastLedgerSequence passes (~1 min). submitMultisigned checks quorum locally first.");

  spike.print();
  console.log(`\nrun record: ${spike.save()}`);
}

try {
  await main();
} catch (e) {
  console.error("\nSPIKE FAILED:", e);
  spike.print();
  process.exitCode = 1;
} finally {
  await disconnect();
}
