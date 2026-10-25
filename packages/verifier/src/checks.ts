// Deterministic checks. Pure functions over loaded evidence + policy -> CheckOutcome.
// These decide hard fails; the LLM only adds judgments on top.
import type { MilestoneTemplate } from "@xrlp/shared";
import { hammingDistance } from "./meta.ts";
import type { VerificationPolicy } from "./policy.ts";
import type { CheckOutcome, LoadedEvidence, MilestoneContext, MilestoneTimeline, PriorEvidence } from "./types.ts";
import { DAY_MS, centsToString, fmtDate, fmtDistance, fmtMoney, haversineM, listJoin, pct, toCents } from "./util.ts";

const DET = "deterministic" as const;
const SURE = 0.99; // deterministic pass/fail
const SOFT = 0.6; // deterministic warn (missing data rather than contradicting data)
const LAZY = "[catches lazy fraud only — EXIF is spoofable]";

const name = (l: LoadedEvidence) => l.evidence.filename;
const photosOf = (items: LoadedEvidence[]) => items.filter((l) => l.evidence.kind === "photo");

function outcome(
  check: string,
  result: CheckOutcome["result"],
  reason: string,
  evidenceIds: string[] = [],
  confidence = result === "warn" ? SOFT : SURE,
): CheckOutcome {
  return { check, result, reason, evidenceIds, confidence, source: DET };
}

// ---------------------------------------------------------------------------------------------
export function checkRequiredEvidence(
  template: MilestoneTemplate | undefined,
  items: LoadedEvidence[],
  templateKey: string,
): CheckOutcome {
  const c = "required_evidence_present";
  if (!template) return outcome(c, "fail", `Unknown milestone template "${templateKey}" — cannot know what "done" means.`);
  const unreadable = items.filter((l) => l.loadError);
  const usable = items.filter((l) => !l.loadError);
  const missing: string[] = [];
  for (const req of template.requiredEvidence) {
    const have = usable.filter((l) => l.evidence.kind === req.kind).length;
    if (have < req.minCount) missing.push(`${req.kind} ${have}/${req.minCount} (${req.description})`);
  }
  if (missing.length) {
    const extra = unreadable.length ? ` ${unreadable.length} file(s) could not be loaded.` : "";
    return outcome(c, "fail", `Missing required evidence for "${template.title}": ${missing.join("; ")}.${extra}`,
      unreadable.map((l) => l.evidence.id));
  }
  const summary = template.requiredEvidence.map((r) => `${usable.filter((l) => l.evidence.kind === r.kind).length} ${r.kind}`);
  return outcome(c, "pass", `All required evidence for "${template.title}" present (${summary.join(", ")}).`);
}

// ---------------------------------------------------------------------------------------------
export function checkGpsWithinSite(ctx: MilestoneContext, items: LoadedEvidence[], policy: VerificationPolicy): CheckOutcome {
  const c = "gps_within_site";
  const photos = photosOf(items);
  if (!photos.length) return outcome(c, "skipped", "No photos submitted.");
  const site = ctx.project.siteGeo;
  const allowed = site.radiusM + policy.thresholds.gpsSlackM;
  const outside: string[] = [];
  const outsideIds: string[] = [];
  const noGps: LoadedEvidence[] = [];
  let maxInside = 0;
  for (const p of photos) {
    const gps = p.meta.gps;
    if (!gps) {
      noGps.push(p);
      continue;
    }
    const d = haversineM(gps, site);
    if (d > allowed) {
      outside.push(`${name(p)} is ${fmtDistance(d)} from the site`);
      outsideIds.push(p.evidence.id);
    } else maxInside = Math.max(maxInside, d);
  }
  if (outside.length) {
    return outcome(c, "fail",
      `${listJoin(outside)} (allowed: ${site.radiusM} m radius + ${policy.thresholds.gpsSlackM} m slack). ${LAZY}`, outsideIds);
  }
  const coverage = (photos.length - noGps.length) / photos.length;
  if (coverage < policy.thresholds.minGpsCoverage) {
    return outcome(c, "warn",
      `${noGps.length} of ${photos.length} photos have no GPS (need ≥${Math.round(policy.thresholds.minGpsCoverage * 100)}% with GPS). ${LAZY}`,
      noGps.map((p) => p.evidence.id));
  }
  return outcome(c, "pass",
    `${photos.length - noGps.length}/${photos.length} photos geotagged within ${fmtDistance(maxInside)} of the site (radius ${site.radiusM} m). ${LAZY}`);
}

