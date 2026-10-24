// Inspector-side stand-in for the inspector's own device/wallet: generates and holds milestone escrow
// preimages. This is NOT part of the platform store — core never reads it. In the real product the
// fulfillment lives with the inspector (browser storage / Ledger device) and is sent only at release.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateMilestoneCondition } from "../conditions.ts";

export interface InspectorKeyring {
  /** Generate (or return existing) condition for a milestone; the fulfillment stays in the keyring. */
  conditionFor(milestoneId: string): string;
  /** Hand over the fulfillment (inspector approves release). */
  fulfillmentFor(milestoneId: string): string | undefined;
}

export class MemoryInspectorKeyring implements InspectorKeyring {
  protected entries = new Map<string, { condition: string; fulfillment: string }>();
  constructor(readonly inspector: string) {}
  conditionFor(milestoneId: string): string {
    let e = this.entries.get(milestoneId);
    if (!e) {
      e = generateMilestoneCondition();
      this.entries.set(milestoneId, e);
      this.persist();
    }
    return e.condition;
  }
  fulfillmentFor(milestoneId: string): string | undefined {
    return this.entries.get(milestoneId)?.fulfillment;
  }
  protected persist(): void {}
}

/** Demo-only: inspector keyring persisted at <dataDir>/inspector-keyrings/<inspector>.json (gitignored .data). */
export class FileInspectorKeyring extends MemoryInspectorKeyring {
  private readonly path: string;
  constructor(inspector: string, dataDir: string) {
    super(inspector);
    const dir = join(dataDir, "inspector-keyrings");
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `${inspector}.json`);
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, { condition: string; fulfillment: string }>;
      this.entries = new Map(Object.entries(raw));
    } catch {
      /* new keyring */
    }
  }
  protected override persist(): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.entries), null, 2));
    renameSync(tmp, this.path);
  }
}
