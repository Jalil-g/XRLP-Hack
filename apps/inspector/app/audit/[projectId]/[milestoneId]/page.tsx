"use client";
// INS-03 audit form: the inspector's deliverable for one milestone. Builder evidence on the left (what the suite will check),
// the audit on the right: SoV checklist, site photos with EXIF, site map, notes. INS-04: the inspector signs the audit's
// attestation (XRPL-08 Payment to the SPV) in this browser and route 10 carries it as signedTxBlob.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarClock, CheckCircle2, ExternalLink, Fingerprint, PenLine } from "lucide-react";
import { ReAuditContext } from "@/components/audit/re-audit-context";
import { latestOwnAudit } from "@/lib/re-audit";
import { Checklist } from "@/components/audit/checklist";
import { EvidenceGallery } from "@/components/audit/evidence-gallery";
import { PhotoPicker } from "@/components/audit/photo-picker";
import { SigningPanel } from "@/components/audit/signing-panel";
import { SiteMap, type MapPin } from "@/components/audit/site-map";
import { useIdentity } from "@/components/identity";
import { NEEDS } from "@/components/task-row";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { ReviewDialog } from "@/components/ui/review-dialog";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api, API_MODE } from "@/lib/api";
import { buildAudit, draftProblems, emptyDraft, evidenceBundleHash, withBrowserExif, type AuditDraft } from "@/lib/audit";
import { evidenceStatus } from "@/lib/queue";
import { inspectorKey as loadInspectorKey, signAuditAttestation, type InspectorKey, type SignedAttestation } from "@/lib/signing";
import type { ChecksStatus, Inspector, InspectorTask, SubmitAuditResult } from "@/lib/types";
import { cn, formatDateTime, formatRlusd, shortAddress, shortHash } from "@/lib/utils";
import { isAuditSubmitShortcut } from "@/lib/shortcuts";

type AuditTask = InspectorTask & { milestone: NonNullable<InspectorTask["milestone"]> };

const param = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  try {
    return s ? decodeURIComponent(s) : "";
  } catch {
    return s ?? "";
  }
};

export default function AuditPage() {
  const params = useParams();
  const projectId = param(params.projectId);
  const milestoneId = param(params.milestoneId);
  const { inspector, status, error } = useIdentity();
  if (status === "error") return <p role="alert" className="text-small text-bad">Could not load inspector credentials: {error}</p>;
  if (!inspector) return <LoadingState label="Loading inspector credentials…" />;
  return <AuditLoader key={`${inspector.address}:${projectId}:${milestoneId}`} inspector={inspector} projectId={projectId} milestoneId={milestoneId} />;
}

function AuditLoader({ inspector, projectId, milestoneId }: { inspector: Inspector; projectId: string; milestoneId: string }) {
  const [checks, setChecks] = useState<ChecksStatus>();
  const [task, setTask] = useState<AuditTask | null>();
  const [loadError, setLoadError] = useState<string>();
  const [reloads, setReloads] = useState(0);
  const [browserExif, setBrowserExif] = useState<ReadonlySet<string>>(new Set());

  // One-shot load, not polled: the evidence must not change under the inspector while they review it.
  useEffect(() => {
    if (!inspector) return;
    let live = true;
    setTask(undefined);
    setChecks(undefined);
    setBrowserExif(new Set());
    setLoadError(undefined);
    api
      .getAuditReview(inspector.address, projectId, milestoneId)
      .then((review) => {
        if (!live) return;
        setTask(review?.task.milestone ? (review.task as AuditTask) : null);
        setChecks(review?.checks);
        // Fill in EXIF core's record lacks without holding up the form (sha256s, so the bundle hash, are unchanged).
        if (review?.task.milestone) {
          void withBrowserExif(review.task.evidence, (e) => api.fileBytes(e)).then(({ evidence, browserRead }) => {
            if (!live || browserRead.size === 0) return;
            setTask((t) => (t ? { ...t, evidence } : t));
            setBrowserExif(browserRead);
          });
        }
      })
      .catch((err: Error) => live && setLoadError(err.message));
    return () => {
      live = false;
    };
  }, [inspector, projectId, milestoneId, reloads]);

  const back = (
    <Link href="/" className="inline-flex items-center gap-1 text-small text-muted hover:text-ink">
      <ArrowLeft className="size-4" /> Queue
    </Link>
  );

  if (loadError) return <Shell back={back}><p role="alert" className="text-small text-bad">Could not load the review: {loadError}</p><Button onClick={() => setReloads((n) => n + 1)}>Retry review</Button></Shell>;
  if (!inspector || task === undefined) return <Shell back={back}><LoadingState label="Loading milestone evidence and audit context…" /></Shell>;
  if (task === null) {
    return (
      <Shell back={back}>
        <p className="text-small text-muted">Not in {inspector.name}&apos;s queue.</p>
      </Shell>
    );
  }
  if (task.needs !== "audit" && task.needs !== "re_audit") return <Shell back={back}><p className="text-small text-muted">No audit due.</p></Shell>;
  // Keyed so a reload (after the builder changed evidence) starts a clean draft bound to the new bundle.
  return <AuditForm key={`${inspector.address}:${reloads}`} task={task} checks={checks} browserExif={browserExif} inspector={inspector.address} inspectorName={inspector.name} back={back} onReload={() => setReloads((n) => n + 1)} />;
}

