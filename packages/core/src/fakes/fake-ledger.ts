// In-process LedgerPort v2 (shared/ports.ts). Devnet-shaped results (64-hex hashes, explorer URLs) and the same gates the
// real ledger has: closed-ended vault phases (Subscription / Investment / Redemption) on an injectable clock, IOU escrow
// with PREIMAGE-SHA-256 conditions, CancelAfter, trust lines for the destination, tec results recorded on "ledger".
// Optional `stateFile` persists ledger state so `seed` and the HTTP server (separate processes) see the same escrows.
// TODO(adapters): LEDGER_MODE=devnet -> packages/xrpl/src/adapter.ts (@Jalil-g).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import {
  explorerTxUrl,
  LedgerError,
  TooSoonError,
  type AttestMemo,
  type ChainEventKind,
  type CloseResult,
  type EscrowSnapshot,
  type LedgerPort,
  type LoanSnapshot,
  type ProjectChainSetup,
  type Rlusd,
  type TxResult,
  type VaultSnapshot,
  type XrplAddress,
} from "@xrlp/shared";
import { systemClock, type Clock } from "../clock.ts";
import { fulfillmentMatches, isCondition } from "../conditions.ts";
import { fakeAddress, fakeHash } from "../ids.ts";
import { fromMicro, toMicro, redemptionShares } from "../money.ts";

export interface FakeLedgerOptions {
  /** Simulated tx latency in ms (default: FAKE_LEDGER_DELAY_MS env or 0). */
  delayMs?: number;
  clock?: Clock;
  /** Salt for hash generation; set for deterministic output. */
  salt?: string;
  /** Persist ledger state here (JSON). */
  stateFile?: string;
  /** Accounts that have NO RLUSD trust line (pre-reveal safety tests). */
  noTrustLine?: XrplAddress[];
  /** Account the fake treats as the platform (actor on platform-signed txs). */
  platformAddress?: XrplAddress;
}

interface VaultState {
  vaultId: string;
  projectId: string;
  spv: XrplAddress;
  subscriptionDate: string;
  redemptionDate: string;
  deposits: string; // micro
  withdrawn: string;
  shareAccountingVersion?: 2;
  loaned: string;
  repaid: string;
  shares: Record<string, string>; // investor -> share units (1 RLUSD = 1e6)
}
interface EscrowState {
  owner: XrplAddress;
  offerSequence: number;
  destination: XrplAddress;
  amount: Rlusd;
  condition: string;
  cancelAfter: string;
  status: "open" | "finished" | "cancelled";
}
interface LoanState {
  loanId: string;
  vaultId: string;
  principal: string; // micro
  repaid: string;
  paymentTotal: number;
  paymentsMade: number;
  totalOwed?: string; // micro; preserves remainder from periodic-payment division
  periodicPayment: string; // micro
  startDate: string;
  intervalMs: number;
}
interface FakeLedgerState {
  n: number;
  seq: number;
  vaults: VaultState[];
  escrows: EscrowState[];
  loans: LoanState[];
  balances: Record<string, string>; // `${account}:${currency}` -> decimal
  log: TxResult[];
}

const emptyState = (): FakeLedgerState => ({ n: 0, seq: 1000, vaults: [], escrows: [], loans: [], balances: {}, log: [] });
const DAY_MS = 86_400_000;

export class FakeLedger implements LedgerPort {
  readonly mode = "fake" as const;
  private readonly delayMs: number;
  private readonly clock: Clock;
  private readonly salt: string;
  private readonly stateFile?: string;
  private readonly noTrustLine: Set<string>;
  readonly platformAddress: XrplAddress;
  private s: FakeLedgerState;

  constructor(opts: FakeLedgerOptions = {}) {
    this.delayMs = opts.delayMs ?? Number(process.env.FAKE_LEDGER_DELAY_MS ?? 0);
    this.clock = opts.clock ?? systemClock;
    this.salt = opts.salt ?? randomBytes(8).toString("hex");
    this.stateFile = opts.stateFile;
    this.noTrustLine = new Set(opts.noTrustLine ?? []);
    this.platformAddress = opts.platformAddress ?? fakeAddress("platform");
    this.s = this.stateFile && existsSync(this.stateFile) ? (JSON.parse(readFileSync(this.stateFile, "utf8")) as FakeLedgerState) : emptyState();
  }

  /** Every tx the fake recorded, oldest first (tests). */
  get submitted(): readonly TxResult[] {
    return this.s.log;
  }
  /** Drop all ledger state (demo reset). */
  reset(): void {
    this.s = emptyState();
    this.persist();
  }
  /** Test hook: remove/add a destination trust line. */
  setTrustLine(account: XrplAddress, has: boolean): void {
    if (has) this.noTrustLine.delete(account);
    else this.noTrustLine.add(account);
  }

