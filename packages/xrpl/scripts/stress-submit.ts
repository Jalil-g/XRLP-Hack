// XRPL-12 devnet proof: N parallel RLUSD Payments from ONE account via signAndSubmit → N × tesSUCCESS, no sequence errors.
//   pnpm --filter @xrlp/xrpl stress                    (~2 min, fresh faucet wallets)
// Env: STRESS_N=20, STRESS_BASELINE=1 also fires the same burst through raw xrpl.js (autofill+sign+submitAndWait,
// no lock) first, to show the race this fixes. XRPL_SUBMIT_LOG=1 prints every retry decision.
//
// XRPL-17 (pipelined submission, opt-in):
//   pnpm --filter @xrlp/xrpl stress --pipeline         the locked burst, then the same burst pipelined → speedup
//     --window=N        pipelined window (default 5; or STRESS_WINDOW)
//     --pipeline-only   skip the locked burst
//     --multisig        also N pipelined multisig Payments (2-of-3 signer list, SigningPubKey "")
//     --foreign         mid-burst another writer takes the pipeline's next Sequence → tefPAST_SEQ → drain → resync
//     --held            one pipelined tx whose first blob is signed a Sequence ahead (stale counter): rippled holds it
//                       (terPRE_SEQ) and answers `tx` "not validated" forever; the pipeline proves it dead from account
//                       state at its LastLedgerSequence, resyncs and re-signs → applied once (~30 s)
// STRESS_PIPELINE=1 / STRESS_MULTISIG=1 / STRESS_FOREIGN=1 / STRESS_HELD=1 work too.
import { Wallet, type Payment } from "xrpl";
import { explorerTxUrl } from "@xrlp/shared";
import {
  DEFAULT_PIPELINE_WINDOW,
  disconnect,
  getClient,
  pipelineState,
  realLedgerIo,
  setSubmitMode,
  signAndSubmit,
  XrplTxError,
  type PipelineEvent,
  type SubmitModeName,
  type SubmitOptions,
  type TxResult,
} from "../src/client.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdAmount, rlusdBalance } from "../src/rlusd.ts";
import { submitMultisigned } from "../src/spv.ts";
import { describeBlob, submitPipelined, type PipelineIo } from "../src/submit.ts";
import { Spike } from "./spike-lib.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`) || /^(1|true)$/i.test(process.env[`STRESS_${name.toUpperCase().replace(/-/g, "_")}`] ?? "");
const N = Number(process.env.STRESS_N ?? 20);
const HELD = flag("held");
const PIPELINE = flag("pipeline") || flag("pipeline-only");
const LOCKED = !flag("pipeline-only") && !(HELD && !flag("pipeline"));
const MULTISIG = flag("multisig");
const FOREIGN = flag("foreign");
const WINDOW = Number(argv.find((a) => a.startsWith("--window="))?.slice(9) ?? process.env.STRESS_WINDOW ?? DEFAULT_PIPELINE_WINDOW);
const spike = new Spike(PIPELINE ? "stress-submit-pipeline" : "stress-submit");

interface Burst {
  label: string;
  ok: TxResult[];
  failed: number;
  secs: number;
  seqs: number[];
  distinct: boolean;
  events: PipelineEvent[];
  retries: number;
}

/** Fire `n` txs at once, record each with its explorer link, and time the whole burst. */
async function burst(label: string, mode: SubmitModeName, n: number, send: (i: number, opts: SubmitOptions) => Promise<TxResult>, during?: () => Promise<void>): Promise<Burst> {
  setSubmitMode(mode, { window: WINDOW });
  spike.log(`\n${label}: ${n} parallel txs, ${mode}${mode === "pipelined" ? ` (window ${WINDOW})` : ""}…`);
  const events: PipelineEvent[] = [];
  let retries = 0;
  const opts: SubmitOptions = {
    onPipeline: (e) => {
      events.push(e);
      spike.log(e.kind === "dirty" ? `  ⚠ dirty: ${e.reason}${e.sequence !== undefined ? ` at Seq ${e.sequence}` : ""} → draining` : `  ⟳ resync (${e.reason}) → next Seq ${e.nextSequence ?? "?"}, re-signing ${e.resign}`);
    },
    onRetry: (e) => {
      retries++;
      spike.log(`  ↻ ${e.reason} → ${e.action} (${explorerTxUrl(e.hash)})`);
    },
  };
  const t0 = Date.now();
  const [settled] = await Promise.all([Promise.allSettled(Array.from({ length: n }, (_, i) => send(i, opts))), during?.()]);
  const secs = (Date.now() - t0) / 1000;
  const ok: TxResult[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ok.push(r.value);
      spike.rows.push({ step: `${label} #${i} (Seq ${String(r.value.tx.Sequence)})`, result: r.value.result, hash: r.value.hash });
      spike.log(`  ✔ #${i} Seq ${String(r.value.tx.Sequence)} ${r.value.result} ${r.value.explorerUrl}`);
    } else {
      const e = r.reason;
      const code = e instanceof XrplTxError ? e.engineResult : String(e);
      spike.rows.push({ step: `${label} #${i}`, result: code, ...(e instanceof XrplTxError && e.hash ? { hash: e.hash } : {}) });
      spike.log(`  ✘ #${i} ${code}${e instanceof XrplTxError && e.hash ? ` ${explorerTxUrl(e.hash)}` : ""}`);
    }
  });
  const seqs = ok.map((t) => Number(t.tx.Sequence));
  const b = { label, ok, failed: n - ok.length, secs, seqs, distinct: new Set(seqs).size === seqs.length, events, retries };
  spike.note(`${label}: ${ok.length}/${n} tesSUCCESS in ${secs.toFixed(1)}s; distinct Sequences: ${b.distinct} (${Math.min(...seqs)}..${Math.max(...seqs)}); retries ${retries}; pipeline events ${events.length}`);
  return b;
}

