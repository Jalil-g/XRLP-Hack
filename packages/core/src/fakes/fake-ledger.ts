// In-process LedgerPort: realistic-looking tx hashes + devnet explorer URLs, optional latency, and the
// same failure modes the real ledger would have (bad fulfillment, finish after CancelAfter, cancel too early).
// TODO(adapters): replace with src/adapters/xrpl-ledger.ts wrapping @xrlp/xrpl (see ports.ts).
import { explorerTxUrl, type ChainEvent, type Rlusd, type XrplAddress } from "@xrlp/shared";
import { randomBytes } from "node:crypto";
import { systemClock, type Clock } from "../clock.ts";
import { fulfillmentMatches } from "../conditions.ts";
import { fakeAddress, fakeHash } from "../ids.ts";
import { PLATFORM_SCOPE, type LedgerPort } from "../ports.ts";

export interface FakeLedgerOptions {
  /** Simulated tx latency in ms (default: FAKE_LEDGER_DELAY_MS env or 0). */
  delayMs?: number;
  clock?: Clock;
  /** Salt for hash generation; set for deterministic output. */
  salt?: string;
  /** Address the fake uses as the platform signer for actor fields. */
  platformAddress?: XrplAddress;
}

export class FakeLedgerError extends Error {
  constructor(
    readonly engineResult: string,
    message: string,
  ) {
    super(`${engineResult}: ${message}`);
    this.name = "FakeLedgerError";
  }
}

export class FakeLedger implements LedgerPort {
  readonly mode = "fake" as const;
  private n = 0;
  private readonly delayMs: number;
  private readonly clock: Clock;
  private readonly salt: string;
  readonly platformAddress: XrplAddress;
  /** Every tx the fake "submitted", in order (handy for tests). */
  readonly submitted: ChainEvent[] = [];

  constructor(opts: FakeLedgerOptions = {}) {
    this.delayMs = opts.delayMs ?? Number(process.env.FAKE_LEDGER_DELAY_MS ?? 0);
    this.clock = opts.clock ?? systemClock;
    this.salt = opts.salt ?? randomBytes(8).toString("hex");
    this.platformAddress = opts.platformAddress ?? fakeAddress("platform");
  }

  private async tick(): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  private event(e: Omit<ChainEvent, "txHash" | "explorerUrl" | "at">): ChainEvent {
    const txHash = fakeHash(`${this.salt}:${++this.n}:${e.kind}:${e.projectId}:${e.milestoneId ?? ""}`);
    const ev: ChainEvent = { ...e, txHash, explorerUrl: explorerTxUrl(txHash), at: this.clock.now().toISOString() };
    this.submitted.push(ev);
    return ev;
  }

  async setupProjectOnChain({ project }: Parameters<LedgerPort["setupProjectOnChain"]>[0]) {
    await this.tick();
    const spv = fakeAddress(`spv:${project.id}:${this.salt}`);
    const vaultId = fakeHash(`vault:${project.id}:${this.salt}`);
    const loanBrokerId = fakeHash(`broker:${project.id}:${this.salt}`);
    const shareMptIssuanceId = fakeHash(`mpt:${project.id}:${this.salt}`).slice(0, 48);
    const events = [
      this.event({ projectId: project.id, kind: "vault_created", actor: this.platformAddress }),
      this.event({ projectId: project.id, kind: "loan_broker_created", actor: this.platformAddress }),
    ];
    return { spv, vaultId, loanBrokerId, shareMptIssuanceId, events };
  }

  async depositToVault({ project, investor, amount }: { project: { id: string }; investor: XrplAddress; amount: Rlusd }) {
    await this.tick();
    return this.event({ projectId: project.id, kind: "vault_deposit", actor: investor, amount });
  }

  async closeLoanAndCreateEscrows({ project, conditions }: Parameters<LedgerPort["closeLoanAndCreateEscrows"]>[0]) {
    await this.tick();
    const spv = project.chain.spv;
    if (!spv) throw new FakeLedgerError("tecNO_TARGET", "project has no SPV account");
    const loanId = fakeHash(`loan:${project.id}:${this.salt}`);
    const events: ChainEvent[] = [
      this.event({ projectId: project.id, kind: "loan_set", actor: spv, amount: project.terms.principal }),
    ];
    let seq = 1000 + (this.n % 97) * 10;
    const escrows = project.milestones.map((m) => {
      const c = conditions.find((x) => x.milestoneId === m.id);
      if (!c) throw new FakeLedgerError("temMALFORMED", `no condition for milestone ${m.id}`);
      const ev = this.event({ projectId: project.id, milestoneId: m.id, kind: "escrow_created", actor: spv, amount: m.amount });
      events.push(ev);
      return { milestoneId: m.id, owner: spv, offerSequence: ++seq, condition: c.condition, createTx: ev.txHash };
    });
    return { loanId, escrows, events };
  }

  async attestApproval({ project, milestone, signer }: Parameters<LedgerPort["attestApproval"]>[0]) {
    await this.tick();
    return this.event({ projectId: project.id, milestoneId: milestone.id, kind: "approval_attested", actor: signer });
  }

  async releaseMilestone({ project, milestone, fulfillment }: Parameters<LedgerPort["releaseMilestone"]>[0]) {
    await this.tick();
    if (!milestone.escrow) throw new FakeLedgerError("tecNO_TARGET", `no escrow for milestone ${milestone.id}`);
    if (milestone.cancelAfter && this.clock.now() >= new Date(milestone.cancelAfter))
      throw new FakeLedgerError("tecNO_PERMISSION", "escrow past CancelAfter cannot be finished");
    if (!fulfillmentMatches(milestone.escrow.condition, fulfillment))
      throw new FakeLedgerError("tecCRYPTOCONDITION_ERROR", "fulfillment does not match escrow condition");
    return this.event({
      projectId: project.id,
      milestoneId: milestone.id,
      kind: "escrow_finished",
      actor: this.platformAddress,
      amount: milestone.amount,
    });
  }

  async cancelExpiredMilestone({ project, milestone }: Parameters<LedgerPort["cancelExpiredMilestone"]>[0]) {
    await this.tick();
    if (!milestone.escrow) throw new FakeLedgerError("tecNO_TARGET", `no escrow for milestone ${milestone.id}`);
    if (!milestone.cancelAfter || this.clock.now() < new Date(milestone.cancelAfter))
      throw new FakeLedgerError("tecNO_PERMISSION", "escrow CancelAfter has not passed");
    return this.event({
      projectId: project.id,
      milestoneId: milestone.id,
      kind: "escrow_cancelled",
      actor: this.platformAddress,
      amount: milestone.amount,
    });
  }

  async repayLoan({ project, amount }: Parameters<LedgerPort["repayLoan"]>[0]) {
    await this.tick();
    return this.event({ projectId: project.id, kind: "loan_payment", actor: project.chain.spv, amount });
  }

  async withdrawFromVault({ project, investor, amount }: Parameters<LedgerPort["withdrawFromVault"]>[0]) {
    await this.tick();
    return this.event({ projectId: project.id, kind: "vault_withdraw", actor: investor, amount });
  }

  async issueCredential({ subject }: Parameters<LedgerPort["issueCredential"]>[0]) {
    await this.tick();
    return this.event({ projectId: PLATFORM_SCOPE, kind: "credential_issued", actor: subject });
  }
}
