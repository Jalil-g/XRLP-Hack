// Release service (CORE-12, docs/03-architecture.md §Release, §Escrow gating). The only holder of escrow preimages.
//
//   close:   conditionsForClose -> one CSPRNG 32-byte preimage per milestone escrow, unique across ALL escrows ever issued
//            (a revealed fulfillment opens every escrow sharing its condition), stored AES-256-GCM encrypted under DATA_DIR.
//   release: escrow still matches our condition -> preflightFinish (pre-reveal safety: a failed finish would publish the
//            preimage while the escrow stays open) -> "release" attestation -> EscrowFinish. Caller decided outcome=pass.
//   steal:   route 23 demo, platform-signed finish with RANDOM bytes. Never touches the vault.
//
// Disclosed trust model: this service decides WHEN; the ledger fixes WHERE (builder or back to the SPV).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LedgerError, explorerTxUrl, type AttestMemo, type LedgerPort, type Milestone, type Project, type TxResult } from "@xrlp/shared";
import type { ReleaseServicePort } from "./api-surface.ts";
import { conditionFromFulfillment } from "./conditions.ts";
import { DomainError } from "./errors.ts";
import { sha256Hex } from "./ids.ts";
import { SerialQueue } from "./store.ts";

/** One escrow's secret. `preimage` is plaintext only in memory. */
export interface PreimageEntry {
  projectId: string;
  milestoneId: string;
  condition: string;
  preimage: Buffer;
  createdAt: string;
  releasedAt?: string;
  /** A finish carrying this fulfillment failed: the preimage may be public while the escrow is open. Never reuse. */
  exposedAt?: string;
}

/** Where preimages live. Implementations must never log or return them outside this module. */
export interface PreimageVault {
  all(): Promise<PreimageEntry[]>;
  /** Replace the whole set (serialized by the caller). */
  save(entries: PreimageEntry[]): Promise<void>;
}

export class MemoryPreimageVault implements PreimageVault {
  private entries: PreimageEntry[] = [];
  async all(): Promise<PreimageEntry[]> {
    return this.entries.map((e) => ({ ...e, preimage: Buffer.from(e.preimage) }));
  }
  async save(entries: PreimageEntry[]): Promise<void> {
    this.entries = entries.map((e) => ({ ...e, preimage: Buffer.from(e.preimage) }));
  }
}

interface SealedEntry extends Omit<PreimageEntry, "preimage"> {
  iv: string;
  tag: string;
  ct: string;
}

/**
 * AES-256-GCM sealed file under DATA_DIR. Key: RELEASE_VAULT_KEY (64 hex chars) if set, else a generated key file
 * next to the vault (demo only, disclosed: production uses a KMS/HSM).
 */
export class FilePreimageVault implements PreimageVault {
  readonly path: string;
  readonly keyPath: string;
  private key?: Buffer;
  constructor(
    dataDir: string,
    private readonly envKey: string | undefined = process.env.RELEASE_VAULT_KEY,
  ) {
    this.path = join(dataDir, "release-vault.json");
    this.keyPath = join(dataDir, "release-vault.key");
  }

  private async getKey(): Promise<Buffer> {
    if (this.key) return this.key;
    if (this.envKey) {
      if (!/^[0-9a-fA-F]{64}$/.test(this.envKey)) throw new Error("RELEASE_VAULT_KEY must be 64 hex chars");
      return (this.key = Buffer.from(this.envKey, "hex"));
    }
    try {
      this.key = Buffer.from((await readFile(this.keyPath, "utf8")).trim(), "hex");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.key = randomBytes(32);
      await writeAtomic(this.keyPath, this.key.toString("hex"));
      await chmod(this.keyPath, 0o600);
    }
    if (this.key.length !== 32) throw new Error(`${this.keyPath} is not a 32-byte key`);
    return this.key;
  }