try {
  const roles = MULTISIG ? (["issuer", "sender", "receiver", "multisig"] as const) : (["issuer", "sender", "receiver"] as const);
  const w = (await spike.fund(roles)) as Record<(typeof roles)[number], Wallet> & { multisig?: Wallet };
  const issuer = w.issuer.classicAddress;
  const sender = w.sender.classicAddress;
  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  await spike.ok("TrustSet sender", () => ensureTrustline(w.sender, issuer));
  await spike.ok("TrustSet receiver", () => ensureTrustline(w.receiver, issuer));
  const bursts = (LOCKED ? 1 : 0) + (PIPELINE ? 1 : 0) + (process.env.STRESS_BASELINE ? 1 : 0);
  await spike.ok(`RLUSD -> sender ${N * Math.max(2, bursts + 1)}`, () => issueRlusd(w.issuer, sender, String(N * Math.max(2, bursts + 1))));

  const payment = (i: number): Payment => ({
    TransactionType: "Payment",
    Account: sender,
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

  const out: Burst[] = [];
  if (LOCKED) out.push(await burst(PIPELINE ? "locked" : "Hardened", "locked", N, (i, o) => signAndSubmit(w.sender, payment(i), o)));

  if (PIPELINE) {
    /** --foreign: once the window is full (nothing being issued), sign + submit a raw tx at the pipeline's next Sequence. */
    const foreign = async () => {
      const client = await getClient();
      for (let tries = 0; tries < 3; tries++) {
        for (let waited = 0; waited < 60_000; waited += 100) {
          const s = pipelineState(sender);
          if (s?.nextSequence !== undefined && s.inFlight >= WINDOW && !s.dirty) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        const seq = pipelineState(sender)?.nextSequence;
        if (seq === undefined) return;
        const lls = (await client.getLedgerIndex()) + 20;
        const tx = await client.autofill({ TransactionType: "Payment", Account: sender, Destination: w.receiver.classicAddress, Amount: "1", Sequence: seq, LastLedgerSequence: lls } as Payment);
        const signed = w.sender.sign(tx);
        const r = await client.request({ command: "submit", tx_blob: signed.tx_blob });
        spike.log(`  ⚡ foreign writer: raw Payment at Seq ${seq} → ${r.result.engine_result} ${explorerTxUrl(signed.hash)}`);
        if (r.result.engine_result === "tesSUCCESS") {
          spike.rows.push({ step: `foreign writer raw Payment (takes Seq ${seq})`, result: r.result.engine_result, hash: signed.hash });
          spike.note(`foreign writer took Seq ${seq}: ${explorerTxUrl(signed.hash)}`);
          return;
        }
      }
      spike.note("foreign writer: could not take a Sequence before the pipeline did (no resync this run)");
    };
    out.push(await burst("pipelined", "pipelined", N, (i, o) => signAndSubmit(w.sender, payment(100 + i), o), FOREIGN ? foreign : undefined));
  }

  if (HELD) {
    // A stale-high counter (+1, once): the first blob is signed one Sequence ahead → terPRE_SEQ, held by the server.
    setSubmitMode("pipelined", { window: WINDOW });
    spike.log(`\nHeld blob: one pipelined Payment, first blob signed a Sequence ahead…`);
    let skew = 1;
    const io: PipelineIo = { ...realLedgerIo, nextSequence: async (a) => (await realLedgerIo.nextSequence(a)) + (skew-- > 0 ? 1 : 0) };
    const client = await getClient();
    const blobs: { hash: string; sequence: number; lls: number }[] = [];
    const events: PipelineEvent[] = [];
    const t0 = Date.now();
    const out = await submitPipelined(
      {
        account: sender,
        txType: "Payment",
        prepare: async (sequence) => {
          const [v, prepared] = await Promise.all([client.getLedgerIndex(), client.autofill({ ...payment(500), Sequence: sequence, LastLedgerSequence: 0 })]);
          prepared.LastLedgerSequence = v + 5; // short, so the proof runs within ~20 s
          const b = { ...describeBlob(w.sender.sign(prepared).tx_blob, "Payment"), minLedger: v + 1 };
          blobs.push({ hash: b.hash, sequence, lls: prepared.LastLedgerSequence });
          spike.log(`  signed Seq ${sequence} LLS ${prepared.LastLedgerSequence} ${b.hash}`);
          return b;
        },
      },
      io,
      {
        onPipeline: (e) => {
          events.push(e);
          spike.log(e.kind === "dirty" ? `  ⚠ dirty: ${e.reason} at Seq ${e.sequence ?? "?"} → draining` : `  ⟳ resync (${e.reason}) → next Seq ${e.nextSequence ?? "?"}, re-signing ${e.resign}`);
        },
      },
    );
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const held = blobs[0]!;
    const lk = await realLedgerIo.lookup(held.hash);
    const at = await realLedgerIo.sequenceAt(sender, held.lls);
    const r = (out.meta as { TransactionResult?: string }).TransactionResult;
    const finalSeq = Number((out.tx_json as { Sequence?: number }).Sequence);
    const li = Number(out.ledger_index);
    let named = await realLedgerIo.txWithSequence(sender, finalSeq, { min: li - 2, max: li + 2 });
    for (let i = 0; i < 5 && !named; i++) {
      await new Promise((res) => setTimeout(res, 2000)); // account_tx can trail the validated `tx` answer briefly
      named = await realLedgerIo.txWithSequence(sender, finalSeq, { min: li - 2, max: li + 2 });
    }
    spike.rows.push({ step: `held-blob proof: re-signed Payment (Seq ${finalSeq})`, result: r ?? "unknown", hash: String(out.hash) });
    spike.note(
      `held blob ${held.hash} (Seq ${held.sequence}, LLS ${held.lls}): tx lookup now "${lk.status}" (never txnNotFound); account Sequence at ledger ${held.lls} = ${at} ≤ ${held.sequence} → proven dead; ` +
        `events ${events.map((e) => `${e.kind}:${e.reason}`).join(", ")}; re-signed at Seq ${finalSeq} → ${r} in ${secs}s; txWithSequence(${finalSeq}) = ${named?.hash === out.hash ? "this tx ✔" : `MISMATCH ${String(named?.hash)}`}`,
    );
    if (r !== "tesSUCCESS" || blobs.length !== 2 || named?.hash !== out.hash || lk.status === "validated" || at === undefined || at > held.sequence) process.exitCode = 1;
  }

  if (MULTISIG && w.multisig) {
    const ms = w.multisig;
    const signers = [Wallet.generate(), Wallet.generate(), Wallet.generate()];
    await spike.ok("SignerListSet multisig 2-of-3", () =>
      signAndSubmit(ms, { TransactionType: "SignerListSet", Account: ms.classicAddress, SignerQuorum: 2, SignerEntries: signers.map((s) => ({ SignerEntry: { Account: s.classicAddress, SignerWeight: 1 } })) }),
    );
    out.push(
      await burst("pipelined multisig", "pipelined", N, (i, o) =>
        submitMultisigned({ TransactionType: "Payment", Account: ms.classicAddress, Destination: w.receiver.classicAddress, Amount: "1000", DestinationTag: 200 + i }, signers.slice(0, 2), o),
      ),
    );
  }
  setSubmitMode("locked");

  const bal = await rlusdBalance(w.receiver.classicAddress, issuer);
  const locked = out.find((b) => b.label === "locked" || b.label === "Hardened");
  const piped = out.find((b) => b.label === "pipelined");
  if (locked && piped) spike.note(`speedup: locked ${locked.secs.toFixed(1)}s vs pipelined ${piped.secs.toFixed(1)}s (window ${WINDOW}) = ${(locked.secs / piped.secs).toFixed(1)}x`);
  spike.note(`receiver RLUSD ${bal}`);
  spike.print();
  const record = Object.fromEntries(out.map((b) => [b.label, { seconds: Number(b.secs.toFixed(1)), ok: b.ok.length, retries: b.retries, events: b.events }]));
  spike.log(`\nrun record: ${spike.save({ n: N, window: WINDOW, bursts: record })}`);
  if (out.some((b) => b.failed || !b.distinct)) process.exitCode = 1;
} finally {
  await disconnect();
}
