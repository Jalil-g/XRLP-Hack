// CORE-11 · Rehearsal harness: docs/04-demo-script.md beat by beat over core's HTTP API (routes 1–23 only), with a check list
// and a timer per scene. Exits 1 on drift (a hard check failed or a scene errored); soft checks are warnings (--strict: drift).
//
//   pnpm --filter @xrlp/core rehearse --self                 # in-process fake core on an ephemeral port (what CI runs)
//   pnpm --filter @xrlp/core serve & pnpm --filter @xrlp/core rehearse          # CORE_URL (default http://localhost:4000)
//   LEDGER_MODE=devnet ... pnpm --filter @xrlp/core serve; pnpm --filter @xrlp/core rehearse --seed prestage
//
// Flags: --self · --url <base> · --seed maple-st|prestage (default: prestage, falls back to maple-st on a fake core) ·
//        --no-reset (rehearse the state already loaded) · --strict · --withdraw-amount <RLUSD> (Project C, default 1)
//
// Projects are found by state, not id, so fake (maple-st: Maple St + Oak Ave) and devnet prestage (A/B/C) both work:
//   A = escrowed, M1 + M2 audited (beats 1–5) · B = an open escrow past CancelAfter (beat 6) · C = vault in Redemption (6b).
// Without a C (fake mode) beat 6b checks the redemption gate instead: withdraw from B before RedemptionDate -> 409 too_soon.
// Scene budgets are the demo-script windows; API time over budget is a warning (narration has to fit in the same window).
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import type { ChainEvent, Milestone, PortfolioPosition, ProjectDetail, ProjectSummary, TryStealResult, Verdict } from "@xrlp/shared";
import { createCore } from "../src/factory.ts";
import { createHttpServer } from "../src/http/app.ts";

export type Seed = "maple-st" | "prestage";

export interface Check {
  name: string;
  ok: boolean;
  /** Soft = warning (shown, exit 0) unless --strict. */
  soft?: boolean;
  detail?: string;
}

export interface SceneResult {
  id: string;
  title: string;
  ms: number;
  budgetS: number;
  checks: Check[];
  links: string[];
  error?: string;
}

export interface RehearsalReport {
  base: string;
  seed?: Seed;
  scenes: SceneResult[];
  /** Hard failures + scene errors (+ soft failures with strict). */
  drift: number;
  warnings: number;
  ok: boolean;
  totalMs: number;
}

export interface RehearseOptions {
  base: string;
  seed?: Seed;
  reset?: boolean;
  strict?: boolean;
  withdrawAmount?: string;
  log?: (line: string) => void;
}