// ---------------------------------------------------------------------------------------------
export function checkPhotoFresh(items: LoadedEvidence[], timeline: MilestoneTimeline, policy: VerificationPolicy): CheckOutcome {
  const c = "photo_fresh";
  const photos = photosOf(items);
  if (!photos.length) return outcome(c, "skipped", "No photos submitted.");
  const now = timeline.now ? Date.parse(timeline.now) : Date.now();
  const bounds = [
    timeline.escrowCreatedAt ? { t: Date.parse(timeline.escrowCreatedAt), label: "escrow creation" } : null,
    timeline.previousMilestoneApprovedAt
      ? { t: Date.parse(timeline.previousMilestoneApprovedAt), label: "previous milestone approval" }
      : null,
  ].filter((b): b is { t: number; label: string } => b !== null && Number.isFinite(b.t));
  const notBefore = bounds.reduce<{ t: number; label: string } | null>((a, b) => (!a || b.t > a.t ? b : a), null);
  const ageLimit = now - policy.thresholds.maxPhotoAgeDays * DAY_MS;
  const futureLimit = now + policy.thresholds.futureSkewMinutes * 60_000;

  const problems: string[] = [];
  const badIds: string[] = [];
  const missing: LoadedEvidence[] = [];
  for (const p of photos) {
    const iso = p.meta.takenAt;
    if (!iso) {
      missing.push(p);
      continue;
    }
    const t = Date.parse(iso);
    if (notBefore && t < notBefore.t) {
      problems.push(`${name(p)} taken ${fmtDate(iso)}, before ${notBefore.label} (${fmtDate(new Date(notBefore.t).toISOString())})`);
      badIds.push(p.evidence.id);
    } else if (t > futureLimit) {
      problems.push(`${name(p)} has a capture date in the future (${fmtDate(iso)})`);
      badIds.push(p.evidence.id);
    } else if (t < ageLimit) {
      problems.push(`${name(p)} is older than ${policy.thresholds.maxPhotoAgeDays} days (${fmtDate(iso)})`);
      badIds.push(p.evidence.id);
    }
  }
  if (problems.length) return outcome(c, "fail", `${listJoin(problems)}. ${LAZY}`, badIds);
  if (missing.length) {
    return outcome(c, "warn", `${missing.length} of ${photos.length} photos have no EXIF capture time (stripped or screenshot?). ${LAZY}`,
      missing.map((p) => p.evidence.id));
  }
  const ref = notBefore ? `after ${notBefore.label}` : "no escrow timestamp supplied, checked age/future only";
  return outcome(c, "pass", `All ${photos.length} photos taken ${ref} and within ${policy.thresholds.maxPhotoAgeDays} days. ${LAZY}`);
}

// ---------------------------------------------------------------------------------------------
/**
 * The strongest check we have: cross-project reuse. Compares every submitted photo against
 * (a) every other photo in this submission and (b) all prior evidence on the platform, by exact
 * sha256 AND perceptual hash (survives re-compression, resize, small crops, brightness tweaks).
 * Prior evidence from the SAME project+milestone is ignored (a resubmission after rejection).
 */
