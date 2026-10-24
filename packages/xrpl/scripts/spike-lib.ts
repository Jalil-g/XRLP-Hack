// Shared helpers for the hour-1 devnet spikes (XRPL-01, XRPL-02). Fresh throwaway wallets per run,
// so a spike never depends on (or mutates) the bootstrap wallet store. Seeds go to .data only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Wallet } from "xrpl";
import { explorerTxUrl } from "@xrlp/shared";
import { config } from "../src/config.ts";
import { XrplTxError, type TxResult } from "../src/client.ts";
import { fundFromFaucet } from "../src/wallets.ts";

export interface SpikeRow {
  step: string;
  result: string;
  hash?: string;
  expected?: string;
}

export class Spike {
  readonly rows: SpikeRow[] = [];
  readonly notes: string[] = [];
  readonly accounts: Record<string, string> = {};
  private readonly seeds: Record<string, string> = {};

  constructor(readonly name: string) {}

  /** Generate + faucet-fund wallets (3 at a time; the faucet throttles bursts). */
  async fund<K extends string>(roles: readonly K[]): Promise<Record<K, Wallet>> {
    const out = {} as Record<K, Wallet>;
    for (let i = 0; i < roles.length; i += 3) {
      await Promise.all(
        roles.slice(i, i + 3).map(async (role) => {
          const w = Wallet.generate();
          await fundFromFaucet(w);
          out[role] = w;
          this.accounts[role] = w.classicAddress;
          this.seeds[role] = w.seed!;
        }),
      );
    }
    this.log(`funded ${roles.join(", ")}`);
    return out;
  }

  log(s: string): void {
    console.log(s);
  }

  note(s: string): void {
    this.notes.push(s);
    console.log(`NOTE: ${s}`);
  }

  /** Run a tx that must succeed; record it. */
  async ok(step: string, run: () => Promise<TxResult | undefined>): Promise<TxResult | undefined> {
    const tx = await run();
    if (tx) {
      this.rows.push({ step, result: tx.result, hash: tx.hash });
      this.log(`  ✔ ${step}: ${tx.result} ${tx.explorerUrl}`);
    }
    return tx;
  }

  /** Run a tx that must fail with `expected` (a tec code, so it is on-ledger with a hash). Throws otherwise. */
  async fails(step: string, expected: string, run: () => Promise<unknown>): Promise<XrplTxError> {
    try {
      await run();
    } catch (e) {
      if (!(e instanceof XrplTxError)) throw e;
      this.rows.push({ step, result: e.engineResult, expected, ...(e.hash ? { hash: e.hash } : {}) });
      const mark = e.engineResult === expected ? "✔" : "✘";
      this.log(`  ${mark} ${step}: ${e.engineResult} (expected ${expected})${e.hash ? ` ${explorerTxUrl(e.hash)}` : ""}`);
      if (e.engineResult !== expected) throw e;
      return e;
    }
    throw new Error(`${step}: expected ${expected} but the tx succeeded`);
  }

  /** Markdown table for docs/xrpl-protocol-notes.md. */
  table(): string {
    const lines = ["| # | step | result | explorer |", "|---|---|---|---|"];
    this.rows.forEach((r, i) => {
      const res = r.expected ? `\`${r.result}\` (expected)` : `\`${r.result}\``;
      lines.push(`| ${i + 1} | ${r.step} | ${res} | ${r.hash ? explorerTxUrl(r.hash) : "— (not on ledger)"} |`);
    });
    return lines.join("\n");
  }

  /** Write the run record (incl. throwaway seeds) to DATA_DIR. Gitignored. */
  save(extra: Record<string, unknown> = {}): string {
    mkdirSync(config.dataDir, { recursive: true });
    const file = join(config.dataDir, `${this.name}-${Date.now().toString(36)}.json`);
    const record = { name: this.name, at: new Date().toISOString(), accounts: this.accounts, seeds: this.seeds, rows: this.rows, notes: this.notes, ...extra };
    writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    return file;
  }

  print(): void {
    console.log(`\n## ${this.name}\n`);
    console.log(`Accounts: ${Object.entries(this.accounts).map(([k, v]) => `${k} \`${v}\``).join(" · ")}\n`);
    console.log(this.table());
    for (const n of this.notes) console.log(`\nNOTE: ${n}`);
  }
}