  async all(): Promise<PreimageEntry[]> {
    let sealed: SealedEntry[];
    try {
      sealed = JSON.parse(await readFile(this.path, "utf8")) as SealedEntry[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const key = await this.getKey();
    return sealed.map(({ iv, tag, ct, ...rest }) => {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
      d.setAAD(Buffer.from(rest.condition));
      d.setAuthTag(Buffer.from(tag, "hex"));
      return { ...rest, preimage: Buffer.concat([d.update(Buffer.from(ct, "hex")), d.final()]) };
    });
  }

  async save(entries: PreimageEntry[]): Promise<void> {
    const key = await this.getKey();
    const sealed: SealedEntry[] = entries.map(({ preimage, ...rest }) => {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(rest.condition)); // binds ciphertext to its condition
      const ct = Buffer.concat([c.update(preimage), c.final()]);
      return { ...rest, iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), ct: ct.toString("hex") };
    });
    await writeAtomic(this.path, JSON.stringify(sealed, null, 2));
    await chmod(this.path, 0o600);
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, path);
}

const fulfillmentOf = (preimage: Buffer) => `A0228020${preimage.toString("hex")}`.toUpperCase();
const AMBIGUOUS_FINISH_RESULTS = new Set(["connection_lost", "unknown_outcome"]);

export interface ReleaseServiceOptions {
  ledger: LedgerPort;
  vault: PreimageVault;
  now?: () => Date;
  /** Test hook. Default: 32 CSPRNG bytes. */
  random?: () => Buffer;
}

export class ReleaseService implements ReleaseServicePort {
  private readonly ledger: LedgerPort;
  private readonly vault: PreimageVault;
  private readonly now: () => Date;
  private readonly random: () => Buffer;
  private readonly queue = new SerialQueue();

  constructor(opts: ReleaseServiceOptions) {
    this.ledger = opts.ledger;
    this.vault = opts.vault;
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? (() => randomBytes(32));
  }