export function checkNoDuplicatePhoto(
  ctx: MilestoneContext,
  items: LoadedEvidence[],
  prior: PriorEvidence[],
  policy: VerificationPolicy,
): CheckOutcome {
  const c = "no_duplicate_photo";
  const photos = photosOf(items).filter((p) => p.sha256 || p.meta.perceptualHash);
  if (!photos.length) return outcome(c, "skipped", "No readable photos submitted.");
  const { phashFailDistance: failD, phashWarnDistance: warnD } = policy.thresholds;
  const others = prior.filter((p) => !(p.projectId === ctx.project.id && p.milestoneId === ctx.milestone.id));

  const fails: string[] = [];
  const warns: string[] = [];
  const failIds = new Set<string>();
  const warnIds = new Set<string>();
  const validHash = (hash: string | undefined): hash is string => !!hash && /^[0-9a-f]{16}$/i.test(hash);
  for (const old of others.filter((p) => p.evidence.kind === "photo" && p.evidence.meta?.perceptualHash && !validHash(p.evidence.meta.perceptualHash))) {
    warns.push(`Prior photo ${old.evidence.filename} has an invalid perceptual hash; reprocessing required`);
  }
  const where = (p: PriorEvidence) =>
    p.projectId === "unknown"
      ? "previously submitted evidence"
      : p.projectId === ctx.project.id
      ? `this project's milestone "${p.milestoneId}"`
      : `another project (${p.projectName ?? p.projectId}, milestone "${p.milestoneId}")`;

  for (const [i, p] of photos.entries()) {
    // within this submission (padding the photo count with copies)
    for (const q of photos.slice(i + 1)) {
      if (p.sha256 && p.sha256 === q.sha256) {
        fails.push(`${name(p)} and ${name(q)} are the same file`);
        failIds.add(p.evidence.id).add(q.evidence.id);
      } else if (p.meta.perceptualHash && q.meta.perceptualHash) {
        const d = hammingDistance(p.meta.perceptualHash, q.meta.perceptualHash);
        if (d <= failD) {
          fails.push(`${name(p)} and ${name(q)} are the same image (perceptual distance ${d}/64)`);
          failIds.add(p.evidence.id).add(q.evidence.id);
        }
      }
    }
    // against everything else on the platform
    for (const o of others) {
      if (o.evidence.kind !== "photo" && o.evidence.sha256 !== p.sha256) continue;
      if (p.sha256 && o.evidence.sha256 === p.sha256) {
        fails.push(`${name(p)} is byte-identical to ${o.evidence.filename} from ${where(o)}`);
        failIds.add(p.evidence.id);
        continue;
      }
      const oh = o.evidence.meta?.perceptualHash;
      if (!validHash(oh) || !validHash(p.meta.perceptualHash)) continue;
      const d = hammingDistance(p.meta.perceptualHash, oh);
      if (d <= failD) {
        fails.push(`${name(p)} is a re-used copy of ${o.evidence.filename} from ${where(o)} (perceptual distance ${d}/64)`);
        failIds.add(p.evidence.id);
      } else if (d <= warnD) {
        warns.push(`${name(p)} closely resembles ${o.evidence.filename} from ${where(o)} (distance ${d}/64)`);
        warnIds.add(p.evidence.id);
      }
    }
  }
  if (fails.length) return outcome(c, "fail", `${listJoin(dedupe(fails))}.`, [...failIds]);
  if (warns.length) return outcome(c, "warn", `${listJoin(dedupe(warns))}.`, [...warnIds], 0.7);
  return outcome(c, "pass",
    `${photos.length} photos are original: no exact or near-duplicate match among ${others.length} prior evidence files across all projects.`);
}

const dedupe = (xs: string[]) => [...new Set(xs)];

// ---------------------------------------------------------------------------------------------
/** Invoice total for one item: deterministic parse, else an LLM-extracted total (live mode). */
export type InvoiceTotals = Record<string, string | undefined>;

export function checkInvoiceMatchesBudget(
  ctx: MilestoneContext,
  items: LoadedEvidence[],
  policy: VerificationPolicy,
  llmTotals: InvoiceTotals = {},
): CheckOutcome {
  const c = "invoice_matches_budget";
  const invoices = items.filter((l) => l.evidence.kind === "invoice");
  const requiresInvoice = ctx.template?.requiredEvidence.some((r) => r.kind === "invoice") ?? false;
  if (!invoices.length) {
    return requiresInvoice
      ? outcome(c, "fail", "Template requires invoices but none were submitted.")
      : outcome(c, "skipped", "No invoices required for this milestone.");
  }
  const unread: LoadedEvidence[] = [];
  let total = 0n;
  const parts: string[] = [];
  let modelExtracted = false;
  for (const inv of invoices) {
    const t = inv.meta.invoiceTotal ?? llmTotals[inv.evidence.id];
    if (!inv.meta.invoiceTotal && llmTotals[inv.evidence.id]) modelExtracted = true;
    if (!t) {
      unread.push(inv);
      continue;
    }
    try { total += toCents(t); } catch { unread.push(inv); continue; }
    parts.push(`${name(inv)} ${fmtMoney(t)}`);
  }
  if (unread.length) {
    return outcome(c, "warn", `Could not read a total from ${listJoin(unread.map(name))}; a human must reconcile the invoices.`,
      unread.map((l) => l.evidence.id));
  }
  const draw = toCents(ctx.milestone.amount);
  if (draw <= 0n) return outcome(c, "fail", "Draw must be positive before reconciling invoices.");
  const ratio = pct(total, draw);
  const { invoiceUnderTolerancePct: under, invoiceOverTolerancePct: over, invoiceWarnTolerancePct: warn } = policy.thresholds;
  const ids = invoices.map((l) => l.evidence.id);
  const head = `Invoices total ${fmtMoney(centsToString(total))} vs draw ${fmtMoney(ctx.milestone.amount)} (${ratio}%)${modelExtracted ? " [includes LLM-extracted totals]" : ""}`;
  const difference = total >= draw ? total - draw : draw - total;
  if (difference * 100n > draw * BigInt(warn)) {
    return outcome(c, "fail",
      `${head}: absolute mismatch exceeds ${warn}%; ${total < draw ? "shortfall" : "overrun"} ${fmtMoney(difference)}. [${parts.join("; ")}]`, ids);
  }
  if ((total < draw && difference * 100n > draw * BigInt(under)) || (total > draw && difference * 100n > draw * BigInt(over))) {
    return outcome(c, "warn", `${head}: outside the pass band (−${under}% / +${over}%) but within ${warn}%; reconcile before release.`, ids, 0.8);
  }
  return outcome(c, "pass", `${head}: within tolerance (−${under}% / +${over}%).`, ids);
}

