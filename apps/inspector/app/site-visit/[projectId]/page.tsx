"use client";
// INS-06: pre-construction site visit for a project whose verification the AI escalated. Mock-only until the contract on #53
// is agreed (see lib/site-visit.ts): in http mode core does not have the route yet and answers 404.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FlaskConical, PenLine } from "lucide-react";
import { PhotoPicker } from "@/components/audit/photo-picker";
import { SigningPanel } from "@/components/audit/signing-panel";
import { SiteMap } from "@/components/audit/site-map";
import { useIdentity } from "@/components/identity";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { ReviewDialog } from "@/components/ui/review-dialog";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn, explorerTxUrl, formatRlusd, shortAddress, shortHash } from "@/lib/utils";

const ANSWERS: { value: SiteVisitAnswer; label: string; on: string }[] = [
  { value: "yes", label: "Yes", on: "bg-ok text-white ring-ok" },
  { value: "no", label: "No", on: "bg-bad text-white ring-bad" },
  { value: "unable_to_confirm", label: "Unable to confirm", on: "bg-warn text-white ring-warn" },
];

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

  const back = (
    <Link href="/" className="inline-flex items-center gap-1 text-small text-muted hover:text-ink">
      <ArrowLeft className="size-4" /> Queue
    </Link>
  );
  if (status === "error") return <div className="space-y-4">{back}<p role="alert" className="text-small text-bad">Could not load inspector credentials: {identityError}</p></div>;
  if (error) return <div className="space-y-4">{back}<p role="alert" className="text-small text-bad">Could not load the queue: {error}</p></div>;
  if (!inspector || task === undefined) return <div className="space-y-4">{back}<LoadingState label="Loading your site visit assignment…" /></div>;
  if (task === null) {
    return <div className="space-y-4">{back}<p className="text-small text-muted">No pre-construction visit is due from {inspector.name} for this project.</p></div>;
  }
  return <SiteVisitForm key={inspector.address} task={task} inspector={inspector.address} inspectorName={inspector.name} back={back} />;
}

