// XRPL-12 devnet proof: N parallel RLUSD Payments from ONE account via signAndSubmit → N × tesSUCCESS, no sequence errors.
//   pnpm --filter @xrlp/xrpl stress                    (~2 min, fresh faucet wallets)
// Env: STRESS_N=20, STRESS_BASELINE=1 also fires the same burst through raw xrpl.js (autofill+sign+submitAndWait,
// no lock) first, to show the race this fixes. XRPL_SUBMIT_LOG=1 prints every retry decision.
import { explorerTxUrl } from "@xrlp/shared";
import { disconnect, getClient, signAndSubmit, XrplTxError, type TxResult } from "../src/client.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdAmount, rlusdBalance } from "../src/rlusd.ts";
import { Spike } from "./spike-lib.ts";

const N = Number(process.env.STRESS_N ?? 20);
const spike = new Spike("stress-submit");

try {
  const w = await spike.fund(["issuer", "sender", "receiver"] as const);
  const issuer = w.issuer.classicAddress;
  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  await spike.ok("TrustSet sender", () => ensureTrustline(w.sender, issuer));
  await spike.ok("TrustSet receiver", () => ensureTrustline(w.receiver, issuer));
  await spike.ok(`RLUSD -> sender ${N * 2}`, () => issueRlusd(w.issuer, w.sender.classicAddress, String(N * 2)));

  const payment = (i: number) => ({
    TransactionType: "Payment" as const,
    Account: w.sender.classicAddress,
    Destination: w.receiver.classicAddress,
    Amount: rlusdAmount(issuer, "1"),
    DestinationTag: i,
  });

  if (process.env.STRESS_BASELINE) {
    spike.log(`\nBaseline: ${N} parallel raw xrpl.js submitAndWait (no lock)…`);
    const client = await getClient();
    const raw = await Promise.allSettled(
      Array.from({ length: N }, async (_, i) => {
        const prepared = await client.autofill(payment(1000 + i));
        const res = await client.submitAndWait(w.sender.sign(prepared).tx_blob);
        return (res.result.meta as { TransactionResult: string }).TransactionResult;
      }),
    );
    const tally: Record<string, number> = {};
    for (const r of raw) {
      const k = r.status === "fulfilled" ? r.value : (String((r.reason as Error).message).match(/te[a-z]{1,2}[A-Z_]+/)?.[0] ?? "error");
      tally[k] = (tally[k] ?? 0) + 1;
    }
    spike.note(`baseline (no lock): ${JSON.stringify(tally)}`);
  }

  spike.log(`\nHardened: ${N} parallel signAndSubmit from ${w.sender.classicAddress}…`);
  const t0 = Date.now();
  const settled = await Promise.allSettled(Array.from({ length: N }, (_, i) => signAndSubmit(w.sender, payment(i))));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const ok: TxResult[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ok.push(r.value);
      spike.rows.push({ step: `parallel Payment #${i} (Seq ${String(r.value.tx.Sequence)})`, result: r.value.result, hash: r.value.hash });
      spike.log(`  ✔ #${i} Seq ${String(r.value.tx.Sequence)} ${r.value.result} ${r.value.explorerUrl}`);
    } else {
      const e = r.reason;
      const code = e instanceof XrplTxError ? e.engineResult : String(e);
      spike.rows.push({ step: `parallel Payment #${i}`, result: code, ...(e instanceof XrplTxError && e.hash ? { hash: e.hash } : {}) });
      spike.log(`  ✘ #${i} ${code}${e instanceof XrplTxError && e.hash ? ` ${explorerTxUrl(e.hash)}` : ""}`);
    }
  });

  const seqs = ok.map((t) => Number(t.tx.Sequence));
  const distinct = new Set(seqs).size === seqs.length;
  const bal = await rlusdBalance(w.receiver.classicAddress, issuer);
  spike.note(`${ok.length}/${N} tesSUCCESS in ${secs}s; distinct Sequences: ${distinct} (${Math.min(...seqs)}..${Math.max(...seqs)}); receiver RLUSD ${bal}`);
  spike.print();
  spike.log(`\nrun record: ${spike.save({ n: N, seconds: Number(secs) })}`);
  if (ok.length !== N || !distinct) process.exitCode = 1;
} finally {
  await disconnect();
}