// ---------------------------------------------------------------------------------------------
// Lien waivers: the strongest paper trail in construction lending (a supplier waiving lien rights
// confirms they were actually paid). STUB: shared EvidenceKind has no "lien_waiver" yet, so we
// detect them as documents by filename/text, and parse "Invoice No" + "Amount" lines.
// TODO: add EvidenceKind "lien_waiver" + template requirements in @xrlp/shared; LLM extraction for PDFs.
const INVOICE_NO = /invoice\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i;
const AMOUNT = /^\s*(?:waiver\s+)?amount\s*[:=]?\s*(?:RLUSD|USD|\$)?\s*([\d,]+(?:\.\d{1,2})?)/im;

export function isLienWaiver(l: LoadedEvidence): boolean {
  return l.evidence.kind === "document" && (/lien/i.test(l.evidence.filename) || /lien\s+waiver/i.test(l.text ?? ""));
}

export function checkLienWaivers(items: LoadedEvidence[]): CheckOutcome {
  const c = "lien_waiver_matches_invoices";
  const waivers = items.filter(isLienWaiver);
  if (!waivers.length) return outcome(c, "skipped", "No lien waivers submitted (not yet required by templates).");
  const invoices = items.filter((l) => l.evidence.kind === "invoice");
  const invByNo = new Map<string, LoadedEvidence>();
  for (const inv of invoices) {
    const no = INVOICE_NO.exec(inv.text ?? "")?.[1];
    if (no) invByNo.set(no.toUpperCase(), inv);
  }
  const fails: string[] = [];
  const warns: string[] = [];
  const ids: string[] = [];
  const matched = new Set<string>();
  for (const w of waivers) {
    const no = INVOICE_NO.exec(w.text ?? "")?.[1]?.toUpperCase();
    const amt = AMOUNT.exec(w.text ?? "")?.[1];
    const inv = no ? invByNo.get(no) : undefined;
    if (!no || !amt) {
      warns.push(`${name(w)}: could not read invoice number/amount`);
      ids.push(w.evidence.id);
    } else if (!inv) {
      warns.push(`${name(w)} references invoice ${no}, which was not submitted`);
      ids.push(w.evidence.id);
    } else {
      matched.add(inv.evidence.id);
      const invTotal = inv.meta.invoiceTotal;
      if (invTotal && toCents(invTotal) !== toCents(amt)) {
        fails.push(`${name(w)} waives ${fmtMoney(centsToString(toCents(amt)))} but invoice ${no} is ${fmtMoney(invTotal)}`);
        ids.push(w.evidence.id, inv.evidence.id);
      }
    }
  }
  const unwaived = invoices.filter((i) => !matched.has(i.evidence.id));
  if (fails.length) return outcome(c, "fail", `${listJoin(fails)}.`, ids);
  if (warns.length || unwaived.length) {
    const msg = [...warns, ...(unwaived.length ? [`no lien waiver for ${listJoin(unwaived.map(name))}`] : [])];
    return outcome(c, "warn", `${listJoin(msg)}.`, [...ids, ...unwaived.map((i) => i.evidence.id)]);
  }
  return outcome(c, "pass", `${waivers.length} lien waiver(s) match their invoices exactly.`, waivers.map((w) => w.evidence.id));
}