function SiteVisitForm({ task, inspector, inspectorName, back }: { task: InspectorTask; inspector: string; inspectorName: string; back: React.ReactNode }) {
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
      <div className="mx-auto max-w-xl space-y-4">
        {back}
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-ok" />
            <div>
              <h1 className="text-xl font-semibold">Site visit filed</h1>
              <p className="mt-1 text-small text-muted">
                {task.projectName}: site {outcome === "confirmed" ? "confirmed" : outcome === "concern" ? "concern raised" : "not fully confirmed"}. The AI
                re-runs project verification with your report.
              </p>
            </div>
            {filed.visit.txHash && api.mode !== "mock" && (
              <a href={explorerTxUrl(filed.visit.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-small text-brand hover:underline">
                Attestation {shortHash(filed.visit.txHash)} <ExternalLink className="size-3.5" />
              </a>
            )}
            <p className="text-caption text-muted">{filed.signed ? "Signed in this browser with your key." : "Attested by core on your behalf."}</p>
            <Link href="/" className={buttonClass("secondary")}>
              Back to queue
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {back}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-title">Pre-construction site visit</h1>
            <p className="mt-2 text-small text-muted">{task.projectName} · Confirm conditions before project verification</p>
          </div>
          <div className="flex items-center gap-3 text-small">
            <div className="text-right"><p className="text-caption text-muted">Project amount</p><span className="tabular font-medium">{formatRlusd(taskAmount(task))}</span></div>
            <Badge tone="info" dot>
              Pre-construction visit
            </Badge>
          </div>
        </div>
        <p className="flex max-w-3xl items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-caption text-info">
          <FlaskConical className="mt-0.5 size-4 shrink-0" />
          The AI escalated this project&apos;s verification: it needs an inspector&apos;s eyes on site before the project can be listed.
          {api.mode === "http" ? " Core cannot accept site-visit reports yet." : " Sample flow in mock mode."}
        </p>
      </div>

      <ol aria-label="Site visit workflow" className="workflow-rail">
        <li aria-current="step">Record site conditions</li><li>Add site photos</li><li>Review & sign</li>
      </ol>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>What you found on site</CardTitle>
                <CardDescription>Answer each question; explain anything that is not a clear yes.</CardDescription>
              </div>
            </CardHeader>
            <ol className="divide-y divide-line">
              {SITE_VISIT_QUESTIONS.map((q) => {
                const a = draft.answers[q.key];
                const missing = showErrors && (!a.answer || (a.answer !== "yes" && !a.note.trim()));
                return (
                  <li key={q.key} id={`answers.${q.key}`} className={cn("space-y-3 px-5 py-5 sm:px-6", missing && "bg-bad-bg/60")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-small font-semibold">{q.label}</p>
                        <p className="text-caption text-muted">{q.hint}</p>
                      </div>
                      <div role="group" aria-label={q.label} className="flex gap-1">
                        {ANSWERS.map(({ value, label, on }) => (
                          <button
                            key={value}
                            type="button"

                            aria-pressed={a.answer === value}
                            onClick={() => setAnswer(q.key, { answer: value })}
                            className={cn(
                              "min-h-11 rounded-control px-2.5 py-1.5 text-caption font-medium ring-1 ring-line transition-colors ring-inset",
                              a.answer === value ? on : "bg-surface text-ink-2 hover:bg-subtle",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="block space-y-2">
                      <span className="text-caption font-medium">{a.answer && a.answer !== "yes" ? "Explain your finding (required)" : "Observation note (optional)"}</span>
                      <input
                      type="text"
                      value={a.note}
                      onChange={(e) => setAnswer(q.key, { note: e.target.value })}
                      placeholder={a.answer && a.answer !== "yes" ? "Required: what did you find?" : "Note (optional)"}
                      aria-label={`${q.label} note`}
                      aria-invalid={Boolean(missing && a.answer && a.answer !== "yes")}
                      className={cn(
                        "min-h-11 w-full rounded-control border bg-surface px-3 py-1.5 text-small placeholder:text-faint focus:ring-2 focus:border-brand",
                        missing && a.answer && a.answer !== "yes" ? "border-bad" : "border-line",
                      )}
                      />
                    </label>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                aria-label="Site visit notes"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                rows={3}
                placeholder="Anything else the AI should know: neighbours, utilities, access hours."
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-small placeholder:text-faint focus:ring-2 focus:border-brand"
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card id="photos" className={cn(showErrors && draft.photos.length === 0 && "border-bad-line")}>
            <CardHeader>
              <div>
                <CardTitle>Site photos</CardTitle>
                <CardDescription>Capture time and GPS are read in your browser.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <PhotoPicker photos={draft.photos} onChange={(photos) => setDraft((d) => ({ ...d, photos }))} site={task.siteGeo} />
              <SiteMap site={task.siteGeo} pins={pins} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              {showErrors && problems.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-caption text-bad">
                  {problems.map((p) => (
                    <li key={p.field + p.message}>{p.message}</li>
                  ))}
                </ul>
              )}
              {submitError && (
                <p role="alert" className="flex items-start gap-2 rounded-md bg-bad-bg px-3 py-2 text-small text-bad">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {submitError}
                </p>
              )}
              {key !== undefined && target && <SigningPanel address={inspector} inspectorKey={key} onChange={() => setKeyVersion((v) => v + 1)} />}
              <ReviewDialog open={reviewing} title="Review and submit site visit" busy={phase !== "idle"}
                confirmLabel={phase !== "idle" ? "Submitting…" : canSign ? "Sign and submit site visit" : "Submit site visit (core signs)"}
                onBack={() => setReviewing(false)} onConfirm={() => void submit()}>
                <p className="font-medium">{task.projectName}</p>
                <p>{inspectorName} ({shortAddress(inspector)}) · {draft.photos.length} site photos</p>
                <ul className="divide-y divide-line border-y border-line">
                  {SITE_VISIT_QUESTIONS.map((q) => <li key={q.key} className="py-3">
                    <p>{q.label}: <strong>{draft.answers[q.key].answer?.replaceAll("_", " ")}</strong></p>
                    {draft.answers[q.key].note && <p className="mt-1 text-muted">{draft.answers[q.key].note}</p>}
                  </li>)}
                </ul>
                {draft.notes && <p className="whitespace-pre-wrap">{draft.notes}</p>}
                <p className="text-caption text-muted">{canSign ? "Signed with your loaded browser key." : "Core will sign on your behalf."}</p>
              </ReviewDialog>
              <p className="text-caption text-muted">Step 1 of 2 · Review your observations before signing.</p>
              <Button variant="brand" size="lg" className="w-full" onClick={() => {
                setShowErrors(true);
                if (problems.length) { document.getElementById(problems[0]!.field)?.scrollIntoView({ block: "center" }); return; }
                setReviewing(true);
              }} disabled={phase !== "idle" || key === undefined}>
                {canSign && <PenLine />}
                {phase === "signing" ? "Signing attestation…" : phase === "filing" ? "Filing site visit…" : "Review site visit"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
