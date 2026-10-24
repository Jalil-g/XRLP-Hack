// XRPL-02 spike: IOU (RLUSD) conditional escrows from the v2 SPV multisig — finish, cancel, and the two
// demo-critical failure codes.
//   pnpm --filter @xrlp/xrpl spike:escrow            (~3 min, fresh faucet wallets)
// Proves on devnet (SPV: master disabled, SignerList {platform, builder, inspector, trustee} w1, quorum 3):
//   1. EscrowCreate (SPV multisig, PREIMAGE-SHA-256 Condition, CancelAfter) -> EscrowFinish by releaseService
//   2. EscrowFinish with a wrong fulfillment -> tecCRYPTOCONDITION_ERROR on-ledger, escrow still open
//   3. EscrowFinish to a destination without an RLUSD trust line -> tecNO_LINE; the Fulfillment is now public
//      on-ledger while the escrow is still open; a third party finishes it once the line exists
//   4. EscrowFinish after CancelAfter -> tecNO_PERMISSION (or whatever devnet says); EscrowCancel -> RLUSD back to SPV
// Env: SPIKE_SIGNERS=platform,inspector,trustee (which 3 SPV signers sign EscrowCreate), SPIKE_CANCEL_S=75.
import { AccountSetAsfFlags, type Wallet } from "xrpl";
import { disconnect, getClient, ledgerTime, signAndSubmit, waitForLedgerTimeAfter, XrplTxError, type TxResult } from "../src/client.ts";
import { generateMilestoneCondition, type MilestoneCondition } from "../src/condition.ts";
import { cancelEscrow, createMilestoneEscrow, finishEscrow, listEscrows, type CreatedEscrow } from "../src/escrow.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdBalance } from "../src/rlusd.ts";
import { getSpvInfo } from "../src/spv.ts";
import { Spike } from "./spike-lib.ts";

const SPV_FUNDING = "1000";
const LONG_CANCEL_S = 3600;
const SHORT_CANCEL_S = Number(process.env.SPIKE_CANCEL_S ?? 75);

const spike = new Spike("spike-xrpl02-escrow");
const ROLES = ["issuer", "platform", "builder", "inspector", "trustee", "spv", "releaseService", "builder2", "thirdParty"] as const;
type Role = (typeof ROLES)[number];

interface ValidatedTx {
  validated: boolean;
  ledger_index?: number;
  hash: string;
  Fee?: string;
  Fulfillment?: string;
  Condition?: string;
  meta?: { TransactionResult?: string };
  tx_json?: { Fee?: string; Fulfillment?: string; Condition?: string };
}

/** `tx` by hash — proves a failed tec is really on-ledger (validated, in a ledger) and shows what it published. */
async function fetchTx(hash: string): Promise<ValidatedTx & { fee: string; fulfillment?: string; result?: string }> {
  const client = await getClient();
  const res = await client.request({ command: "tx", transaction: hash });
  const r = res.result as unknown as ValidatedTx;
  const body = r.tx_json ?? r;
  return { ...r, fee: String(body.Fee), ...(body.Fulfillment ? { fulfillment: body.Fulfillment } : {}), ...(r.meta?.TransactionResult ? { result: r.meta.TransactionResult } : {}) };
}

async function escrowOpen(owner: string, previousTxnId: string): Promise<boolean> {
  return (await listEscrows(owner)).some((e) => e.PreviousTxnID === previousTxnId);
}

/** EscrowFinish that skips finishEscrow()'s client-side fulfillment check (needed for the negative cases). */
function rawFinish(submitter: Wallet, e: CreatedEscrow, condition: string, fulfillment: string): Promise<TxResult> {
  return signAndSubmit(submitter, {
    TransactionType: "EscrowFinish",
    Account: submitter.classicAddress,
    Owner: e.owner,
    OfferSequence: e.offerSequence,
    Condition: condition,
    Fulfillment: fulfillment,
  });
}

