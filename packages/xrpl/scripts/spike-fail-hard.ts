// Security review H1b devnet proof: rippled HOLDS a locally submitted tx whose provisional result is a retry/local/failure
// code (ter* / tel* / most tef*) and re-applies it at later ledgers, unless `submit` sets `fail_hard: true`.
// So "tel* = not applied, not relayed" is only true with fail_hard, which is what client.ts realLedgerIo now sends.
//   pnpm --filter @xrlp/xrpl spike:fail-hard      (~1 min, fresh faucet wallets)
// Per mode: submit Payment Sequence S+1 first (gap → terPRE_SEQ), then S (tesSUCCESS), wait, and see whether S+1 applied
// on its own. Expected: without fail_hard it does (held, applied once the gap is filled); with fail_hard it never does.
import { disconnect, getClient } from "../src/client.ts";
import { Spike } from "./spike-lib.ts";

const spike = new Spike("spike-fail-hard");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  const w = await spike.fund(["sender", "receiver"] as const);
  const client = await getClient();
  const sender = w.sender.classicAddress;
  const nextSeq = async () => (await client.request({ command: "account_info", account: sender, ledger_index: "current" })).result.account_data.Sequence;
  const signed = async (sequence: number) => {
    const tx = await client.autofill({ TransactionType: "Payment", Account: sender, Destination: w.receiver.classicAddress, Amount: "1", Sequence: sequence, LastLedgerSequence: (await client.getLedgerIndex()) + 20 });
    return w.sender.sign(tx);
  };
  const lookup = async (hash: string): Promise<string> => {
    try {
      const r = (await client.request({ command: "tx", transaction: hash })).result as { validated?: boolean; meta?: { TransactionResult?: string } };
      return r.validated ? `validated ${r.meta?.TransactionResult}` : "known, not validated";
    } catch (e) {
      return (e as { data?: { error?: string } }).data?.error ?? String(e);
    }
  };

  for (const failHard of [false, true]) {
    const mode = failHard ? "fail_hard: true" : "default (no fail_hard)";
    const s = await nextSeq();
    const ahead = await signed(s + 1);
    const fill = await signed(s);
    const r1 = await client.request({ command: "submit", tx_blob: ahead.tx_blob, ...(failHard ? { fail_hard: true } : {}) });
    const r2 = await client.request({ command: "submit", tx_blob: fill.tx_blob, fail_hard: true });
    spike.log(`  ${mode}: Sequence ${s + 1} first → ${r1.result.engine_result}; then Sequence ${s} → ${r2.result.engine_result}`);
    let fillState = "";
    for (let i = 0; i < 30 && !fillState.startsWith("validated"); i++) {
      await sleep(2000);
      fillState = await lookup(fill.hash);
    }
    await sleep(15_000); // several more ledgers: a held tx is retried at each one
    const aheadState = await lookup(ahead.hash);
    spike.rows.push({ step: `${mode}: Payment Seq ${s} (fills the gap)`, result: fillState, hash: fill.hash });
    spike.rows.push({ step: `${mode}: Payment Seq ${s + 1} submitted first (${r1.result.engine_result})`, result: aheadState, hash: ahead.hash });
    spike.note(`${mode}: the gapped tx (provisional ${r1.result.engine_result}) is now "${aheadState}"`);
  }
  spike.print();
  console.log(`\nrecord: ${spike.save()}`);
} catch (e) {
  console.error("\nSPIKE FAILED:", e);
  process.exitCode = 1;
} finally {
  await disconnect();
}
