import type { CheckOutcome, LoadedEvidence } from "./types.ts";
import { centsToString, fmtMoney, listJoin, toCents } from "./util.ts";

const DET = "deterministic" as const;
const SURE = 0.99;
const SOFT = 0.6;
const INVOICE_NO = /invoice\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i;
const WAIVER_AMOUNT = /^\s*(?:waiver\s+)?amount\s*[:=]?\s*(?:RLUSD|USD|\$)?\s*([\d,]+(?:\.\d{1,6})?)/im;
const INVOICE_TOTAL = /^\s*(?:grand\s+)?total\s*[:=]?\s*(?:RLUSD|USD|\$)?\s*([\d,]+(?:\.\d{1,6})?)/im;
const CLAIMANT = /^\s*(?:claimant|payee)\s*:\s*(.+?)\s*$/im;
const VENDOR = /^\s*(?:vendor|supplier|contractor)\s*:\s*(.+?)\s*$/im;

type WaiverType = "conditional" | "unconditional";

interface ParsedInvoice {
  item: LoadedEvidence;
  number?: string;
  amount?: string;
  vendor?: string;
}

interface ParsedWaiver {
  item: LoadedEvidence;
  type?: WaiverType;
  invoiceNumber?: string;
  amount?: string;
  claimant?: string;
}

function outcome(
  check: string,
  result: CheckOutcome["result"],
  reason: string,
  evidenceIds: string[] = [],
): CheckOutcome {
  return { check, result, reason, evidenceIds: [...new Set(evidenceIds)], confidence: result === "warn" ? SOFT : SURE, source: DET };
}

const filename = (item: LoadedEvidence) => item.evidence.filename;
const key = (value: string | undefined) => value?.trim().toUpperCase();
const partyKey = (value: string | undefined) => value
  ?.normalize("NFKC")
  .toUpperCase()
  .replace(/&/g, " AND ")
  .replace(/[^A-Z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

export function isLienWaiver(item: LoadedEvidence): boolean {
  return item.evidence.kind === "document"
    && (/lien[ _-]*waiver/i.test(item.evidence.filename) || /lien\s+waiver/i.test(item.text ?? ""));
}

function waiverType(text: string): WaiverType | undefined {
  if (/\bunconditional\s+lien\s+waiver\b/i.test(text)) return "unconditional";
  if (/\bconditional\s+lien\s+waiver\b/i.test(text)) return "conditional";
  return undefined;
}

function firstInvoiceHeaderLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/).map((part) => part.trim()).filter(Boolean)) {
    if (/^invoice(?:\s|$)/i.test(line) || /^(?:date|bill to|customer|job site|invoice no|total)\s*:/i.test(line)) continue;
    return line;
  }
  return undefined;
}

function parseInvoice(item: LoadedEvidence): ParsedInvoice {
  const text = item.text ?? "";
  return {
    item,
    number: key(INVOICE_NO.exec(text)?.[1]),
    amount: item.meta.invoiceTotal ?? INVOICE_TOTAL.exec(text)?.[1]?.replace(/,/g, ""),
    vendor: VENDOR.exec(text)?.[1]?.trim() ?? firstInvoiceHeaderLine(text),
  };
}

function parseWaiver(item: LoadedEvidence): ParsedWaiver {
  const text = item.text ?? "";
  return {
    item,
    type: waiverType(text),
    invoiceNumber: key(INVOICE_NO.exec(text)?.[1]),
    amount: WAIVER_AMOUNT.exec(text)?.[1]?.replace(/,/g, ""),
    claimant: CLAIMANT.exec(text)?.[1]?.trim(),
  };
}

function requirements(
  currentItems: LoadedEvidence[],
  previousItems: LoadedEvidence[],
): Array<{ invoice: ParsedInvoice; type: WaiverType; label: string }> {
  return [
    ...currentItems.filter((item) => item.evidence.kind === "invoice").map((item) => ({
      invoice: parseInvoice(item), type: "conditional" as const, label: "current draw",
    })),
    ...previousItems.filter((item) => item.evidence.kind === "invoice").map((item) => ({
      invoice: parseInvoice(item), type: "unconditional" as const, label: "previous draw",
    })),
  ];
}

/**
 * Requires a conditional waiver for every invoice in this draw and, after the first draw,
 * an unconditional waiver for every invoice in the immediately preceding draw.
 */
