// CORE-05 · Devnet HTTP e2e: the docs/04 demo flow driven over core's HTTP API (routes 1–23), nothing in-process.
//
//   WALLETS_FILE=.data/wallets.core05.json pnpm --filter @xrlp/xrpl bootstrap
//   LEDGER_MODE=devnet CORE_VERIFIER=verifier VERIFIER_MODE=mock WALLETS_FILE=.data/wallets.core05.json DATA_DIR=/tmp/core05 \
//     DEMO_CANCEL_AFTER_S=1500,1800,420 pnpm --filter @xrlp/core serve
//   WALLETS_FILE=.data/wallets.core05.json pnpm --filter @xrlp/core e2e:devnet      # CORE_URL (default http://localhost:4000)
//
// Flow: reset+seed (devnet parties) -> project -> fee -> verify -> lock-terms -> KYC -> invest x2 -> close too early (409) ->
// wait SubscriptionDate -> close -> M1 evidence + audit -> run-checks pass -> release; M2 with a reused photo -> fail, held;
// try-steal M2 -> tecCRYPTOCONDITION_ERROR; withdraw before RedemptionDate (409); wait M3 CancelAfter -> cancel -> refund; events.
// Evidence: the verifier's Maple St fixture photos with their EXIF capture time restamped to "now" (same byte length, GPS kept)
// + generated text invoice/inspection docs naming the builder and site, so the verifier mock can honestly pass.
// Prints a markdown table of every step with explorer links; writes the raw rows to $E2E_OUT (default $DATA_DIR/core05-e2e.json).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MILESTONE_TEMPLATES, type ChainEvent, type CreateProjectInput, type Project, type ProjectDetail, type SovLine } from "@xrlp/shared";
import type { DevnetIdentities } from "../src/adapters/devnet-identities.ts";

const FIXTURES = fileURLToPath(new URL("../../verifier/fixtures/evidence/maple-st/", import.meta.url));

export interface Row {
  step: string;
  status: number;
  outcome: string;
  links: string[];
}

export interface FlowOptions {
  base: string;
  ids: DevnetIdentities;
  /** Wall clock the server agrees with (real time on devnet, the FakeClock in the offline test). */
  now: () => Date;
  /** Resolve once the server's clock (and the ledger's) is past `t`. */
  waitUntil: (t: Date, why: string) => Promise<void>;
  /** Seconds from project creation to SubscriptionDate (funding deadline). Devnet setup + 2 deposits need ~2 min. */
  subscriptionS?: number;
  /** Principal per milestone (3 milestones). Small so a bootstrapped wallet set survives many runs. 6 payments (30 d / 5 d) keep
   *  one milestone >= one periodic payment: an escrow refund LoanPay below that is refused (tecINSUFFICIENT_PAYMENT). */
  milestoneAmount?: string;
  log?: (line: string) => void;
}

const SITE = { address: "41 Maple St, Brooklyn, NY 11216", geo: { lat: 40.6796, lng: -73.962, radiusM: 150 } };

function sov(amount: string): SovLine[] {
  return ["foundation", "framing", "dry_in"].map((key) => {
    const t = MILESTONE_TEMPLATES.residential_new.find((x) => x.key === key)!;
    return { code: key, title: t.title, amount, trade: key, evidence: t.requiredEvidence, visualCriteria: t.visualCriteria };
  });
}

const exifStamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ").replace(/-/g, ":");

/** Fixture JPEG with every EXIF date string replaced by `takenAt` (same length, so the file stays valid). */
export function restampedPhoto(rel: string, takenAt: Date): Buffer {
  const bytes = readFileSync(join(FIXTURES, rel));
  const s = bytes.toString("latin1").replace(/\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/g, exifStamp(takenAt));
  return Buffer.from(s, "latin1");
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

interface Upload {
  kind: "photo" | "invoice" | "document";
  filename: string;
  mime: string;
  bytes: Buffer;
}

const linksOf = (x: unknown): string[] => {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, val] of Object.entries(v)) {
      if (k === "explorerUrl" && typeof val === "string") out.add(val);
      else walk(val);
    }
  };
  walk(x);
  return [...out];
};

