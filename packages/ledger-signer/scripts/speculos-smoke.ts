/**
 * Offline smoke test of LedgerSigner against the Speculos emulator (real XRP app 2.8.1 binary).
 * Signs (1) a memo'd attestation AccountSet and (2) a multisig RLUSD EscrowCreate for a fake SPV,
 * combines the Ledger multisig signature with a software inspector's, and verifies all signatures offline.
 * No network/XRPL submission. Auto-approves on the emulator via Speculos's REST API (Nano S Plus / Nano X
 * button models only) and prints every screen the device showed.
 *
 *   SPECULOS_URL=http://127.0.0.1:5000 SPECULOS_MODEL=nanosp node scripts/speculos-smoke.ts
 */
import { DeviceModelId } from "@ledgerhq/device-management-kit";
import { Wallet, type EscrowCreate } from "xrpl";
import { connectLedger, LedgerSigner } from "../src/ledger.ts";
import { buildAttestationTx, combineMultisig, SoftwareSigner, verifySignedBlob } from "../src/index.ts";

const url = process.env.SPECULOS_URL ?? "http://127.0.0.1:5000";
const model = (process.env.SPECULOS_MODEL ?? "nanosp") === "nanox" ? DeviceModelId.NANO_X : DeviceModelId.NANO_SP;

const screenText = async () =>
  ((await (await fetch(`${url}/events?currentscreenonly=true`)).json()) as { events: { text: string }[] }).events
    .map((e) => e.text)
    .join(" | ");
const press = (b: "left" | "right" | "both") =>
  fetch(`${url}/button/${b}`, { method: "POST", body: JSON.stringify({ action: "press-and-release" }) });

/** Walk the review screens with "right" until an approve screen, then press both. Logs what the human would read. */
async function autoApprove(label: string, done: () => boolean) {
  const seen: string[] = [];
  for (let i = 0; i < 80 && !done(); i++) {
    await new Promise((r) => setTimeout(r, 250));
    const t = await screenText();
    if (!t || t.includes("app is ready")) continue;
    if (seen.at(-1) !== t) seen.push(t);
    if (/^(Sign transaction|Accept|Approve|Sign)\b/i.test(t) || /Hold to sign|Sign transaction/i.test(t)) {
      await press("both");
    } else {
      await press("right");
    }
  }
  console.log(`\n[device screens: ${label}]\n  ` + seen.join("\n  "));
}

const session = await connectLedger({ kind: "speculos", url, model });
const ledger = new LedgerSigner(session, { onInteraction: (i) => console.log(`  (device wants: ${i.interaction})`) });
const me = await ledger.getAddress();
console.log("Ledger inspector:", me);

const common = { Fee: "36", Sequence: 12, LastLedgerSequence: 99_000_000, NetworkID: 2 };

// 1) Attestation (single-sign, AccountSet + memo)
let finished = false;
const att = { ...buildAttestationTx(me.address, { milestoneId: "proj-1/m-3", decision: "approve", verdictHash: "9f".repeat(32), notes: "Framing inspected on site" }), ...common };
const [signedAtt] = await Promise.all([ledger.signAttestation(att).finally(() => (finished = true)), autoApprove("attestation", () => finished)]);
console.log("attestation verified:", verifySignedBlob(signedAtt.tx_blob), signedAtt.hash);

// 2) Multisig on SPV EscrowCreate (RLUSD IOU), combined with a software inspector
const spv = Wallet.generate().classicAddress;
const esc: EscrowCreate = {
  TransactionType: "EscrowCreate",
  Account: spv,
  Destination: Wallet.generate().classicAddress,
  Amount: { currency: "524C555344000000000000000000000000000000", issuer: Wallet.generate().classicAddress, value: "25000" },
  Condition: "A0258020" + "E3".repeat(32) + "810120",
  CancelAfter: 900_000_000,
  ...common,
};
finished = false;
const [ledgerPart] = await Promise.all([ledger.signForMultisig(esc).finally(() => (finished = true)), autoApprove("multisig EscrowCreate", () => finished)]);
const softPart = await new SoftwareSigner(Wallet.generate()).signForMultisig(esc);
const combined = combineMultisig([ledgerPart.tx_blob, softPart.tx_blob]);
console.log("multisig verified:", verifySignedBlob(combined));

// 3) Determinism check (feasibility probe for "derive escrow preimage from a device signature"):
// app-xrp signs secp256k1 with RFC6979 nonces, so the same bytes should give the same signature.
finished = false;
const [again] = await Promise.all([ledger.signAttestation(att).finally(() => (finished = true)), autoApprove("attestation (again)", () => finished)]);
console.log("same tx -> same signature:", again.tx_blob === signedAtt.tx_blob);

// 4) Device-derived escrow release preimage: derive twice (two approvals) -> same condition.
const { derivePreimage } = await import("../src/preimage.ts");
const derive = async () => {
  finished = false;
  const [s] = await Promise.all([derivePreimage(ledger, "proj-1/m-3").finally(() => (finished = true)), autoApprove("derive release key", () => finished)]);
  return s;
};
const d1 = await derive();
const d2 = await derive();
console.log("device-derived condition stable:", d1.condition === d2.condition, d1.condition.slice(0, 24) + "...");

await session.dmk.disconnect({ sessionId: session.sessionId });
session.dmk.close();
console.log("\nSPECULOS SMOKE OK");
process.exit(0);
