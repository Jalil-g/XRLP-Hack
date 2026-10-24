/**
 * Which of OUR SPV transactions can the Ledger XRP app (2.8.1) sign as a multisig? Runs against Speculos,
 * auto-walks screens, prints what the device shows and whether it signed. Offline (nothing submitted).
 *
 *   SPECULOS_URL=http://127.0.0.1:5000 pnpm --filter @xrlp/ledger-signer exec tsx scripts/probe-tx-types.ts
 */
import { DeviceModelId } from "@ledgerhq/device-management-kit";
import { Wallet, type Transaction } from "xrpl";
import { connectLedger, LedgerSigner } from "../src/ledger.ts";
import { verifySignedBlob } from "../src/index.ts";

const url = process.env.SPECULOS_URL ?? "http://127.0.0.1:5000";
const screen = async () =>
  ((await (await fetch(`${url}/events?currentscreenonly=true`)).json()) as { events: { text: string }[] }).events.map((e) => e.text).join(" | ");
const press = (b: string) => fetch(`${url}/button/${b}`, { method: "POST", body: JSON.stringify({ action: "press-and-release" }) });

const session = await connectLedger({ kind: "speculos", url, model: DeviceModelId.NANO_SP });
const ledger = new LedgerSigner(session);
await ledger.getAddress();

const spv = Wallet.generate().classicAddress;
const rlusd = { currency: "524C555344000000000000000000000000000000", issuer: Wallet.generate().classicAddress, value: "1000" };
const common = { Account: spv, Fee: "36", Sequence: 5, LastLedgerSequence: 99_000_000, NetworkID: 2 };
const id = "AB".repeat(32);
const cases: Record<string, Transaction> = {
  EscrowFinish: { TransactionType: "EscrowFinish", Owner: spv, OfferSequence: 3, Condition: "A0258020" + "E3".repeat(32) + "810120", Fulfillment: "A0228020" + "11".repeat(32), ...common },
  LoanPay: { TransactionType: "LoanPay", LoanID: id, Amount: rlusd, ...common } as Transaction,
  LoanSet: { TransactionType: "LoanSet", LoanBrokerID: id, PrincipalRequested: "25000", PaymentTotal: 12, ...common } as Transaction,
  VaultDeposit: { TransactionType: "VaultDeposit", VaultID: id, Amount: rlusd, ...common } as Transaction,
};

for (const [name, tx] of Object.entries(cases)) {
  let done = false;
  const seen: string[] = [];
  const walker = (async () => {
    for (let i = 0; i < 60 && !done; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const t = await screen();
      if (!t || t.includes("app is ready")) continue;
      if (seen.at(-1) !== t) seen.push(t);
      await press(/Sign transaction|^Accept|^Approve|^Reject$|Blind signing/i.test(t) && !/^Reject$/.test(t) ? "both" : "right");
    }
  })();
  let result: string;
  try {
    const s = await ledger.signForMultisig(tx);
    verifySignedBlob(s.tx_blob);
    result = "SIGNED + verified";
  } catch (e) {
    result = `FAILED: ${(e as Error).message.slice(0, 160)}`;
  }
  done = true;
  await walker;
  console.log(`\n== ${name}: ${result}\n  ${seen.join("\n  ")}`);
}
session.dmk.close();
process.exit(0);
