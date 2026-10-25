"use client";
import { AuditWorkspace } from "@/components/audit/workspace";
// INS-06: pre-construction site visit for a project whose verification the AI escalated. Mock-only until the contract on #53
// is agreed (see lib/site-visit.ts): in http mode core does not have the route yet and answers 404.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, CircleDashed, ExternalLink, X } from "lucide-react";
import { NoteField } from "@/components/audit/note-field";
import { PhotoPicker } from "@/components/audit/photo-picker";
import { SigningKey, SigningPanel } from "@/components/audit/signing-panel";
import { SiteMap } from "@/components/audit/site-map";
import { useIdentity } from "@/components/identity";
import { LoadingState } from "@/components/ui/loading-state";
import { ReviewDialog } from "@/components/ui/review-dialog";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, Facts, PageHeader, Properties, Section } from "@/components/ui/layout";
import { Proof } from "@/components/ui/proof";
import { Segmented, type Segment } from "@/components/ui/segmented";
import { StatusIcon } from "@/components/ui/status-icon";
import { api } from "@/lib/api";
import { taskAmount } from "@/lib/queue";
import { inspectorKey as loadInspectorKey, type InspectorKey } from "@/lib/signing";
import {
  SITE_VISIT_QUESTIONS,
  buildSiteVisit,
  emptySiteVisitDraft,
  signSiteVisit,
  siteVisitOutcome,
  siteVisitProblems,
  type InspectorSiteVisit,
  type SiteVisitAnswer,
  type SiteVisitDraft,
  type SiteVisitQuestion,
} from "@/lib/site-visit";
import type { InspectorTask } from "@/lib/types";
import { cn, explorerTxUrl, formatAmount, shortAddress, shortHash } from "@/lib/utils";

const ANSWERS: Segment<SiteVisitAnswer>[] = [
  { value: "yes", label: "Yes", Icon: Check, tone: "pass" },
  { value: "no", label: "No", Icon: X, tone: "fail" },
  { value: "unable_to_confirm", label: "Unable to confirm", Icon: CircleDashed, tone: "review" },
];
const ANSWER_LABEL: Record<SiteVisitAnswer, string> = { yes: "Yes", no: "No", unable_to_confirm: "Unable to confirm" };
const ANSWER_STATE: Record<SiteVisitAnswer, string> = { yes: "pass", no: "fail", unable_to_confirm: "warn" };
const BACK = { href: "/", label: "Queue" };

export default function SiteVisitPage() {
  const params = useParams();
  const raw = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const projectId = raw ? decodeURIComponent(raw) : "";
  const { inspector, status, error: identityError } = useIdentity();
  const [task, setTask] = useState<InspectorTask | null>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!inspector) return;
    let live = true;
    setTask(undefined);
    api
      .getQueue(inspector.address)
      .then((tasks) => live && setTask(tasks.find((t) => t.projectId === projectId && !t.milestone && t.needs === "pre_visit") ?? null))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [inspector, projectId]);

  const back = <PageHeader back={BACK} title="Site visit" />;
  if (status === "error") return <div className="space-y-8">{back}<p role="alert" className="text-small text-fail">Could not load inspector credentials: {identityError}</p></div>;
  if (error) return <div className="space-y-8">{back}<p role="alert" className="text-small text-fail">Could not load the queue: {error}</p></div>;
  if (!inspector || task === undefined) return <div className="space-y-8">{back}<LoadingState label="Loading your site visit assignment…" /></div>;
  if (task === null) {
    return <div className="space-y-8">{back}<Empty title="No site visit due" action={<Link href="/" className={buttonClass("secondary")}>Back to queue</Link>} /></div>;
  }
  return <SiteVisitForm key={inspector.address} task={task} inspector={inspector.address} inspectorName={inspector.name} />;
}