class HttpError extends Error {
  readonly status: number;
  readonly body: any;
  constructor(status: number, body: any, what: string) {
    super(`${what}: HTTP ${status} ${body?.error?.code ?? ""} ${String(body?.error?.message ?? JSON.stringify(body)).slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

const LOCKED_DONE = new Set(["released", "refunded"]);
const isStalled = (m: Milestone, now: number) => !!m.escrow && !LOCKED_DONE.has(m.status) && !!m.cancelAfter && Date.parse(m.cancelAfter) <= now;
const kinds = (es: ChainEvent[]) => es.map((e) => e.kind);
const num = (s: string | undefined) => (s === undefined ? NaN : Number(s));

function linksOf(x: unknown, out: Set<string>): void {
  if (!x || typeof x !== "object") return;
  if (Array.isArray(x)) return x.forEach((v) => linksOf(v, out));
  for (const [k, v] of Object.entries(x)) {
    if (k === "explorerUrl" && typeof v === "string") out.add(v);
    else linksOf(v, out);
  }
}

export async function rehearse(o: RehearseOptions): Promise<RehearsalReport> {
  const log = o.log ?? (() => {});
  const base = o.base.replace(/\/$/, "");
  const scenes: SceneResult[] = [];
  let current: SceneResult | undefined;
  const t0 = Date.now();

  async function call<T = any>(method: "GET" | "POST", path: string, body?: unknown, expect: number[] = [200]): Promise<T> {
    const res = await fetch(base + path, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
    });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    // Links only for what the beat submits on stage (reads and the reset would repeat the whole timeline).
    if (current && method === "POST" && path !== "/api/admin/demo/reset") {
      const set = new Set(current.links);
      linksOf(json, set);
      if (json?.error?.txHash) set.add(`https://devnet.xrpl.org/transactions/${json.error.txHash}`);
      current.links = [...set];
    }
    if (!expect.includes(res.status)) throw new HttpError(res.status, json, `${method} ${path}`);
    return json as T;
  }
  const get = <T = any>(path: string) => call<T>("GET", path);
  const post = <T = any>(path: string, body?: unknown, expect?: number[]) => call<T>("POST", path, body ?? {}, expect);
  const detail = (id: string) => get<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`);
  const mpath = (id: string, mid: string, action: string) => `/api/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(mid)}/${action}`;

  async function scene(id: string, title: string, budgetS: number, fn: (expect: (name: string, ok: boolean, detail?: string, soft?: boolean) => void) => Promise<void>): Promise<boolean> {
    const s: SceneResult = { id, title, ms: 0, budgetS, checks: [], links: [] };
    current = s;
    const start = Date.now();
    try {
      await fn((name, ok, d, soft) => s.checks.push({ name, ok, ...(soft ? { soft } : {}), ...(d ? { detail: d } : {}) }));
    } catch (e) {
      s.error = (e as Error).message;
    }
    s.ms = Date.now() - start;
    current = undefined;
    scenes.push(s);
    printScene(s, log);
    return !s.error && s.checks.every((c) => c.ok || c.soft);
  }

  // ---------- setup: reset + find A/B/C ----------
  let seed = o.seed;
  let A: ProjectDetail | undefined;
  let B: ProjectDetail | undefined;
  let C: ProjectDetail | undefined;
  const setupOk = await scene("setup", "Reset + pre-staged state", 120, async (expect) => {
    expect("GET /api/health", (await get<{ ok: boolean }>("/api/health"))?.ok === true);
    if (o.reset !== false) {
      if (seed) await post("/api/admin/demo/reset", { seed });
      else {
        try {
          await post("/api/admin/demo/reset", { seed: "prestage" });
          seed = "prestage";
        } catch (e) {
          // A fake core refuses prestage ("needs LEDGER_MODE=devnet"); anything else (stale prestage file) is real drift.
          if (!(e instanceof HttpError && e.status === 400 && /LEDGER_MODE=devnet/.test(String(e.body?.error?.message)))) throw e;
          await post("/api/admin/demo/reset", { seed: "maple-st" });
          seed = "maple-st";
        }
      }
    }
    const list = await get<ProjectSummary[]>("/api/projects");
    const details = await Promise.all(list.map((p) => detail(p.id)));
    const now = Date.now();
    A = details.find((d) => d.project.status === "escrowed" && d.project.milestones[0]?.status === "audited" && d.project.milestones[1]?.status === "audited");
    B = details.find((d) => d !== A && d.project.milestones.some((m) => isStalled(m, now)));
    C = details.find((d) => d !== A && d !== B && d.vault?.phase === "redemption");
    expect("Project A: escrowed, M1 + M2 evidence and audits uploaded", !!A, A ? `${A.project.id} (${A.project.name})` : `projects: ${details.map((d) => `${d.project.id}=${d.project.status}[${d.project.milestones.map((m) => m.status).join(",")}]`).join(" ")}`);
    expect("Project B: an escrow already past CancelAfter", !!B, B ? `${B.project.id} (${B.project.name})` : undefined);
    expect("Project C: vault in Redemption (devnet prestage)", !!C || seed === "maple-st", C ? `${C.project.id} (${C.project.name})` : "none: beat 6b checks the redemption gate instead", seed === "maple-st" || !C);
  });
  if (!setupOk || !A) return finish();
  const a = A;
  const [m1, m2] = a.project.milestones as [Milestone, Milestone];

  // ---------- beat 1 ----------
  await scene("1", "Verified project", 15, async (expect) => {
    const card = (await get<ProjectSummary[]>("/api/projects")).find((p) => p.id === a.project.id);
    expect("marketplace card shows Verified", card?.verified === true);
    const builder = await get<ProjectDetail["builder"]>(`/api/builders/${encodeURIComponent(a.builder.id)}`);
    expect("builder is verified", builder.verified === true, builder.name);
    expect("VERIFIED_BUILDER credential tx on the builder page", !!builder.credentialTx, builder.credentialTx, true);
    const d = await detail(a.project.id);
    expect("verification report (identity / feasibility / capability)", d.verification?.decision === "pass", d.verification ? `${d.verification.decision}` : "no verification report on the project", true);
    const ks = kinds(d.events);
    expect("verification fee tx in the timeline", ks.includes("verification_fee_paid"), undefined, true);
    expect("credential tx in the timeline", ks.includes("credential_issued"), undefined, true);
  });

  // ---------- beat 2 ----------
  await scene("2", "Locked state", 15, async (expect) => {
    const d = await detail(a.project.id);
    expect("vault phase Investment", d.vault?.phase === "investment", d.vault?.phase);
    expect("share price shown", Number.isFinite(num(d.vault?.sharePrice)) && num(d.vault?.sharePrice) > 0, d.vault?.sharePrice);
    expect("loan open (principal outstanding)", num(d.loan?.principalOutstanding) > 0, d.loan?.principalOutstanding);
    expect("SoV on the project", (d.project.sov?.length ?? 0) > 0, `${d.project.sov?.length ?? 0} lines`, true);
    const escrows = d.project.milestones.filter((m) => m.escrow?.createTx);
    expect(`every milestone in its own escrow (${d.project.milestones.length})`, escrows.length === d.project.milestones.length, `${escrows.length} escrows`);
    const created = d.events.filter((e) => e.kind === "escrow_created" && e.explorerUrl);
    expect("EscrowCreate explorer links", created.length >= d.project.milestones.length, `${created.length} links`, true);
    expect("inspector assigned", d.inspectors.length > 0, d.inspectors.map((i) => i.name).join(", "));
  });

  // ---------- beat 3 ----------
  await scene("3", "Money shot: M1 checks -> released", 40, async (expect) => {
    const before = await detail(a.project.id);
    const b1 = before.project.milestones.find((m) => m.id === m1.id)!;
    expect("M1 audited before the run", b1.status === "audited", b1.status);
    const audits = before.audits[m1.id] ?? [];
    expect("inspector's signed audit on M1", audits.length > 0, audits[0]?.inspector);
    expect("audit attested on-ledger", !!audits[0]?.txHash, audits[0]?.txHash, true);
    const r = await post<{ verdict: Verdict; release?: { txHash: string; explorerUrl: string }; events: ChainEvent[] }>(mpath(a.project.id, m1.id, "run-checks"));
    const green = r.verdict.checks.filter((c) => c.result === "pass").length;
    expect("AI verdict pass", r.verdict.decision === "pass", `${r.verdict.decision} ${r.verdict.confidence.toFixed(2)}, ${green}/${r.verdict.checks.length} checks green`);
    expect("no red check", r.verdict.checks.every((c) => c.result !== "fail"), r.verdict.checks.filter((c) => c.result === "fail").map((c) => c.check).join(", ") || undefined);
    expect("escrow released (EscrowFinish link)", !!r.release?.explorerUrl, r.release?.explorerUrl);
    const ks = kinds(r.events);
    const vi = ks.indexOf("verdict_attested");
    const fi = ks.indexOf("escrow_finished");
    expect("verdict attested + EscrowFinish", vi >= 0 && fi >= 0, ks.join(" -> "));
    expect("verdict attested before the finish", vi >= 0 && fi >= 0 && vi < fi, undefined, true);
    const after = await detail(a.project.id);
    const a1 = after.project.milestones.find((m) => m.id === m1.id)!;
    expect("M1 Released", a1.status === "released" && !!a1.escrow?.finishTx, a1.status);
    expect("checks panel outcome pass", after.checks[m1.id]?.outcome === "pass", after.checks[m1.id]?.outcome);
  });

  // ---------- beat 4 ----------
  await scene("4", "Fraud held: M2 duplicate photo", 20, async (expect) => {
    const r = await post<{ verdict: Verdict; release?: unknown; events: ChainEvent[] }>(mpath(a.project.id, m2.id, "run-checks"));
    expect("AI verdict fail", r.verdict.decision === "fail", `${r.verdict.decision} ${r.verdict.confidence.toFixed(2)}`);
    expect("no release", r.release === undefined);
    const dup = r.verdict.checks.find((c) => c.check === "no_duplicate_photo");
    expect("no_duplicate_photo red", dup?.result === "fail", dup?.reason);
    expect("reason names IMG_2231.jpg", /IMG_2231/.test(dup?.reason ?? ""), undefined, true);
    expect("fail verdict attested", kinds(r.events).includes("verdict_attested"), kinds(r.events).join(" -> "));
    const d = await detail(a.project.id);
    const s2 = d.project.milestones.find((m) => m.id === m2.id)!;
    expect("M2 Failed", s2.status === "failed", s2.status);
    expect("M2 escrow still locked", !!s2.escrow && !s2.escrow.finishTx && !s2.escrow.cancelTx);
  });

  // ---------- beat 5 ----------
  await scene("5", "Ledger says no: try-steal M2", 10, async (expect) => {
    const r = await post<TryStealResult>(`/api/admin/demo/try-steal/${encodeURIComponent(a.project.id)}/${encodeURIComponent(m2.id)}`);
    expect("EscrowFinish refused tecCRYPTOCONDITION_ERROR", r.result === "tecCRYPTOCONDITION_ERROR", r.result);
    expect("explorer link for the failed finish", !!r.explorerUrl, r.explorerUrl);
    const d = await detail(a.project.id);
    const refused = d.events.find((e) => e.kind === "release_refused" && e.milestoneId === m2.id);
    expect("release_refused in the timeline", refused?.result === "tecCRYPTOCONDITION_ERROR", refused?.result);
    const s2 = d.project.milestones.find((m) => m.id === m2.id)!;
    expect("M2 escrow still locked after the attempt", s2.status === "failed" && !s2.escrow?.finishTx, s2.status);
  });

  // ---------- beat 6 ----------
  let bInvestor: string | undefined;
  await scene("6", "Stall -> keeper tick -> refund", 15, async (expect) => {
    if (!B) throw new Error("no Project B (open escrow past CancelAfter)");
    const b = B;
    const now = Date.now();
    const stalled = b.project.milestones.filter((m) => isStalled(m, now));
    const before = await detail(b.project.id);
    const tick = await post<{ events: ChainEvent[] }>("/api/admin/keeper/tick");
    for (const m of stalled) {
      const mine = kinds(tick.events.filter((e) => e.milestoneId === m.id));
      expect(`${m.id}: EscrowCancel + refund LoanPay`, mine.includes("escrow_cancelled") && mine.includes("loan_payment"), mine.join(" -> ") || "no keeper events");
    }
    const after = await detail(b.project.id);
    for (const m of stalled) {
      const s = after.project.milestones.find((x) => x.id === m.id)!;
      expect(`${m.id} refunded`, s.status === "refunded" && !!s.escrow?.cancelTx, s.status);
    }
    expect(`project ${b.project.id} stalled`, after.project.status === "stalled", after.project.status);
    const avBefore = num(before.vault?.assetsAvailable);
    const avAfter = num(after.vault?.assetsAvailable);
    expect("vault AssetsAvailable up", avAfter > avBefore, `${before.vault?.assetsAvailable} -> ${after.vault?.assetsAvailable}`, true);
    const again = await post<{ events: ChainEvent[] }>("/api/admin/keeper/tick");
    const repeat = again.events.filter((e) => e.projectId === b.project.id);
    expect("second tick is a no-op for B (idempotent)", repeat.length === 0, kinds(repeat).join(",") || undefined);
    bInvestor = after.investments[0]?.investor;
    if (bInvestor) {
      const pos = (await get<PortfolioPosition[]>(`/api/portfolio/${bInvestor}`)).find((p) => p.projectId === b.project.id);
      expect("portfolio: redeem opens <date>", !!pos?.redemptionDate, pos ? `${pos.phase}, redeem opens ${pos.redemptionDate}` : "no position", true);
    }
  });

  // ---------- beat 6b ----------
  await scene("6b", C ? "Redemption: investor withdraws (Project C)" : "Redemption gate (no Project C)", 10, async (expect) => {
    if (C) {
      const investor = C.investments[0]?.investor;
      if (!investor) throw new Error(`Project C ${C.project.id} has no investments`);
      const r = await post<{ events: ChainEvent[] }>(`/api/projects/${encodeURIComponent(C.project.id)}/withdrawals`, { investor, amount: o.withdrawAmount ?? "1" });
      expect("VaultWithdraw", r.events[0]?.kind === "vault_withdraw" && !!r.events[0]?.explorerUrl, r.events[0]?.explorerUrl);
      return;
    }
    if (!B || !bInvestor) throw new Error("no Project B investor for the redemption gate");
    const r = await call("POST", `/api/projects/${encodeURIComponent(B.project.id)}/withdrawals`, { investor: bInvestor, amount: "1" }, [200, 409]);
    expect("withdraw before RedemptionDate -> 409 too_soon", r?.error?.code === "too_soon", r?.error?.message ?? "withdraw succeeded");
  });

  return finish();

  function finish(): RehearsalReport {
    let drift = 0;
    let warnings = 0;
    for (const s of scenes) {
      if (s.error) drift++;
      for (const c of s.checks) if (!c.ok) (c.soft && !o.strict ? warnings++ : drift++);
      if (s.ms > s.budgetS * 1000) warnings++;
    }
    const report: RehearsalReport = { base, ...(seed ? { seed } : {}), scenes, drift, warnings, ok: drift === 0, totalMs: Date.now() - t0 };
    printSummary(report, log);
    return report;
  }
}

function printScene(s: SceneResult, log: (l: string) => void): void {
  const bad = !!s.error || s.checks.some((c) => !c.ok && !c.soft);
  const secs = (s.ms / 1000).toFixed(1);
  const over = s.ms > s.budgetS * 1000 ? ` OVER the ${s.budgetS}s window` : ` / ${s.budgetS}s`;
  log(`${bad ? "✘" : "✔"} [${s.id}] ${s.title}  ${secs}s${over}`);
  for (const c of s.checks) log(`    ${c.ok ? "✔" : c.soft ? "!" : "✘"} ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  if (s.error) log(`    ✘ ERROR ${s.error}`);
  for (const l of s.links) log(`      ${l}`);
}

