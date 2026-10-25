// INS-06: pre-construction site visit. When project verification escalates (`needs_human`), the AI assigns an inspector and
// route 18 lists the project with `needs: "pre_visit"`. The inspector confirms the site and files a signed report.
//
// TODO(#53): NONE OF THIS IS AN AGREED CONTRACT YET. It implements the area:inspector proposal on #53
// (issuecomment-6393157347): a project-level report, its own submission route, its own attestation memo. Until core adopts
// (or changes) it, only mock mode works; http mode posts to the proposed route and core answers 404.
//   - Report type   InspectorSiteVisit (below)           — proposed for @xrlp/shared
//   - Route         POST /api/projects/:id/site-visit     — multipart `report` (JSON), `photos` (repeated), optional `signedTxBlob`
//   - Attestation   1-drop Payment inspector -> PLATFORM (the project SPV does not exist before lock-terms), one memo
//                   MemoType `xrlp/attest/v1`, data {v:1, kind:"site_visit", projectId, hash: siteVisitHash(report)}
//                   (`site_visit` is not an XRPL-08 kind yet, so this is built here, not in @xrlp/attest-signer)
//   - Chain event   none in the contract yet (needs e.g. `site_visit_attested`)
import { canonicalJson, sha256Hex, type SoftwareSigner } from "@xrlp/attest-signer";
import { Client, convertHexToString, convertStringToHex, type Payment, type Transaction } from "xrpl";
import { z } from "zod";
import { Evidence, XrplAddress } from "./types.ts";

export const SITE_VISIT_QUESTIONS = [
  { key: "siteExists", label: "The site exists at the stated address", hint: "Lot, street number and boundaries match the project record." },
  { key: "siteAccessible", label: "The site is accessible for construction", hint: "Vehicle and equipment access, no blocking easements or hazards." },
  { key: "plansMatchSite", label: "The plans match the site", hint: "Footprint, setbacks, grade and existing structures agree with the permit set." },
] as const;
export type SiteVisitQuestion = (typeof SITE_VISIT_QUESTIONS)[number]["key"];

export const SiteVisitAnswer = z.enum(["yes", "no", "unable_to_confirm"]);
export type SiteVisitAnswer = z.infer<typeof SiteVisitAnswer>;

const AnswerEntry = z.object({ answer: SiteVisitAnswer, note: z.string().optional() });

/** Proposed `@xrlp/shared` type (TODO(#53)). Site observations only; never a milestone audit. */
export const InspectorSiteVisit = z.object({
  projectId: z.string(),
  inspector: XrplAddress,
  answers: z.object({ siteExists: AnswerEntry, siteAccessible: AnswerEntry, plansMatchSite: AnswerEntry }),
  photos: z.array(Evidence),
  notes: z.string(),
  txHash: z.string().optional(),
  at: z.string().datetime(),
});
export type InspectorSiteVisit = z.infer<typeof InspectorSiteVisit>;

export const SubmitSiteVisitResult = z.object({ visit: InspectorSiteVisit });
export type SubmitSiteVisitResult = z.infer<typeof SubmitSiteVisitResult>;

export const SITE_VISIT_MEMO_KIND = "site_visit";
const MEMO_TYPE = "xrlp/attest/v1";

// ---------------------------------------------------------------- the form

export type SiteVisitDraft = {
  answers: Record<SiteVisitQuestion, { answer?: SiteVisitAnswer; note: string }>;
  photos: { file: Blob; evidence: Evidence }[];
  notes: string;
};

export const emptySiteVisitDraft = (): SiteVisitDraft => ({
  answers: { siteExists: { note: "" }, siteAccessible: { note: "" }, plansMatchSite: { note: "" } },
  photos: [],
  notes: "",
});

/** What blocks filing: every question answered; `no` / `unable_to_confirm` explained; at least one site photo. */
export function siteVisitProblems(draft: SiteVisitDraft): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  for (const q of SITE_VISIT_QUESTIONS) {
    const a = draft.answers[q.key];
    if (!a.answer) problems.push({ field: `answers.${q.key}`, message: `${q.label}: answer yes, no or unable to confirm` });
    else if (a.answer !== "yes" && !a.note.trim()) problems.push({ field: `answers.${q.key}`, message: `${q.label}: say why` });
  }
  if (draft.photos.length === 0) problems.push({ field: "photos", message: "Add at least one site photo" });
  return problems;
}

