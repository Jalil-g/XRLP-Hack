#!/usr/bin/env node
// PITCH-04 check for docs/submission/*.md.   node docs/submission/check-links.mjs [--devnet]
// 1. Every 64-hex hash must already be published somewhere else: a *.md on any origin branch, or a PR body. Missing → error.
// 2. Relative links, `packages/…`/`apps/…` paths, `*.ts` files and `name()` identifiers must exist on this branch, and no TODO(…)
//    may be left. Otherwise → warning (usually a PR that hasn't merged yet). Must be warning-free before submitting.
// 3. --devnet: every linked tx must be validated on devnet with the result in its link text (a code like `tecNO_AUTH`), else tesSUCCESS.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const xrplSrc = join(root, "packages/xrpl/src");
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return e.stdout ?? ""; // git grep exits 1 when nothing matches; gh may be missing
  }
};
const HASH = /\b[0-9A-F]{64}\b/g;
const errors = [];
const warnings = [];

const docs = readdirSync(here).filter((f) => f.endsWith(".md")).map((f) => ({ f, text: readFileSync(join(here, f), "utf8") }));
const links = docs.flatMap(({ f, text }) =>
  [...text.matchAll(/\[([^\]]+)\]\(https:\/\/devnet\.xrpl\.org\/transactions\/([^)\s]*)\)/g)].map((m) => ({ f, label: m[1], hash: m[2] })),
);
for (const l of links) if (!/^[0-9A-F]{64}$/.test(l.hash)) errors.push(`${l.f}: malformed hash in [${l.label}]: ${l.hash}`);
const hashes = new Set(docs.flatMap(({ text }) => text.match(HASH) ?? []));

// 1. Sources: markdown on every origin branch (and this checkout), minus our own files, plus every PR body.
const refs = run("git", ["for-each-ref", "--format=%(refname)", "refs/remotes/origin"]).split("\n").filter((r) => r && !r.endsWith("/HEAD"));
const grep = (...trees) => run("git", ["grep", "-h", "-I", "-E", "[0-9A-F]{64}", ...trees, "--", "*.md", ":(exclude)docs/submission"]);
const prBodies = run("gh", ["pr", "list", "--state", "all", "--limit", "1000", "--json", "body", "--jq", ".[].body"]);
if (!prBodies) warnings.push("gh unavailable or not logged in: PR bodies were not searched");
const corpus = new Set([grep(...refs), grep(), prBodies].flatMap((s) => s.match(HASH) ?? []));
for (const h of hashes) if (!corpus.has(h)) errors.push(`not in any source (*.md on origin/*, PR bodies): ${h}`);

// 2. Things the text points at, and placeholders still to fill.
const xrplCode = readdirSync(xrplSrc).map((f) => readFileSync(join(xrplSrc, f), "utf8")).join("\n");
for (const { f, text } of docs) {
  for (const [todo] of text.matchAll(/TODO\([^)]*\)/g)) warnings.push(`${f}: ${todo} still open`);
  for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)/g))
    if (!existsSync(resolve(here, m[1]))) warnings.push(`${f}: link target not on this branch: ${relative(root, resolve(here, m[1]))}`);
  for (const [, p] of text.matchAll(/`((?:packages|apps)\/[\w./-]+)`/g)) if (!existsSync(join(root, p))) warnings.push(`${f}: missing path ${p}`);
  if (f !== "xrpl-primitives.md") continue; // its Code column is relative to packages/xrpl/src
  for (const [, file] of text.matchAll(/`([\w-]+\.ts)`/g)) if (!existsSync(join(xrplSrc, file))) warnings.push(`${f}: missing packages/xrpl/src/${file}`);
  for (const [, id] of text.matchAll(/`(\w+)\(\)`/g)) if (!new RegExp(`\\b${id}\\b`).test(xrplCode)) warnings.push(`${f}: ${id}() not in packages/xrpl/src`);
}

// 3. Devnet results.
if (process.argv.includes("--devnet")) {
  const want = new Map();
  for (const l of links) {
    const w = l.label.match(/\bte[a-z][A-Z_]+\b/)?.[0] ?? "tesSUCCESS";
    if (want.has(l.hash) && want.get(l.hash) !== w) errors.push(`${l.hash} is linked as both ${want.get(l.hash)} and ${w}`);
    want.set(l.hash, w);
  }
  for (const [hash, w] of want) {
    const body = JSON.stringify({ method: "tx", params: [{ transaction: hash }] });
    const r = await fetch("https://s.devnet.rippletest.net:51234", { method: "POST", headers: { "content-type": "application/json" }, body })
      .then((res) => res.json())
      .then((j) => j.result ?? {}, (e) => ({ error: String(e) }));
    const got = r.meta?.TransactionResult ?? r.error ?? "?";
    const ok = r.validated === true && got === w;
    console.log(`${ok ? "ok  " : "FAIL"} ${hash} ${r.TransactionType ?? "-"} ${got}${ok ? "" : ` (want ${w}, validated=${r.validated})`}`);
    if (!ok) errors.push(`devnet: ${hash} is ${got}, want ${w}`);
  }
}

console.log(`${links.length} devnet links, ${hashes.size} distinct hashes; sources: ${refs.length} origin branches + PR bodies`);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
process.exit(errors.length ? 1 : 0);