  private reload(): void {
    if (this.stateFile && existsSync(this.stateFile)) this.s = JSON.parse(readFileSync(this.stateFile, "utf8")) as FakeLedgerState;
  }
  private persist(): void {
    if (!this.stateFile) return;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.s));
    renameSync(tmp, this.stateFile);
  }
  private async begin(): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    this.reload();
  }
  private now(): Date {
    return this.clock.now();
  }

  private tx(kind: ChainEventKind | undefined, label: string, result = "tesSUCCESS"): TxResult {
    const hash = fakeHash(`${this.salt}:${++this.s.n}:${label}`);
    const t: TxResult = { hash, explorerUrl: explorerTxUrl(hash), result, ...(kind ? { kind } : {}), at: this.now().toISOString() };
    this.s.log.push(t);
    return t;
  }
  /** Record a tec result on "ledger" (fee consumed) and throw. */
  private fail(result: string, message: string, Err: "ledger" | "tooSoon" = "ledger"): never {
    const t = this.tx(undefined, `fail:${result}`, result);
    this.persist();
    if (Err === "tooSoon") throw new TooSoonError(`${result}: ${message}`, { txResult: result, txHash: t.hash });
    throw new LedgerError("ledger_error", `${result}: ${message}`, { txResult: result, txHash: t.hash });
  }

  private bal(account: string, currency: "XRP" | "RLUSD"): bigint {
    return toMicro(this.s.balances[`${account}:${currency}`] ?? "0");
  }
  private move(from: string | null, to: string | null, amount: Rlusd): void {
    const a = toMicro(amount);
    if (from) this.s.balances[`${from}:RLUSD`] = fromMicro(this.bal(from, "RLUSD") - a < 0n ? 0n : this.bal(from, "RLUSD") - a);
    if (to) this.s.balances[`${to}:RLUSD`] = fromMicro(this.bal(to, "RLUSD") + a);
  }
  private vaultFor(projectId: string): VaultState {
    const v = this.s.vaults.find((x) => x.projectId === projectId);
    if (!v) this.fail("tecNO_ENTRY", `no vault for project ${projectId}`);
    return v;
  }
  private phase(v: VaultState): VaultSnapshot["phase"] {
    const t = this.now().getTime();
    if (t <= new Date(v.subscriptionDate).getTime()) return "subscription";
    if (t < new Date(v.redemptionDate).getTime()) return "investment";
    return "redemption";
  }
  private escrow(owner: string, seq: number): EscrowState | undefined {
    return this.s.escrows.find((e) => e.owner === owner && e.offerSequence === seq);
  }

  // ----- onboarding -----

  async payVerificationFee({ builder, amount }: { builder: XrplAddress; amount: Rlusd }): Promise<TxResult> {
    await this.begin();
    this.move(builder, this.platformAddress, amount);
    const t = this.tx("verification_fee_paid", `fee:${builder}`);
    this.persist();
    return t;
  }

  async issueCredential({ subject, type }: { subject: XrplAddress; type: string }): Promise<TxResult[]> {
    await this.begin();
    const out = [this.tx("credential_issued", `cred:${type}:${subject}`), this.tx("credential_accepted", `credacc:${type}:${subject}`)];
    this.persist();
    return out;
  }

  // ----- project setup -----

  async setupProjectOnChain(p: Parameters<LedgerPort["setupProjectOnChain"]>[0]): Promise<ProjectChainSetup> {
    await this.begin();
    const { project, subscriptionDate, redemptionDate, coverDeposit } = p;
    if (new Date(subscriptionDate) >= new Date(redemptionDate)) this.fail("temMALFORMED", "SubscriptionDate must be before RedemptionDate");
    if (this.s.vaults.some((v) => v.projectId === project.id)) this.fail("tecDUPLICATE", `vault for ${project.id} exists`);
    const spv = fakeAddress(`spv:${project.id}:${this.salt}`);
    const vaultId = fakeHash(`vault:${project.id}:${this.salt}`);
    const loanBrokerId = fakeHash(`broker:${project.id}:${this.salt}`);
    const shareMptIssuanceId = fakeHash(`mpt:${project.id}:${this.salt}`).slice(0, 48);
    this.s.vaults.push({ vaultId, projectId: project.id, spv, subscriptionDate, redemptionDate, deposits: "0", withdrawn: "0", shareAccountingVersion: 2, loaned: "0", repaid: "0", shares: {} });
    const txs = [this.tx(undefined, `spv:${project.id}`), this.tx("vault_created", `vault:${project.id}`), this.tx("loan_broker_created", `broker:${project.id}`)];
    if (coverDeposit) {
      this.move(this.platformAddress, null, coverDeposit);
      txs.push(this.tx("cover_deposited", `cover:${project.id}`));
    }
    this.persist();
    return { spv, vaultId, loanBrokerId, shareMptIssuanceId, subscriptionDate, redemptionDate, txs };
  }

  async deposit({ project, investor, amount }: { project: { id: string }; investor: XrplAddress; amount: Rlusd }): Promise<TxResult> {
    await this.begin();
    const v = this.vaultFor(project.id);
    if (this.phase(v) !== "subscription") this.fail("tecNO_PERMISSION", "deposits only during Subscription");
    v.deposits = fromMicro(toMicro(v.deposits) + toMicro(amount));
    v.shares[investor] = (BigInt(v.shares[investor] ?? "0") + toMicro(amount)).toString();
    this.move(investor, null, amount);
    const t = this.tx("vault_deposit", `dep:${project.id}:${investor}`);
    this.persist();
    return t;
  }

  async withdraw({ project, investor, amount }: { project: { id: string }; investor: XrplAddress; amount: Rlusd }): Promise<TxResult> {
    await this.begin();
    const v = this.vaultFor(project.id);
    if (this.phase(v) !== "redemption") this.fail("tecTOO_SOON", `withdrawals open at RedemptionDate ${v.redemptionDate}`, "tooSoon");
    const loan = this.s.loans.find((l) => l.vaultId === v.vaultId);
    if (v.shareAccountingVersion !== 2 || (loan && loan.totalOwed === undefined))
      throw new LedgerError("ledger_error", "Legacy fake vault needs a demo reset before redemption");
    const avail = toMicro(v.deposits) - toMicro(v.loaned) + toMicro(v.repaid) - toMicro(v.withdrawn);
    if (toMicro(amount) > avail) this.fail("tecINSUFFICIENT_FUNDS", "vault has insufficient available assets");
    const snapshot = this.vaultSnapshot(v);
    const burn = redemptionShares(toMicro(amount), toMicro(snapshot.assetsTotal), BigInt(snapshot.sharesOutstanding));
    const held = BigInt(v.shares[investor] ?? "0");
    if (burn > held) this.fail("tecINSUFFICIENT_FUNDS", "investor has insufficient shares");
    v.withdrawn = fromMicro(toMicro(v.withdrawn) + toMicro(amount));
    v.shares[investor] = (held - burn).toString();
    this.move(null, investor, amount);
    const t = this.tx("vault_withdraw", `wd:${project.id}:${investor}`);
    this.persist();
    return t;
  }

  async closeLoanAndCreateEscrows({ project, builder, conditions, cancelAfters }: Parameters<LedgerPort["closeLoanAndCreateEscrows"]>[0]): Promise<CloseResult> {
    await this.begin();
    const v = this.vaultFor(project.id);
    if (this.phase(v) === "subscription") this.fail("tecTOO_SOON", `LoanSet only after SubscriptionDate ${v.subscriptionDate}`, "tooSoon");
    if (this.phase(v) === "redemption") this.fail("tecNO_PERMISSION", "vault already in Redemption");
    if (conditions.length !== project.milestones.length || cancelAfters.length !== project.milestones.length)
      this.fail("temMALFORMED", "one condition + CancelAfter per milestone");
    if (new Set(conditions.map((c) => c.toUpperCase())).size !== conditions.length) this.fail("temMALFORMED", "duplicate escrow conditions");
    if (conditions.some((c) => !isCondition(c))) this.fail("temMALFORMED", "malformed PREIMAGE-SHA-256 condition");
    const issued = new Set(this.s.escrows.map((e) => e.condition));
    if (conditions.some((c) => issued.has(c.toUpperCase()))) this.fail("temMALFORMED", "condition already used by another escrow");
    if (cancelAfters.some((c) => new Date(c) >= new Date(v.redemptionDate))) this.fail("temMALFORMED", "CancelAfter must be before loan maturity");
    const principal = toMicro(project.terms.principal);
    if (toMicro(v.deposits) - toMicro(v.withdrawn) < principal) this.fail("tecINSUFFICIENT_FUNDS", "vault holds less than the principal");

    const loanId = fakeHash(`loan:${project.id}:${this.salt}`);
    const paymentTotal = Math.max(2, Math.round(project.terms.termDays / project.terms.paymentIntervalDays));
    const owed = principal + (principal * BigInt(project.terms.interestRateBps) * BigInt(project.terms.termDays)) / (10_000n * 365n);
    this.s.loans.push({
      loanId,
      vaultId: v.vaultId,
      principal: principal.toString(),
      repaid: "0",
      paymentTotal,
      paymentsMade: 0,
      totalOwed: owed.toString(),
      periodicPayment: (owed / BigInt(paymentTotal)).toString(),
      startDate: this.now().toISOString(),
      intervalMs: project.terms.paymentIntervalDays * DAY_MS,
    });
    v.loaned = fromMicro(principal);
    const txs: TxResult[] = [this.tx("loan_set", `loan:${project.id}`)];
    const escrows = project.milestones.map((m, i) => {
      const offerSequence = ++this.s.seq;
      this.s.escrows.push({
        owner: v.spv,
        offerSequence,
        destination: builder.address,
        amount: m.amount,
        condition: conditions[i]!.toUpperCase(),
        cancelAfter: cancelAfters[i]!,
        status: "open",
      });
      const t = this.tx("escrow_created", `escrow:${project.id}:${m.id}`);
      txs.push(t);
      return { milestoneId: m.id, owner: v.spv, offerSequence, condition: conditions[i]!.toUpperCase(), cancelAfter: cancelAfters[i]!, createTx: t.hash };
    });
    this.persist();
    return { loanId, escrows, txs };
  }

  // ----- release path -----

  async preflightFinish({ owner, offerSequence, destination }: { owner: XrplAddress; offerSequence: number; destination: XrplAddress }) {
    await this.begin();
    const e = this.escrow(owner, offerSequence);
    if (!e || e.status !== "open") return { ok: false, reason: "escrow not found or no longer open" };
    if (this.now().getTime() >= new Date(e.cancelAfter).getTime() - 60_000) return { ok: false, reason: "escrow is at or past CancelAfter" };
    if (e.destination !== destination) return { ok: false, reason: "destination does not match escrow" };
    if (this.noTrustLine.has(destination)) return { ok: false, reason: "destination has no RLUSD trust line" };
    return { ok: true };
  }

  async finishEscrow({ owner, offerSequence, condition, fulfillment }: Parameters<LedgerPort["finishEscrow"]>[0]): Promise<TxResult> {
    await this.begin();
    const e = this.escrow(owner, offerSequence);
    if (!e || e.status !== "open") this.fail("tecNO_TARGET", "escrow not found");
    if (this.now() >= new Date(e.cancelAfter)) this.fail("tecNO_PERMISSION", "escrow past CancelAfter cannot be finished");
    if (e.condition !== condition.toUpperCase() || !fulfillmentMatches(e.condition, fulfillment))
      this.fail("tecCRYPTOCONDITION_ERROR", "fulfillment does not match escrow condition");
    if (this.noTrustLine.has(e.destination)) this.fail("tecNO_LINE", "destination has no trust line");
    e.status = "finished";
    this.move(null, e.destination, e.amount);
    const t = this.tx("escrow_finished", `finish:${owner}:${offerSequence}`);
    this.persist();
    return t;
  }

  async tryFinishWithWrongFulfillment({ owner, offerSequence }: { owner: XrplAddress; offerSequence: number; condition: string }): Promise<TxResult> {
    await this.begin();
    const e = this.escrow(owner, offerSequence);
    const t = this.tx("release_refused", `steal:${owner}:${offerSequence}`, e ? "tecCRYPTOCONDITION_ERROR" : "tecNO_TARGET");
    this.persist();
    return t;
  }

  async cancelEscrow({ owner, offerSequence }: { owner: XrplAddress; offerSequence: number }): Promise<TxResult> {
    await this.begin();
    const e = this.escrow(owner, offerSequence);
    if (!e || e.status !== "open") this.fail("tecNO_TARGET", "escrow not found");
    if (this.now() < new Date(e.cancelAfter)) this.fail("tecNO_PERMISSION", `escrow CancelAfter ${e.cancelAfter} has not passed`);
    e.status = "cancelled";
    this.move(null, owner, e.amount);
    const t = this.tx("escrow_cancelled", `cancel:${owner}:${offerSequence}`);
    this.persist();
    return t;
  }

  async repayLoan({ project, amount }: Parameters<LedgerPort["repayLoan"]>[0]): Promise<TxResult> {
    await this.begin();
    const v = this.vaultFor(project.id);
    const loan = this.s.loans.find((l) => l.vaultId === v.vaultId);
    if (!loan) this.fail("tecNO_ENTRY", "no loan for project");
    if (toMicro(amount) < BigInt(loan.periodicPayment) && toMicro(amount) < BigInt(loan.principal) - BigInt(loan.repaid))
      this.fail("tecINSUFFICIENT_PAYMENT", `LoanPay below one periodic payment (${fromMicro(BigInt(loan.periodicPayment))})`);
    loan.repaid = (BigInt(loan.repaid) + toMicro(amount)).toString();
    loan.paymentsMade = Math.min(loan.paymentTotal, loan.paymentsMade + 1);
    v.repaid = fromMicro(toMicro(v.repaid) + toMicro(amount));
    this.move(v.spv, null, amount);
    const t = this.tx("loan_payment", `pay:${project.id}`);
    this.persist();
    return t;
  }

  async attest({ signer, memo }: { signer: string; spv: XrplAddress; memo: AttestMemo }): Promise<TxResult> {
    await this.begin();
    const kind: ChainEventKind | undefined =
      memo.kind === "audit" ? "audit_attested" : memo.kind === "verdict" ? "verdict_attested" : memo.kind === "decision" ? "decision_attested" : undefined;
    const t = this.tx(kind, `attest:${signer}:${memo.kind}:${memo.milestoneId}:${memo.hash}`);
    this.persist();
    return t;
  }

  async submitSignedBlob(blob: string): Promise<TxResult> {
    await this.begin();
    if (!/^[0-9A-Fa-f]{20,}$/.test(blob)) this.fail("temMALFORMED", "signed blob is not hex");
    const t = this.tx("audit_attested", `blob:${blob.slice(0, 32)}`);
    this.persist();
    return t;
  }

  // ----- reads -----

  async getVaultSnapshot({ vaultId }: { vaultId: string }): Promise<VaultSnapshot> {
    this.reload();
    const v = this.s.vaults.find((x) => x.vaultId === vaultId);
    if (!v) throw new LedgerError("ledger_error", `no vault ${vaultId}`);
    return this.vaultSnapshot(v);
  }

  private vaultSnapshot(v: VaultState): VaultSnapshot {
    const loan = this.s.loans.find((l) => l.vaultId === v.vaultId);
    const outstanding = loan ? BigInt(loan.totalOwed ?? (BigInt(loan.periodicPayment) * BigInt(loan.paymentTotal)).toString()) - BigInt(loan.repaid) : 0n;
    const available = toMicro(v.deposits) - toMicro(v.loaned) + toMicro(v.repaid) - toMicro(v.withdrawn);
    const total = available + (outstanding > 0n ? outstanding : 0n);
    const shares = Object.values(v.shares).reduce((a, s) => a + BigInt(s), 0n);
    return {
      assetsTotal: fromMicro(total),
      assetsAvailable: fromMicro(available),
      sharesOutstanding: shares.toString(),
      sharePrice: shares === 0n ? "1.000000" : (Number(total) / Number(shares)).toFixed(6),
      subscriptionDate: v.subscriptionDate,
      redemptionDate: v.redemptionDate,
      phase: this.phase(v),
    };
  }

  async getLoanSnapshot({ loanId }: { loanId: string }): Promise<LoanSnapshot> {
    this.reload();
    const l = this.s.loans.find((x) => x.loanId === loanId);
    if (!l) throw new LedgerError("ledger_error", `no loan ${loanId}`);
    const owed = BigInt(l.periodicPayment) * BigInt(l.paymentTotal);
    const remaining = owed - BigInt(l.repaid);
    const principalLeft = BigInt(l.principal) - BigInt(l.repaid);
    return {
      principalOutstanding: fromMicro(principalLeft > 0n ? principalLeft : 0n),
      totalValueOutstanding: fromMicro(remaining > 0n ? remaining : 0n),
      periodicPayment: fromMicro(BigInt(l.periodicPayment)),
      paymentRemaining: Math.max(0, l.paymentTotal - l.paymentsMade),
      nextPaymentDueDate: new Date(new Date(l.startDate).getTime() + (l.paymentsMade + 1) * l.intervalMs).toISOString(),
    };
  }

  async getEscrow(owner: XrplAddress, offerSequence: number): Promise<EscrowSnapshot | null> {
    this.reload();
    const e = this.escrow(owner, offerSequence);
    if (!e || e.status !== "open") return null;
    return { owner: e.owner, offerSequence: e.offerSequence, destination: e.destination, amount: e.amount, condition: e.condition, cancelAfter: e.cancelAfter };
  }

  async getBalance(account: XrplAddress, currency: "XRP" | "RLUSD"): Promise<string> {
    this.reload();
    return currency === "XRP" ? "100" : fromMicro(this.bal(account, "RLUSD"));
  }
}