export function buildSiteVisit(projectId: string, inspector: string, draft: SiteVisitDraft, at: string): InspectorSiteVisit {
  const problems = siteVisitProblems(draft);
  if (problems.length) throw new Error(`Site visit incomplete: ${problems.map((p) => p.message).join("; ")}`);
  const entry = (k: SiteVisitQuestion) => {
    const { answer, note } = draft.answers[k];
    return note.trim() ? { answer: answer!, note: note.trim() } : { answer: answer! };
  };
  return {
    projectId,
    inspector,
    answers: { siteExists: entry("siteExists"), siteAccessible: entry("siteAccessible"), plansMatchSite: entry("plansMatchSite") },
    photos: draft.photos.map((p) => p.evidence),
    notes: draft.notes.trim(),
    at,
  };
}

/** Overall reading for the UI: any `no` = site concern, any `unable_to_confirm` = unconfirmed, else confirmed. */
export function siteVisitOutcome(visit: Pick<InspectorSiteVisit, "answers">): "confirmed" | "concern" | "unconfirmed" {
  const answers = Object.values(visit.answers).map((a) => a.answer);
  return answers.includes("no") ? "concern" : answers.includes("unable_to_confirm") ? "unconfirmed" : "confirmed";
}

// ---------------------------------------------------------------- what the attestation commits to

/**
 * Canonical form (same rules as `auditHash`): what core would receive and keep — project, inspector, answers (notes trimmed,
 * dropped when empty), notes, sorted sha256 of the uploaded photo files — and nothing core assigns (`txHash`, `at`, photo ids).
 */
export function siteVisitHash(v: Pick<InspectorSiteVisit, "projectId" | "inspector" | "answers" | "notes"> & { photos: readonly { sha256: string }[] }) {
  const answers = Object.fromEntries(
    SITE_VISIT_QUESTIONS.map(({ key }) => {
      const a = v.answers[key];
      return [key, a.note?.trim() ? { answer: a.answer, note: a.note.trim() } : { answer: a.answer }];
    }),
  );
  return sha256Hex(
    canonicalJson({ v: 1, projectId: v.projectId, inspector: v.inspector, answers, notes: v.notes.trim(), photos: v.photos.map((p) => p.sha256.toLowerCase()).sort() }),
  );
}

export type SiteVisitMemo = { v: 1; kind: typeof SITE_VISIT_MEMO_KIND; projectId: string; hash: string };

export function buildSiteVisitTx(p: { account: string; platform: string; memo: SiteVisitMemo }): Payment {
  return {
    TransactionType: "Payment",
    Account: p.account,
    Destination: p.platform,
    Amount: "1",
    Memos: [
      {
        Memo: {
          MemoType: convertStringToHex(MEMO_TYPE),
          MemoFormat: convertStringToHex("application/json"),
          MemoData: convertStringToHex(JSON.stringify(p.memo)),
        },
      },
    ],
  };
}

export function parseSiteVisitTx(tx: Transaction): (SiteVisitMemo & { signer: string; destination?: string }) | null {
  for (const { Memo } of tx.Memos ?? []) {
    if (!Memo.MemoType || !Memo.MemoData) continue;
    try {
      if (convertHexToString(Memo.MemoType) !== MEMO_TYPE) continue;
      const m = JSON.parse(convertHexToString(Memo.MemoData)) as Partial<SiteVisitMemo>;
      if (m.v !== 1 || m.kind !== SITE_VISIT_MEMO_KIND || typeof m.projectId !== "string" || !/^[0-9a-f]{64}$/.test(m.hash ?? "")) return null;
      return { v: 1, kind: SITE_VISIT_MEMO_KIND, projectId: m.projectId, hash: m.hash!, signer: tx.Account, destination: tx.TransactionType === "Payment" ? tx.Destination : undefined };
    } catch {
      return null;
    }
  }
  return null;
}

export type SignedSiteVisit = { blob: string; txHash: string; memo: SiteVisitMemo };

/** Sign the site-visit attestation. `mode` follows the app: mock = fixed autofill (never submitted); http = autofill on devnet. */
export async function signSiteVisit(
  visit: InspectorSiteVisit,
  platform: string,
  signer: SoftwareSigner,
  mode: "mock" | "http",
  wsUrl = "wss://s.devnet.rippletest.net:51233",
): Promise<SignedSiteVisit> {
  const memo: SiteVisitMemo = { v: 1, kind: SITE_VISIT_MEMO_KIND, projectId: visit.projectId, hash: await siteVisitHash(visit) };
  const tx = buildSiteVisitTx({ account: visit.inspector, platform, memo });
  let filled: Payment;
  if (mode === "mock") filled = { ...tx, Fee: "12", Sequence: 1, LastLedgerSequence: 100_000_000 };
  else {
    const client = new Client(wsUrl);
    await client.connect();
    try {
      filled = await client.autofill({ ...tx, LastLedgerSequence: (await client.getLedgerIndex()) + 75 });
    } finally {
      await client.disconnect();
    }
  }
  const signed = await signer.signAttestation(filled);
  return { blob: signed.tx_blob, txHash: signed.hash, memo };
}