function SiteVisitForm({ task, inspector, inspectorName }: { task: InspectorTask; inspector: string; inspectorName: string }) {
  const [draft, setDraft] = useState<SiteVisitDraft>(emptySiteVisitDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const submitting = useRef(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "filing">("idle");
  const [submitError, setSubmitError] = useState<string>();
  const [filed, setFiled] = useState<{ visit: InspectorSiteVisit; signed: boolean }>();
  const [key, setKey] = useState<InspectorKey | null>();
  const [keyVersion, setKeyVersion] = useState(0);
  const target = api.siteVisitAttestationTarget();

  useEffect(() => {
    let live = true;
    void loadInspectorKey(inspector).then((k) => live && setKey(k));
    return () => {
      live = false;
    };
  }, [inspector, keyVersion]);

  useEffect(() => {
    if (filed) window.scrollTo({ top: 0 });
  }, [filed]);

  const problems = useMemo(() => siteVisitProblems(draft), [draft]);
  const pins = draft.photos.flatMap((p) => (p.evidence.meta.gps ? [{ id: p.evidence.sha256, label: p.evidence.filename, gps: p.evidence.meta.gps, who: "inspector" as const }] : []));
  const canSign = Boolean(key && target);

  const setAnswer = (k: SiteVisitQuestion, next: Partial<SiteVisitDraft["answers"][SiteVisitQuestion]>) =>
    setDraft((d) => ({ ...d, answers: { ...d.answers, [k]: { ...d.answers[k], ...next } } }));

  async function submit() {
    if (submitting.current || phase !== "idle" || !reviewing) return;
    setShowErrors(true);
    setSubmitError(undefined);
    if (problems.length) {
      document.getElementById(problems[0]!.field)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    submitting.current = true;
    try {
      const report = buildSiteVisit(task.projectId, inspector, draft, new Date().toISOString());
      let signedTxBlob: string | undefined;
      if (canSign) {
        setPhase("signing");
        signedTxBlob = (await signSiteVisit(report, target!, key!.signer, api.mode, process.env.NEXT_PUBLIC_XRPL_WS_URL)).blob;
      }
      setPhase("filing");
      const res = await api.submitSiteVisit({ projectId: task.projectId, report, photos: draft.photos.map((p) => p.file), signedTxBlob });
      setReviewing(false);
      setFiled({ visit: res.visit, signed: Boolean(signedTxBlob) });
    } catch (err) {
      setReviewing(false);
      const e = err as Error & { code?: string };
      setSubmitError(e.code === "not_found" && api.mode === "http" ? "Core does not support site visits yet (contract pending on #53)." : e.message);
    } finally {
      submitting.current = false;
      setPhase("idle");
    }
  }

  if (filed) {
    const outcome = siteVisitOutcome(filed.visit);
    return (
      <div className="mx-auto max-w-[520px] space-y-8 pt-2">
        <div>
          <CheckCircle2 className="size-10 text-pass" aria-hidden />
          <h1 className="mt-4 text-title">Site visit filed</h1>
        </div>
        <Properties
          items={[
            { label: "Project", value: task.projectName },
            {
              label: "Outcome",
              value: (
                <span className={cn("font-medium", outcome === "confirmed" ? "text-pass" : outcome === "concern" ? "text-fail" : "text-review")}>
                  {outcome === "confirmed" ? "Site confirmed" : outcome === "concern" ? "Concern raised" : "Not fully confirmed"}
                </span>
              ),
            },
            { label: "Signed by", value: filed.signed ? "Your key" : "Core" },
            ...(filed.visit.txHash && api.mode !== "mock"
              ? [{
                  label: "Attestation",
                  value: (
                    <a href={explorerTxUrl(filed.visit.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono underline">
                      {shortHash(filed.visit.txHash)} <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ),
                }]
              : []),
          ]}
        />
        <Link href="/" className={buttonClass("primary", "lg")}>
          Back to queue
        </Link>
      </div>
    );
  }

  const answered = SITE_VISIT_QUESTIONS.filter((q) => draft.answers[q.key].answer).length;
  return (
    <div className="space-y-10">
      <PageHeader
        back={BACK}
        title={<>{task.projectName} <span className="text-ink-3">Site visit</span></>}
        action={
          <Facts
            items={[
              { label: "Project", value: <>{formatAmount(taskAmount(task))} <span className="text-caption font-medium text-ink-2">RLUSD</span></> },
              { label: "Inspector", value: inspectorName },
            ]}
          />
        }
      />
      {api.mode === "http" && (
        <p role="note" className="rounded-control bg-info-bg px-4 py-3 text-small text-info">
          Core cannot accept site-visit reports yet.
        </p>
      )}

      <AuditWorkspace siteVisit>
        <div className="min-w-0 space-y-10">
          <Card id="answers">
            <CardHeader>
              <CardTitle>On site</CardTitle>
              <span className={cn("text-caption tabular", answered === SITE_VISIT_QUESTIONS.length ? "font-medium text-ink" : "text-ink-2")}>
                {answered} of {SITE_VISIT_QUESTIONS.length}
              </span>
            </CardHeader>
            <ol className="divide-y divide-line">
              {SITE_VISIT_QUESTIONS.map((q) => {
                const a = draft.answers[q.key];
                const missing = showErrors && (!a.answer || (a.answer !== "yes" && !a.note.trim()));
                return (
                  <li key={q.key} id={`answers.${q.key}`} className={cn("space-y-3 px-5 py-4", missing && "bg-fail-bg/60")}>
                    <div className="grid items-center gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <p className="min-w-0 text-body font-medium">{q.label}</p>
                      <Segmented label={q.label} options={ANSWERS} value={a.answer} onChange={(answer) => setAnswer(q.key, { answer })} className="w-full sm:w-auto" />
                    </div>
                    {a.answer && (
                      <NoteField
                        label={`${q.label} note`}
                        value={a.note}
                        onChange={(note) => setAnswer(q.key, { note })}
                        required={a.answer !== "yes"}
                        invalid={Boolean(missing && a.answer !== "yes")}
                        placeholder="What did you find?"
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>

          <Section id="review" title="Notes & review">
            <textarea
              aria-label="Site visit notes"
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={3}
              placeholder="Optional"
              className="block w-full rounded-control border border-line-2 bg-surface px-3 py-2.5 text-small placeholder:text-ink-3"
            />
          </Section>
        </div>

        <div className="min-w-0 space-y-10">
          <Section id="photos" title="Site photos" aside={draft.photos.length > 0 && <span className="tabular">{draft.photos.length}</span>}>
            <div className="space-y-6">
              <PhotoPicker photos={draft.photos} onChange={(photos) => setDraft((d) => ({ ...d, photos }))} site={task.siteGeo} invalid={showErrors && draft.photos.length === 0} />
              <SiteMap site={task.siteGeo} pins={pins} />
            </div>
          </Section>

          <div className="space-y-4 border-t border-line pt-6">
            {showErrors && problems.length > 0 && (
              <ul className="space-y-1 text-small text-fail">
                {problems.map((p) => (
                  <li key={p.field + p.message}>{p.message}</li>
                ))}
              </ul>
            )}
            {submitError && (
              <p role="alert" className="flex items-start gap-2 rounded-control bg-fail-bg px-4 py-3 text-small text-fail">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {submitError}
              </p>
            )}
            {key === null && target && <SigningPanel address={inspector} inspectorKey={key} onChange={() => setKeyVersion((v) => v + 1)} />}
            <ReviewDialog open={reviewing} title="Review site visit" busy={phase !== "idle"}
              confirmLabel={phase !== "idle" ? "Submitting…" : canSign ? "Sign and submit site visit" : "Submit site visit (core signs)"}
              onBack={() => setReviewing(false)} onConfirm={() => void submit()}>
              <Properties
                items={[
                  { label: "Project", value: task.projectName },
                  { label: "Inspector", value: inspectorName },
                  { label: "Site photos", value: <span className="tabular">{draft.photos.length}</span> },
                ]}
              />
              <ul aria-label="Answers" className="divide-y divide-line border-y border-line">
                {SITE_VISIT_QUESTIONS.map((q) => {
                  const a = draft.answers[q.key];
                  return (
                    <li key={q.key} className="py-2.5">
                      <div className="flex items-center gap-3">
                        {a.answer && <StatusIcon state={ANSWER_STATE[a.answer]} className="size-4" />}
                        <span className="min-w-0 flex-1">{q.label}</span>
                        <strong className="font-medium">{a.answer && ANSWER_LABEL[a.answer]}</strong>
                      </div>
                      {a.note && <p className="mt-1 pl-7 text-ink-2">{a.note}</p>}
                    </li>
                  );
                })}
              </ul>
              {draft.notes && <p className="whitespace-pre-wrap">{draft.notes}</p>}
              <Proof
                items={[
                  { label: "Signed by", value: canSign ? "Your key" : "Core" },
                  { label: "Signing account", value: <span className="font-mono">{shortAddress(inspector, 8, 6)}</span> },
                ]}
              />
            </ReviewDialog>
            <div className="flex flex-wrap-reverse items-start justify-between gap-x-6 gap-y-2">
              <Proof
                className="min-w-0 flex-1"
                items={[
                  { label: "Signing key", value: key && target ? <SigningKey address={inspector} inspectorKey={key} onChange={() => setKeyVersion((v) => v + 1)} /> : "Core signs" },
                  { label: "Sent to", value: target && <span className="font-mono">{shortAddress(target, 8, 6)}</span> },
                ]}
              />
              <Button size="lg" className="max-sm:w-full" onClick={() => {
                setShowErrors(true);
                if (problems.length) { document.getElementById(problems[0]!.field)?.scrollIntoView({ block: "center" }); return; }
                setReviewing(true);
              }} disabled={phase !== "idle" || key === undefined}>
                {phase === "signing" ? "Signing attestation…" : phase === "filing" ? "Filing site visit…" : "Review site visit"}
              </Button>
            </div>
          </div>
        </div>
      </AuditWorkspace>
    </div>
  );
}