function printSummary(r: RehearsalReport, log: (l: string) => void): void {
  log("");
  log(`| scene | time (s) | window (s) | checks | result |`);
  log(`|---|---|---|---|---|`);
  for (const s of r.scenes) {
    const failed = s.checks.filter((c) => !c.ok);
    const res = s.error ? "error" : failed.some((c) => !c.soft) ? "DRIFT" : failed.length ? "warn" : "ok";
    log(`| ${s.id} ${s.title} | ${(s.ms / 1000).toFixed(1)} | ${s.budgetS} | ${s.checks.length - failed.length}/${s.checks.length} | ${res} |`);
  }
  log("");
  log(`${r.ok ? "REHEARSAL OK" : "REHEARSAL DRIFT"} on ${r.base} (seed ${r.seed ?? "none"}): ${r.drift} drift, ${r.warnings} warning(s), ${(r.totalMs / 1000).toFixed(1)}s total`);
}

/** In-process fake core (FakeLedger + FakeVerifier, fresh DATA_DIR) behind the real HTTP layer on an ephemeral port. */
export async function startSelfHosted(): Promise<{ base: string; close: () => Promise<void> }> {
  const dataDir = mkdtempSync(join(tmpdir(), "core-rehearse-"));
  const core = createCore({ dataDir, env: { DATA_DIR: dataDir } }); // env pinned: fake ledger + fake verifier whatever the shell says
  const app = createHttpServer(core.service, { dataDir });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(dataDir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      self: { type: "boolean", default: false },
      url: { type: "string" },
      seed: { type: "string" },
      "no-reset": { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      "withdraw-amount": { type: "string" },
    },
  });
  if (values.seed !== undefined && values.seed !== "maple-st" && values.seed !== "prestage") throw new Error(`--seed must be maple-st or prestage, got ${values.seed}`);
  const self = values.self ? await startSelfHosted() : undefined;
  const base = self?.base ?? values.url ?? process.env.CORE_URL ?? "http://localhost:4000";
  console.log(`rehearsing docs/04-demo-script.md against ${base}${self ? " (self-hosted fake core)" : ""}\n`);
  try {
    const report = await rehearse({
      base,
      ...(values.seed ? { seed: values.seed as Seed } : {}),
      reset: !values["no-reset"],
      strict: values.strict,
      ...(values["withdraw-amount"] ? { withdrawAmount: values["withdraw-amount"] } : {}),
      log: (l) => console.log(l),
    });
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await self?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`rehearse: ${(e as Error).message}`);
    process.exit(1);
  });
}