export async function runDevnetFlow(o: FlowOptions): Promise<Row[]> {
  const log = o.log ?? (() => {});
  const rows: Row[] = [];
  const amount = o.milestoneAmount ?? "100";
  const principal = String(Number(amount) * 3);

  async function call<T = any>(step: string, method: "GET" | "POST", path: string, body?: unknown, expect: number[] = [200], outcome?: (j: any) => string): Promise<T> {
    const init: RequestInit = { method };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "content-type": "application/json" };
    }
    const t0 = Date.now();
    const res = await fetch(o.base + path, init);
    const j = (await res.json()) as any;
    const row: Row = {
      step,
      status: res.status,
      outcome: res.ok ? (outcome?.(j) ?? "ok") : `${j?.error?.code}${j?.error?.txResult ? ` ${j.error.txResult}` : ""}: ${String(j?.error?.message).slice(0, 140)}`,
      links: linksOf(j),
    };
    if (j?.error?.txHash) row.links.push(`https://devnet.xrpl.org/transactions/${j.error.txHash}`);
    rows.push(row);
    log(`${String(res.status).padEnd(4)} ${step} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${row.outcome}${row.links.length ? `\n       ${row.links.join("\n       ")}` : ""}`);
    if (!expect.includes(res.status)) throw new Error(`${step}: HTTP ${res.status} (expected ${expect.join("|")}): ${JSON.stringify(j).slice(0, 600)}`);
    return j as T;
  }

  const evidenceForm = (files: Upload[]) => {
    const f = new FormData();
    for (const u of files) {
      f.append("files", new Blob([new Uint8Array(u.bytes)], { type: u.mime }), u.filename);
      f.append("kind", u.kind);
    }
    return f;
  };
  const auditForm = (report: unknown) => {
    const f = new FormData();
    f.append("report", JSON.stringify(report));
    return f;
  };
  const doc = (kind: "invoice" | "document", filename: string, lines: string[]): Upload => ({ kind, filename, mime: "text/plain", bytes: Buffer.from(lines.join("\n") + "\n") });

  // 21: clean store + devnet parties (builder, panel, KYC'd investors) from WALLETS_FILE
  await call("reset + seed devnet parties", "POST", "/api/admin/demo/reset", { seed: "participants" });
  const builders = await call<{ id: string; address: string; name: string }[]>("builders", "GET", "/api/builders", undefined, [200], (j) => `${j.length} builder(s)`);
  const builder = builders.find((b) => b.address === o.ids.builder.address);
  if (!builder) throw new Error(`builder ${o.ids.builder.address} not registered by the devnet seed`);
  await call("inspector panel", "GET", "/api/inspectors", undefined, [200], (j) => `${j.length} verified: ${j.map((i: any) => i.address).join(", ")}`);
  const [inv1, inv2, inv3] = o.ids.investors;

  // 3–5
  const created = o.now();
  const input: CreateProjectInput = {
    name: `CORE-05 e2e ${created.toISOString().slice(0, 16)}`,
    type: "residential_new",
    builderId: builder.id,
    siteAddress: SITE.address,
    siteGeo: SITE.geo,
    description: "Devnet HTTP e2e (CORE-05): 3 milestones.",
    terms: { principal, interestRateBps: 1000, termDays: 30, paymentIntervalDays: 5, fundingDeadline: new Date(created.getTime() + (o.subscriptionS ?? 240) * 1000).toISOString() },
    sov: sov(amount),
    documents: [
      { kind: "license", filename: "contractor-license.pdf", fields: { status: "active" } },
      { kind: "insurance", filename: "gl-certificate.pdf", fields: { status: "active" } },
      { kind: "entity", filename: "llc-good-standing.pdf" },
      { kind: "permit", filename: "building-permit.pdf" },
    ],
  };
  const project = await call<Project>("3 create project", "POST", "/api/projects", input, [200], (j) => `${j.id} principal ${principal}, SubscriptionDate ${input.terms.fundingDeadline}`);
  const P = `/api/projects/${project.id}`;
  await call("4 verification fee", "POST", `${P}/verification-fee`, { builder: builder.address }, [200], (j) => `status ${j.project.status}`);
  const v = await call("5 verify project", "POST", `${P}/verify-project`, undefined, [200], (j) => `${j.verification.decision} -> ${j.project.status}`);
  if (v.project.status !== "verified") throw new Error(`verification ${v.verification.decision}: ${v.verification.summary}`);

  // 6
  const locked = await call("6 lock terms (vault + broker + cover + SPV)", "POST", `${P}/lock-terms`, { actor: o.ids.platform }, [200], (j) => `vault ${j.project.chain.vaultId?.slice(0, 12)}…, SPV ${j.project.chain.spv}, inspector ${j.assignment.inspectors.join(",")}`);
  const inspector: string = locked.assignment.inspectors[0];

  // 19 + 7
  await call("19 KYC investor1", "POST", `/api/investors/${inv1!.address}/kyc`, undefined, [200], (j) => (j.events.length ? `${j.events.length} tx` : "already accepted on-ledger"));
  await call("19 KYC investor2", "POST", `/api/investors/${inv2!.address}/kyc`, undefined, [200], (j) => (j.events.length ? `${j.events.length} tx` : "already accepted on-ledger"));
  await call("7 invest investor3 (no KYC)", "POST", `${P}/investments`, { investor: inv3!.address, amount: amount }, [403]);
  const half = (Number(principal) / 2).toString();
  await call("7 invest investor1", "POST", `${P}/investments`, { investor: inv1!.address, amount: half }, [200], (j) => `${j.investment.amount} RLUSD`);
  await call("7 invest investor2", "POST", `${P}/investments`, { investor: inv2!.address, amount: half }, [200], (j) => `${j.investment.amount} RLUSD`);

  // 8: too soon, then after SubscriptionDate
  await call("8 close before SubscriptionDate", "POST", `${P}/close`, { actor: o.ids.platform }, [409]);
  await o.waitUntil(new Date(input.terms.fundingDeadline), "SubscriptionDate");
  let closed: { project: Project; events: ChainEvent[] } | undefined;
  for (let attempt = 1; !closed; attempt++) {
    const r = await fetch(`${o.base}${P}/close`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: o.ids.platform }) });
    if (r.status === 409 && attempt < 12) {
      const j = (await r.json()) as any;
      if (j?.error?.code !== "too_soon") throw new Error(`close: ${JSON.stringify(j)}`);
      log(`     close: ledger not past SubscriptionDate yet (attempt ${attempt}), retrying in 5 s`);
      await o.waitUntil(new Date(o.now().getTime() + 5_000), "ledger close time");
      continue;
    }
    if (r.status !== 200) throw new Error(`close: HTTP ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { project: Project; events: ChainEvent[] };
    closed = j;
    const row: Row = { step: "8 close: LoanSet + EscrowCreate x3", status: 200, outcome: `${j.project.status}, loan ${j.project.chain.loanId?.slice(0, 12)}…, CancelAfter ${j.project.milestones.map((m) => m.cancelAfter).join(" / ")}`, links: linksOf(j) };
    rows.push(row);
    log(`200  ${row.step}: ${row.outcome}\n       ${row.links.join("\n       ")}`);
  }
  const [m1, m2, m3] = closed.project.milestones;
  const escrowAt = (m: typeof m1) => new Date(m?.escrow?.createdAt ?? o.now().toISOString());

  // M1: honest submission -> pass -> release
  const t1 = new Date(Math.max(escrowAt(m1).getTime() + 5_000, o.now().getTime() - 60_000));
  const day = o.now().toISOString().slice(0, 10);
  const m1Files: Upload[] = [
    ...["foundation-01-wide.jpg", "foundation-02-bolts.jpg", "foundation-03-walls.jpg"].map((f, i) => ({ kind: "photo" as const, filename: f, mime: "image/jpeg", bytes: restampedPhoto(`foundation/${f}`, new Date(t1.getTime() + i * 5_000)) })),
    doc("invoice", "invoice-concrete.txt", ["GOTHAM READY-MIX CONCRETE", "Invoice No: GRM-E2E", `Date: ${day}`, `Bill To: ${builder.name}`, `Job Site: ${SITE.address}`, "Ready-mix + rebar + anchor bolts", `TOTAL: $${amount}.00`]),
    doc("document", "footing-inspection.txt", ["Footing / Foundation Inspection Sign-off (SYNTHETIC DEMO DOCUMENT)", `Date: ${day}`, `Contractor: ${builder.name}`, `Site: ${SITE.address}`, "Result: APPROVED"]),
  ];
  await call("9 M1 evidence", "POST", `${P}/milestones/${m1!.id}/evidence`, evidenceForm(m1Files), [200], (j) => `${j.evidence.length} files, ${j.milestone.status}`);
  const bundle = (files: Upload[]) => sha256(files.map((f) => sha256(f.bytes)).sort().join("\n"));
  await call("10 M1 audit (assigned inspector)", "POST", `${P}/milestones/${m1!.id}/audit`, auditForm({ inspector, evidenceBundleHash: bundle(m1Files), checklist: [{ sovCode: "foundation", status: "done" }], notes: "Slab cured, anchor bolts set, no framing yet." }), [200], (j) => j.milestone.status);
  const r1 = await call("11 M1 run checks", "POST", `${P}/milestones/${m1!.id}/run-checks`, undefined, [200], (j) => `${j.verdict.decision}${j.release ? " -> released" : ""}`);
  if (r1.verdict.decision !== "pass" || !r1.release) throw new Error(`M1 expected pass + release: ${JSON.stringify(r1.verdict.checks.filter((c: any) => c.result !== "pass"))}`);

  // M2: a photo reused from M1 under a new name -> no_duplicate_photo fail, funds held
  const t2 = new Date(Math.max(escrowAt(m2).getTime() + 5_000, o.now().getTime() - 60_000));
  const m2Files: Upload[] = [
    ...["framing-01-wide.jpg", "framing-02-corner.jpg", "framing-03-wall.jpg"].map((f, i) => ({ kind: "photo" as const, filename: f, mime: "image/jpeg", bytes: restampedPhoto(`framing/${f}`, new Date(t2.getTime() + i * 5_000)) })),
    { ...m1Files[0]!, filename: "IMG_2231.jpg" },
    doc("invoice", "invoice-lumber.txt", ["BROOKLYN LUMBER & SUPPLY", "Invoice No: BLS-E2E", `Date: ${day}`, `Bill To: ${builder.name}`, `Deliver To: ${SITE.address}`, "Framing lumber package + trusses", `TOTAL: $${amount}.00`]),
  ];
  await call("9 M2 evidence (IMG_2231.jpg = reused M1 photo)", "POST", `${P}/milestones/${m2!.id}/evidence`, evidenceForm(m2Files), [200], (j) => `${j.evidence.length} files`);
  await call("10 M2 audit", "POST", `${P}/milestones/${m2!.id}/audit`, auditForm({ inspector, evidenceBundleHash: bundle(m2Files), checklist: [{ sovCode: "framing", status: "done" }], notes: "Walls framed; sheathing started." }), [200], (j) => j.milestone.status);
  const r2 = await call("11 M2 run checks (fraud)", "POST", `${P}/milestones/${m2!.id}/run-checks`, undefined, [200], (j) => `${j.verdict.decision}: ${j.verdict.checks.filter((c: any) => c.result === "fail").map((c: any) => c.check).join(", ")}${j.release ? " -> RELEASED (bug)" : ", no release"}`);
  if (r2.verdict.decision !== "fail" || r2.release || !r2.verdict.checks.some((c: any) => c.check === "no_duplicate_photo" && c.result === "fail"))
    throw new Error(`M2 expected fail on no_duplicate_photo, no release: ${JSON.stringify(r2.verdict.checks)}`);

  // 23 + 15 + 2
  await call("23 try-steal M2 (platform, random fulfillment)", "POST", `/api/admin/demo/try-steal/${project.id}/${m2!.id}`, undefined, [200], (j) => j.result);
  await call("15 withdraw before RedemptionDate", "POST", `${P}/withdrawals`, { investor: inv1!.address, amount: "1" }, [409]);
  await call<ProjectDetail>("2 project detail", "GET", P, undefined, [200], (j) => `${j.project.status}: ${j.project.milestones.map((m: any) => `${m.templateKey}=${m.status}`).join(", ")}`);

  // M3: no evidence -> CancelAfter passes -> EscrowCancel + refund LoanPay
  await call("13 cancel M3 before CancelAfter", "POST", `${P}/milestones/${m3!.id}/cancel`, undefined, [409]);
  await o.waitUntil(new Date(Date.parse(m3!.cancelAfter!) + 2_000), "M3 CancelAfter");
  let cancelled = false;
  for (let attempt = 1; !cancelled; attempt++) {
    const r = await fetch(`${o.base}${P}/milestones/${m3!.id}/cancel`, { method: "POST" });
    const j = (await r.json()) as any;
    if (r.status === 409 && j?.error?.code === "too_soon" && attempt < 12) {
      log(`     cancel: ledger not past CancelAfter yet (attempt ${attempt}), retrying in 5 s`);
      await o.waitUntil(new Date(o.now().getTime() + 5_000), "ledger close time");
      continue;
    }
    const row: Row = { step: "13 cancel M3 after CancelAfter (EscrowCancel + refund LoanPay)", status: r.status, outcome: r.ok ? j.milestone.status : `${j?.error?.code}: ${j?.error?.message}`, links: linksOf(j) };
    rows.push(row);
    log(`${r.status}  ${row.step}: ${row.outcome}\n       ${row.links.join("\n       ")}`);
    if (!r.ok) throw new Error(`cancel M3: ${JSON.stringify(j)}`);
    cancelled = true;
  }

  const final = await call<ProjectDetail>("2 project detail (final)", "GET", P, undefined, [200], (j) => `${j.project.status}: ${j.project.milestones.map((m: any) => `${m.templateKey}=${m.status}`).join(", ")}`);
  const events = await call<ChainEvent[]>("16 events", "GET", `${P}/events`, undefined, [200], (j) => `${j.length} events: ${[...new Set(j.map((e: any) => e.kind))].join(", ")}`);
  rows.at(-1)!.links = [];
  const statuses = Object.fromEntries(final.project.milestones.map((m) => [m.templateKey, m.status]));
  if (statuses.foundation !== "released" || statuses.framing !== "failed" || statuses.dry_in !== "refunded") throw new Error(`final milestone states ${JSON.stringify(statuses)}`);
  if (!events.some((e) => e.kind === "release_refused" && e.result === "tecCRYPTOCONDITION_ERROR")) throw new Error("no release_refused tecCRYPTOCONDITION_ERROR event");
  return rows;
}

export function markdownTable(rows: Row[]): string {
  const short = (u: string) => `[${u.split("/").pop()!.slice(0, 8)}…](${u})`;
  return ["| step | HTTP | result | txs |", "|---|---|---|---|", ...rows.map((r) => `| ${r.step} | ${r.status} | ${r.outcome.replace(/\|/g, "\\|")} | ${r.links.map(short).join(" ") || "—"} |`)].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { loadDevnetIdentities } = await import("../src/adapters/devnet-identities.ts");
  const { devnetConfigFromEnv } = await import("../src/factory.ts");
  const { walletsFile } = devnetConfigFromEnv(process.env);
  const ids = loadDevnetIdentities(walletsFile);
  const base = (process.env.CORE_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const rows = await runDevnetFlow({
    base,
    ids,
    now: () => new Date(),
    waitUntil: async (t, why) => {
      const ms = t.getTime() - Date.now();
      if (ms > 0) {
        console.log(`     waiting ${Math.ceil(ms / 1000)} s for ${why} (${t.toISOString()})`);
        await sleep(ms);
      }
    },
    ...(process.env.E2E_SUBSCRIPTION_S ? { subscriptionS: Number(process.env.E2E_SUBSCRIPTION_S) } : {}),
    log: (l) => console.log(l),
  });
  const out = process.env.E2E_OUT ?? join(process.env.DATA_DIR ?? ".data", "core05-e2e.json");
  writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`\n${markdownTable(rows)}\n\nrows -> ${out}`);
}