export function checkLienWaiverPresent(
  currentItems: LoadedEvidence[],
  previousItems: LoadedEvidence[] = [],
  options: { previousRequired?: boolean } = {},
): CheckOutcome {
  const check = "lien_waiver_present";
  const required = requirements(currentItems, previousItems);
  const waivers = currentItems.filter(isLienWaiver).map(parseWaiver);
  if (!required.some(({ type }) => type === "conditional")) {
    return outcome(check, "skipped", "No current-draw invoices were submitted, so waiver presence cannot be evaluated.");
  }
  if (options.previousRequired && !required.some(({ type }) => type === "unconditional")) {
    return outcome(check, "skipped", "Previous-draw invoice evidence is unavailable, so unconditional waiver presence cannot be evaluated.");
  }

  const missing: string[] = [];
  const ids: string[] = [];
  for (const requirement of required) {
    const invoiceNo = requirement.invoice.number;
    if (!invoiceNo) {
      missing.push(`${filename(requirement.invoice.item)} has no readable invoice number`);
      ids.push(requirement.invoice.item.evidence.id);
      continue;
    }
    const matches = waivers.filter((waiver) => waiver.type === requirement.type && waiver.invoiceNumber === invoiceNo);
    if (!matches.length) {
      missing.push(`missing ${requirement.type} lien waiver for ${requirement.label} invoice ${invoiceNo}`);
      ids.push(requirement.invoice.item.evidence.id);
    }
  }
  if (missing.length) return outcome(check, "fail", `${listJoin(missing)}.`, ids);
  return outcome(check, "pass", `All ${required.length} required lien waiver(s) are present with the correct conditional/unconditional type.`, waivers.map(({ item }) => item.evidence.id));
}

function exactCents(amount: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("Amount is not an exact cent value.");
  return toCents(amount);
}

/** Exact, integer-cent reconciliation of each waiver to its invoice and invoice vendor. */
export function checkLienWaivers(
  currentItems: LoadedEvidence[],
  previousItems: LoadedEvidence[] = [],
): CheckOutcome {
  const check = "lien_waiver_matches_invoices";
  const waivers = currentItems.filter(isLienWaiver).map(parseWaiver);
  if (!waivers.length) return outcome(check, "skipped", "No lien waivers were submitted; the separate presence check reports omissions.");
  const required = requirements(currentItems, previousItems);
  const invoiceByKey = new Map(required
    .filter(({ invoice }) => invoice.number)
    .map((requirement) => [`${requirement.type}:${requirement.invoice.number}`, requirement]));

  const fails: string[] = [];
  const warns: string[] = [];
  const ids: string[] = [];
  let matched = 0;
  for (const waiver of waivers) {
    if (!waiver.type || !waiver.invoiceNumber || !waiver.amount || !waiver.claimant) {
      warns.push(`${filename(waiver.item)}: could not read waiver type, invoice number, amount, and claimant`);
      ids.push(waiver.item.evidence.id);
      continue;
    }
    const requirement = invoiceByKey.get(`${waiver.type}:${waiver.invoiceNumber}`);
    if (!requirement) {
      fails.push(`${filename(waiver.item)} is a ${waiver.type} waiver for invoice ${waiver.invoiceNumber}, but no matching ${waiver.type === "conditional" ? "current" : "previous"}-draw invoice was supplied`);
      ids.push(waiver.item.evidence.id);
      continue;
    }
    const invoice = requirement.invoice;
    if (!invoice.amount || !invoice.vendor) {
      warns.push(`${filename(invoice.item)}: could not read invoice total and vendor`);
      ids.push(waiver.item.evidence.id, invoice.item.evidence.id);
      continue;
    }
    let waiverCents: bigint;
    let invoiceCents: bigint;
    try {
      waiverCents = exactCents(waiver.amount);
      invoiceCents = exactCents(invoice.amount);
    } catch {
      warns.push(`${filename(waiver.item)} or ${filename(invoice.item)} has an unreadable monetary amount`);
      ids.push(waiver.item.evidence.id, invoice.item.evidence.id);
      continue;
    }
    if (waiverCents !== invoiceCents) {
      fails.push(`${filename(waiver.item)} waives ${fmtMoney(centsToString(waiverCents))} but invoice ${waiver.invoiceNumber} is ${fmtMoney(centsToString(invoiceCents))}`);
      ids.push(waiver.item.evidence.id, invoice.item.evidence.id);
    }
    if (partyKey(waiver.claimant) !== partyKey(invoice.vendor)) {
      fails.push(`${filename(waiver.item)} claimant "${waiver.claimant}" does not match invoice ${waiver.invoiceNumber} vendor "${invoice.vendor}"`);
      ids.push(waiver.item.evidence.id, invoice.item.evidence.id);
    }
    matched += 1;
  }
  if (fails.length) return outcome(check, "fail", `${listJoin(fails)}.`, ids);
  if (warns.length) return outcome(check, "warn", `${listJoin(warns)}; operator reconciliation required.`, ids);
  return outcome(check, "pass", `${matched} lien waiver(s) exactly match invoice type, number, amount, and vendor.`, waivers.map(({ item }) => item.evidence.id));
}