function Shell({ back, children }: { back: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      {back}
      {children}
    </div>
  );
}

function AuditForm({
  task,
  checks,
  browserExif,
  inspector,
  inspectorName,
  back,
  onReload,
}: {
  task: AuditTask;
  checks?: ChecksStatus;
  browserExif: ReadonlySet<string>;
  inspector: string;
  inspectorName: string;
  back: React.ReactNode;
  onReload(): void;
}) {
  const m = task.milestone;
  const [draft, setDraft] = useState<AuditDraft>(() => emptyDraft(task));
  const [showErrors, setShowErrors] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "filing">("idle");
  const [submitError, setSubmitError] = useState<{ message: string; stale: boolean }>();
  const [result, setResult] = useState<{ res: SubmitAuditResult; signed?: SignedAttestation }>();
  const [bundle, setBundle] = useState<string>();
  const [key, setKey] = useState<InspectorKey | null>();
  const [keyVersion, setKeyVersion] = useState(0);
  const spv = m.escrow?.owner;
  const submitButton = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const button = submitButton.current;
      if (!isAuditSubmitShortcut(event) || !button || button.disabled || submitting.current) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let live = true;
    void loadInspectorKey(inspector).then((k) => live && setKey(k));
    return () => {
      live = false;
    };
  }, [inspector, keyVersion]);

  useEffect(() => {
    let live = true;
    void evidenceBundleHash(task.evidence).then((h) => live && setBundle(h));
    return () => {
      live = false;
    };
  }, [task.evidence]);

  const problems = useMemo(() => draftProblems(task, draft), [task, draft]);
  const isReAudit = task.needs === "re_audit" || !!latestOwnAudit(task, inspector);
  const ev = evidenceStatus(task);

  const pins = useMemo<MapPin[]>(
    () => [
      ...task.evidence.flatMap((e) => (e.kind === "photo" && e.meta.gps ? [{ id: e.id, label: e.filename, gps: e.meta.gps, who: "builder" as const }] : [])),
      ...draft.photos.flatMap((p) =>
        p.evidence.meta.gps ? [{ id: p.evidence.sha256, label: p.evidence.filename, gps: p.evidence.meta.gps, who: "inspector" as const }] : [],
      ),
    ],
    [task.evidence, draft.photos],
  );

  const setLine = useCallback(
    (code: string, next: AuditDraft["checklist"][string]) => setDraft((d) => ({ ...d, checklist: { ...d.checklist, [code]: next } })),
    [],
  );

  /** `sign`: attestation signed here with the inspector's key. Otherwise core attests it on the inspector's behalf (05-api: their demo key; CORE-03 today: the platform key). */
  async function submit(sign: boolean) {
    if (submitting.current || !reviewing) return;
    setShowErrors(true);
    setSubmitError(undefined);
    if (problems.length) {
      document.getElementById(problems[0]!.field)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    submitting.current = true;
    try {
      const report = await buildAudit(task, inspector, draft, new Date().toISOString());
      let signed: SignedAttestation | undefined;
      if (sign && key && spv) {
        setPhase("signing");
        signed = await signAuditAttestation(report, spv, key);
      }
      setPhase("filing");
      const res = await api.submitAudit({
        projectId: task.projectId,
        milestoneId: m.id,
        report,
        photos: draft.photos.map((p) => p.file),
        ...(signed ? { signedTxBlob: signed.blob } : {}),
      });
      setReviewing(false);
      setResult({ res, signed });
    } catch (err) {
      setReviewing(false);
      const message = (err as Error).message;
      setSubmitError({ message, stale: err instanceof ApiError && err.code === "validation" && message.includes("evidenceBundleHash") });
    } finally {
      submitting.current = false;
      setPhase("idle");
    }
  }

  if (result) return <Filed result={result.res} signed={result.signed} task={task} back={back} />;
  const busy = phase !== "idle";
  const canSign = Boolean(key && spv);

  return (
    <div className="space-y-6">
      <div className="audit-context space-y-4">
        {back}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-title">
              <span className="mr-3 text-muted">M{m.index + 1}</span>
              {m.title}
            </h1>
            <p className="mt-2 flex flex-wrap gap-x-4 text-small text-muted"><span>{task.projectName}</span><span>{inspectorName}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-small">
            <div><p className="text-caption text-muted">Milestone amount</p><p className="mt-1 tabular text-heading font-semibold">{formatRlusd(m.amount)}</p></div>
            {m.cancelAfter && (
              <span className="flex items-center gap-1 text-caption text-muted">
                <CalendarClock className="size-3.5" /> Expires {formatDateTime(m.cancelAfter)}
              </span>
            )}
            {isReAudit && (
              <Badge tone={NEEDS.re_audit.tone} dot>
                {NEEDS.re_audit.label}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <ol aria-label="Audit workflow" className="workflow-rail">
        <li aria-current="step">Report</li>
        <li>Review</li>
        <li>Sign</li>
      </ol>

      <ReviewDialog open={reviewing} title="Review and submit audit" busy={busy}
        confirmLabel={phase === "signing" ? "Signing…" : phase === "filing" ? "Submitting…" : canSign ? "Sign and submit audit" : "Submit audit (core signs)"}
        onBack={() => setReviewing(false)} onConfirm={() => void submit(canSign)}>
        <p className="font-medium">{task.projectName} <span className="ml-2 text-faint">M{m.index + 1}</span> {m.title}</p>
        <p className="flex flex-wrap gap-x-4"><span className="tabular">{formatRlusd(m.amount)}</span><span>{inspectorName}</span><span className="font-mono">{shortAddress(inspector, 8, 6)}</span></p>
        <ul className="divide-y divide-line border-y border-line">
          {task.sov.map((line) => <li key={line.code} className="py-3">
            <div className="flex flex-wrap justify-between gap-2"><span>{line.title}</span><span className="font-medium">{draft.checklist[line.code]?.status?.replaceAll("_", " ")}</span></div>
            {draft.checklist[line.code]?.note && <p className="mt-1 text-muted">{draft.checklist[line.code]?.note}</p>}
          </li>)}
        </ul>
        <p className="flex flex-wrap gap-x-4"><span>{draft.photos.length} site photo{draft.photos.length === 1 ? "" : "s"}</span><span>{task.evidence.length} builder files</span></p>
        {draft.notes && <p className="whitespace-pre-wrap">{draft.notes}</p>}
        <p className="flex flex-wrap gap-x-4 text-caption text-muted"><span>Evidence version <span className="font-mono">{bundle ? shortHash(bundle) : "…"}</span></span><span>Signed by: {canSign ? "Your key" : "Core"}</span></p>
      </ReviewDialog>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Left: what the builder claims. */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Builder evidence</CardTitle>
              <span className="tabular text-caption text-muted">{ev.uploaded} file{ev.uploaded === 1 ? "" : "s"}</span>
            </CardHeader>
            <CardContent>
              <EvidenceGallery evidence={task.evidence} site={task.siteGeo} browserExif={browserExif} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Site vs photo locations</CardTitle>
            </CardHeader>
            <CardContent>
              <SiteMap site={task.siteGeo} pins={pins} />
            </CardContent>
          </Card>
        </div>

        {/* Right: the inspector's audit. */}
        <div className="min-w-0 space-y-6">
          {isReAudit && <ReAuditContext task={task} checks={checks} inspector={inspector} bundle={bundle} onReload={onReload} busy={busy} />}

          <Card id="checklist">
            <CardHeader>
              <CardTitle>Checklist</CardTitle>
            </CardHeader>
            <Checklist sov={task.sov} value={draft.checklist} onChange={setLine} showErrors={showErrors} />
          </Card>

          <Card id="photos" className={cn(showErrors && draft.photos.length === 0 && "border-bad-line")}>
            <CardHeader>
              <CardTitle>Site photos</CardTitle>
            </CardHeader>
            <CardContent>
              <PhotoPicker photos={draft.photos} onChange={(photos) => setDraft((d) => ({ ...d, photos }))} site={task.siteGeo} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                aria-label="Audit notes"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                rows={4}
                placeholder="Optional"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-small placeholder:text-faint focus:ring-2 focus:border-brand"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <p className="flex items-center gap-2 text-caption text-muted" title="Your audit is bound to these builder files. If they change, a re-audit is needed.">
                <Fingerprint className="size-4 shrink-0 text-faint" />
                <span>Evidence version</span>
                <span className="font-mono text-ink-2">{bundle ? shortHash(bundle) : "…"}</span>
              </p>
              {showErrors && problems.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-caption text-bad">
                  {problems.map((p) => (
                    <li key={p.field + p.message}>{p.message}</li>
                  ))}
                </ul>
              )}
              {submitError && (
                <div role="alert" className="rounded-md bg-bad-bg px-3 py-2 text-small text-bad">
                  {submitError.stale ? "The builder's evidence changed since you opened this audit. Reload and review it again." : submitError.message}
                  {submitError.stale && (
                    <Button size="sm" variant="danger" className="ml-3" onClick={onReload}>
                      Reload evidence
                    </Button>
                  )}
                </div>
              )}
              {key !== undefined && spv && <SigningPanel address={inspector} inspectorKey={key} onChange={() => setKeyVersion((v) => v + 1)} />}
              <Button ref={submitButton} variant="brand" size="lg" className="w-full" aria-keyshortcuts="Control+Enter Meta+Enter" onClick={() => {
                setShowErrors(true);
                if (problems.length) {
                  document.getElementById(problems[0]!.field)?.scrollIntoView({ block: "center" });
                  return;
                }
                setReviewing(true);
              }} disabled={busy || !bundle || key === undefined}>
                {canSign && <PenLine />}
                {phase === "signing" ? "Signing attestation…" : phase === "filing" ? "Filing audit…" : "Review audit"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Filed({ result, signed, task, back }: { result: SubmitAuditResult; signed?: SignedAttestation; task: AuditTask; back: React.ReactNode }) {
  const attested = result.events.find((e) => e.kind === "audit_attested") ?? result.events[0];
  const sameTx = signed && attested && signed.txHash.toUpperCase() === attested.txHash.toUpperCase();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      {back}
      <Card>
        <CardContent className="space-y-4 py-8 text-center">
          <CheckCircle2 className="mx-auto size-10 text-ok" />
          <div>
            <h1 className="text-xl font-semibold">{task.needs === "re_audit" || latestOwnAudit(task, result.audit.inspector) ? "Re-audit filed" : "Audit filed"}</h1>
            <p className="mt-1 flex flex-wrap justify-center gap-x-4 text-small text-muted">
              <span>{task.projectName}</span>
              <span>M{task.milestone.index + 1} {task.milestone.title}</span>
              <span className="font-medium text-ink">{result.milestone.status.replaceAll("_", " ")}</span>
            </p>
          </div>
          {attested && API_MODE !== "mock" && (
            <a href={attested.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-small text-brand hover:underline">
              Attestation {shortHash(attested.txHash)} <ExternalLink className="size-3.5" />
            </a>
          )}
          <dl className="mx-auto max-w-sm space-y-1 rounded-md bg-subtle px-4 py-3 text-left text-caption">
            {signed ? (
              <>
                <Row label="Signed by">
                  <span className="font-mono">{shortAddress(signed.signer, 8, 6)}</span>
                </Row>
                <Row label="Sent to">
                  <span className="font-mono">{shortAddress(signed.spv, 8, 6)}</span>
                </Row>
                <Row label="Memo">
                  <span className="font-mono">{shortHash(signed.memo.hash)}</span>
                </Row>
                <Row label={API_MODE === "mock" ? "Mock receipt" : "On ledger"}>
                  {sameTx ? <span className="text-ok">{API_MODE === "mock" ? "Verified locally" : "Matches signature"}</span> : <span className="text-bad">Hash mismatch</span>}
                </Row>
              </>
            ) : (
              <Row label="Signed by">Core</Row>
            )}
          </dl>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/history" className={buttonClass("primary")}>
              View audit history
            </Link>
            <Link href="/" className={buttonClass("secondary")}>
              Back to queue
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 text-ink-2">{children}</dd>
    </div>
  );
}