try {
  const w = await spike.fund(ROLES);
  const issuer = w.issuer.classicAddress;
  const spv = w.spv.classicAddress;
  const bal = (r: Role) => rlusdBalance(w[r].classicAddress, issuer);

  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet (DefaultRipple / AllowTrustLineLocking)", result: tx.result, hash: tx.hash });
  // builder2 deliberately gets NO trust line (case 3).
  for (const r of ["spv", "builder"] as const) await spike.ok(`TrustSet ${r}`, () => ensureTrustline(w[r], issuer));
  await spike.ok(`RLUSD -> SPV ${SPV_FUNDING} (from issuer, no loan)`, () => issueRlusd(w.issuer, spv, SPV_FUNDING));

  await spike.ok("SPV SignerListSet (v2: 4 x w1, quorum 3)", () =>
    signAndSubmit(w.spv, {
      TransactionType: "SignerListSet",
      Account: spv,
      SignerQuorum: 3,
      SignerEntries: (["platform", "builder", "inspector", "trustee"] as const).map((r) => ({
        SignerEntry: { Account: w[r].classicAddress, SignerWeight: 1 },
      })),
    }),
  );
  await spike.ok("SPV AccountSet asfDisableMaster", () => signAndSubmit(w.spv, { TransactionType: "AccountSet", Account: spv, SetFlag: AccountSetAsfFlags.asfDisableMaster }));
  const spvInfo = await getSpvInfo(spv);
  spike.note(`SPV masterDisabled=${spvInfo.masterDisabled} quorum=${spvInfo.signerQuorum} signers=${spvInfo.signers.map((s) => `${s.account}:${s.weight}`).join(",")}`);

  const signerRoles = (process.env.SPIKE_SIGNERS ?? "platform,inspector,trustee").split(",") as Role[];
  const signers = signerRoles.map((r) => w[r]);
  const create = async (label: string, destination: Role, amount: string, cond: MilestoneCondition, cancelAfter: number) => {
    const e = await createMilestoneEscrow({ spv, builder: w[destination].classicAddress, issuer, amount, condition: cond.condition, cancelAfter, signers });
    spike.rows.push({ step: `${label}: EscrowCreate ${amount} RLUSD -> ${destination} (SPV multisig ${signerRoles.join("+")})`, result: e.tx.result, hash: e.tx.hash });
    spike.log(`  ✔ ${label}: EscrowCreate seq ${e.offerSequence} ${e.tx.explorerUrl}`);
    return e;
  };

  // Case 4 first (short CancelAfter) so its clock runs while cases 1–3 execute.
  const c4 = generateMilestoneCondition();
  const cancelAfter4 = (await ledgerTime()) + SHORT_CANCEL_S;
  const e4 = await create(`4 (CancelAfter +${SHORT_CANCEL_S}s)`, "builder", "40", c4, cancelAfter4);
  const createFee = (e4.tx.tx as { Fee?: string }).Fee;

  // ── Case 1: happy path ────────────────────────────────────────────────────────────────────────────
  const longCancel = (await ledgerTime()) + LONG_CANCEL_S;
  const c1 = generateMilestoneCondition();
  const e1 = await create("1", "builder", "100", c1, longCancel);
  const b1 = await bal("builder");
  const f1 = await spike.ok("1: EscrowFinish (correct fulfillment) by releaseService", () =>
    finishEscrow({ submitter: w.releaseService, owner: spv, offerSequence: e1.offerSequence, condition: c1.condition, fulfillment: c1.fulfillment }),
  );
  spike.note(`case 1: builder RLUSD ${b1} -> ${await bal("builder")}; EscrowFinish Fee=${(f1!.tx as { Fee?: string }).Fee} drops; multisig EscrowCreate Fee=${createFee} drops`);

  // ── Case 2: wrong fulfillment -> tecCRYPTOCONDITION_ERROR, on-ledger ──────────────────────────────
  const c2 = generateMilestoneCondition();
  const e2 = await create("2", "builder", "50", c2, longCancel);
  const wrong = generateMilestoneCondition().fulfillment; // well-formed, wrong preimage
  const err2 = await spike.fails("2: EscrowFinish (WRONG fulfillment) by releaseService", "tecCRYPTOCONDITION_ERROR", () => rawFinish(w.releaseService, e2, c2.condition, wrong));
  const t2 = await fetchTx(err2.hash!);
  spike.note(`case 2: wrong-fulfillment tx validated=${t2.validated} ledger_index=${t2.ledger_index} result=${t2.result} Fee=${t2.fee} drops; escrow still open=${await escrowOpen(spv, e2.tx.hash)}`);
  await spike.ok("2: EscrowFinish (correct fulfillment) after the failed attempt", () =>
    finishEscrow({ submitter: w.releaseService, owner: spv, offerSequence: e2.offerSequence, condition: c2.condition, fulfillment: c2.fulfillment }),
  );

  // ── Case 3: destination without trust line -> tecNO_LINE, preimage leaks ───────────────────────────
  const c3 = generateMilestoneCondition();
  const e3 = await create("3", "builder2", "25", c3, longCancel);
  const err3 = await spike.fails("3: EscrowFinish (correct fulfillment) -> builder2 without RLUSD trust line", "tecNO_LINE", () =>
    finishEscrow({ submitter: w.releaseService, owner: spv, offerSequence: e3.offerSequence, condition: c3.condition, fulfillment: c3.fulfillment }),
  );
  const t3 = await fetchTx(err3.hash!);
  const open3 = await escrowOpen(spv, e3.tx.hash);
  spike.note(
    `case 3 PREIMAGE LEAK: failed tx ${err3.hash} validated=${t3.validated} ledger_index=${t3.ledger_index} result=${t3.result} carries Fulfillment=${t3.fulfillment} ` +
      `(matches secret: ${t3.fulfillment === c3.fulfillment}); escrow still open (account_objects)=${open3}`,
  );
  await spike.ok("3: TrustSet builder2 (after the leak)", () => ensureTrustline(w.builder2, issuer));
  await spike.ok("3: EscrowFinish by thirdParty using the fulfillment read from the failed tx", () =>
    rawFinish(w.thirdParty, e3, c3.condition, t3.fulfillment!),
  );
  spike.note(`case 3: builder2 RLUSD now ${await bal("builder2")} (money still goes only to the Destination); escrow open=${await escrowOpen(spv, e3.tx.hash)}`);

  // ── Case 4: finish after CancelAfter fails; cancel refunds the SPV ────────────────────────────────
  await waitForLedgerTimeAfter(cancelAfter4, (s) => process.stdout.write(`\r  waiting for CancelAfter (case 4) ~${s}s   `));
  process.stdout.write("\n");
  try {
    await spike.fails("4: EscrowFinish (correct fulfillment) after CancelAfter", "tecNO_PERMISSION", () => rawFinish(w.releaseService, e4, c4.condition, c4.fulfillment));
  } catch (e) {
    if (!(e instanceof XrplTxError)) throw e;
    spike.note(`case 4: devnet returned ${e.engineResult} (expected tecNO_PERMISSION) for finish-after-CancelAfter`);
  }
  const spvBefore4 = await bal("spv");
  await spike.ok("4: EscrowCancel by releaseService", () => cancelEscrow({ submitter: w.releaseService, owner: spv, offerSequence: e4.offerSequence }));
  spike.note(`case 4: SPV RLUSD ${spvBefore4} -> ${await bal("spv")} after cancel; escrow open=${await escrowOpen(spv, e4.tx.hash)}`);
  spike.note(`final RLUSD: spv=${await bal("spv")} builder=${await bal("builder")} builder2=${await bal("builder2")}`);

  spike.print();
  console.log(`\nrun record: ${spike.save({ conditions: { c1: c1.condition, c2: c2.condition, c3: c3.condition, c4: c4.condition } })}`);
} catch (e) {
  spike.print();
  console.error(`\nrun record: ${spike.save({ error: String(e) })}`);
  throw e;
} finally {
  await disconnect();
}