  conditionsForClose(project: Project): Promise<string[]> {
    return this.queue.run(async () => {
      const entries = await this.vault.all();
      const taken = new Set(entries.map((e) => e.condition));
      const out: string[] = [];
      for (const m of project.milestones) {
        if (m.escrow) throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${m.id} already has an escrow`);
        // Idempotent across a failed close attempt: no escrow exists yet, so re-issuing the same condition is safe.
        const existing = entries.find((e) => e.projectId === project.id && e.milestoneId === m.id);
        if (existing) {
          out.push(existing.condition);
          continue;
        }
        const preimage = this.random();
        if (preimage.length !== 32) throw new Error("preimage must be 32 bytes");
        const condition = conditionFromFulfillment(fulfillmentOf(preimage));
        if (taken.has(condition)) throw new DomainError("CONFLICT", `Duplicate escrow condition for ${m.id}; refusing to reuse a preimage`);
        taken.add(condition);
        entries.push({ projectId: project.id, milestoneId: m.id, condition, preimage, createdAt: this.now().toISOString() });
        out.push(condition);
      }
      await this.vault.save(entries);
      return out;
    });
  }

  release({ project, milestone }: { project: Project; milestone: Milestone }): Promise<TxResult[]> {
    return this.queue.run(async () => {
      const escrow = milestone.escrow;
      if (!escrow) throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${milestone.id} has no escrow`);
      const entries = await this.vault.all();
      const entry = entries.find((e) => e.projectId === project.id && e.milestoneId === milestone.id);
      if (!entry) throw new DomainError("NOT_FOUND", `No release key for ${milestone.id}`);
      if (entry.condition !== escrow.condition.toUpperCase()) {
        throw new DomainError("UNSAFE_RELEASE", `Escrow condition for ${milestone.id} does not match the issued key`);
      }
      if (entry.releasedAt) throw new DomainError("CONFLICT", `Milestone ${milestone.id} was already released at ${entry.releasedAt}`);
      if (entry.exposedAt) {
        throw new DomainError("UNSAFE_RELEASE", `Release key for ${milestone.id} was exposed by a failed finish at ${entry.exposedAt}; let it expire and re-escrow`);
      }

      // Pre-reveal safety. Nothing is submitted unless the finish is expected to succeed.
      const onLedger = await this.ledger.getEscrow(escrow.owner, escrow.offerSequence);
      if (!onLedger) throw new DomainError("UNSAFE_RELEASE", `Escrow ${escrow.owner}/${escrow.offerSequence} not found on ledger`);
      if (onLedger.condition && onLedger.condition.toUpperCase() !== entry.condition) {
        throw new DomainError("UNSAFE_RELEASE", "On-ledger escrow condition differs from the issued key");
      }
      const pre = await this.ledger.preflightFinish({ owner: escrow.owner, offerSequence: escrow.offerSequence, destination: onLedger.destination });
      if (!pre.ok) throw new DomainError("UNSAFE_RELEASE", `Pre-reveal safety refused: ${pre.reason ?? "unknown"}`);

      const memo: AttestMemo = { v: 1, kind: "release", milestoneId: milestone.id, hash: sha256Hex(entry.condition) };
      const attest = await this.ledger.attest({ signer: "releaseService", spv: escrow.owner, memo });
      let finish: TxResult;
      try {
        finish = await this.ledger.finishEscrow({
          owner: escrow.owner,
          offerSequence: escrow.offerSequence,
          condition: entry.condition,
          fulfillment: fulfillmentOf(entry.preimage),
        });
      } catch (e) {
        const err = e as { code?: string; txResult?: string; txHash?: string; message?: string };
        const tx = { txResult: err.txResult, txHash: err.txHash };

        // The adapter guarantees `unsafe_release` means preflight refused before the fulfillment left
        // the process. Preserve the key so the operator can fix the safety condition and retry.
        if (e instanceof LedgerError && e.code === "unsafe_release") {
          throw new DomainError(
            "UNSAFE_RELEASE",
            `EscrowFinish was refused before submission; release key preserved: ${err.message ?? String(e)}`,
            e,
            tx,
          );
        }

        // A transport/lookup failure can hide a successful finish. Re-read the escrow before declaring
        // failure: if it is gone, the fixed destination received the funds and the release must advance.
        if (err.txResult && AMBIGUOUS_FINISH_RESULTS.has(err.txResult)) {
          let after: Awaited<ReturnType<LedgerPort["getEscrow"]>> | undefined;
          try {
            after = await this.ledger.getEscrow(escrow.owner, escrow.offerSequence);
          } catch {
            // Reconciliation itself is uncertain. Fall through to the conservative exposed-key path.
          }
          if (after === null) {
            entry.releasedAt = this.now().toISOString();
            await this.vault.save(entries);
            if (err.txHash) {
              finish = {
                hash: err.txHash,
                explorerUrl: explorerTxUrl(err.txHash),
                result: "reconciled_escrow_consumed",
                kind: "escrow_finished",
              };
              return [attest, finish];
            }
            throw new DomainError(
              "LEDGER_ERROR",
              "Escrow disappeared after an ambiguous finish, but no transaction hash was returned; the key is marked released and the operator must reconcile the ledger event",
              e,
              tx,
            );
          }
        }

        // The fulfillment may now be public while the escrow remains open, or reconciliation failed.
        entry.exposedAt = this.now().toISOString();
        await this.vault.save(entries);
        throw new DomainError("LEDGER_ERROR", `EscrowFinish failed after preflight; release key marked exposed: ${err.message ?? String(e)}`, e, {
          txResult: err.txResult,
          txHash: err.txHash,
        });
      }

      entry.releasedAt = this.now().toISOString();
      await this.vault.save(entries);
      return [attest, { ...finish, kind: finish.kind ?? "escrow_finished" }];
    });
  }

  async tryStealDemo({ milestone }: { project: Project; milestone: Milestone }): Promise<TxResult> {
    const escrow = milestone.escrow;
    if (!escrow) throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${milestone.id} has no escrow`);
    // Deliberately no vault access: the ledger itself must refuse this.
    const tx = await this.ledger.tryFinishWithWrongFulfillment({ owner: escrow.owner, offerSequence: escrow.offerSequence, condition: escrow.condition });
    return { ...tx, kind: tx.kind ?? "release_refused" };
  }

  clear(): Promise<void> {
    return this.queue.run(() => this.vault.save([]));
  }
}
