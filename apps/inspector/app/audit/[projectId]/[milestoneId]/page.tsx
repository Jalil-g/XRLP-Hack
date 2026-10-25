"use client";
// INS-03 audit form: the inspector's deliverable for one milestone. Builder evidence on the left (what the suite will check),
// the audit on the right: SoV checklist, site photos with EXIF, site map, notes. INS-04: the inspector signs the audit's
// attestation (XRPL-08 Payment to the SPV) in this browser and route 10 carries it as signedTxBlob.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { ReAuditContext } from "@/components/audit/re-audit-context";
import { latestOwnAudit } from "@/lib/re-audit";
import { Checklist } from "@/components/audit/checklist";
import { EvidenceGallery } from "@/components/audit/evidence-gallery";
import { PhotoPicker } from "@/components/audit/photo-picker";
import { SigningKey, SigningPanel } from "@/components/audit/signing-panel";
import { SiteMap, type MapPin } from "@/components/audit/site-map";
import { useIdentity } from "@/components/identity";
import { NEEDS } from "@/components/task-row";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { ReviewDialog } from "@/components/ui/review-dialog";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, Facts, PageHeader, Properties, Section } from "@/components/ui/layout";
import { Proof } from "@/components/ui/proof";
import { StatusIcon } from "@/components/ui/status-icon";
import { api, API_MODE } from "@/lib/api";
import { buildAudit, draftProblems, emptyDraft, evidenceBundleHash, withBrowserExif, type AuditDraft } from "@/lib/audit";
import { evidenceStatus } from "@/lib/queue";
import { inspectorKey as loadInspectorKey, signAuditAttestation, type InspectorKey, type SignedAttestation } from "@/lib/signing";
import type { ChecksStatus, Inspector, InspectorTask, SubmitAuditResult } from "@/lib/types";
import { cn, formatAmount, formatDate, formatRlusd, shortAddress, shortHash } from "@/lib/utils";
import { isAuditSubmitShortcut } from "@/lib/shortcuts";
import { submitErrorView, type SubmitErrorView } from "@/lib/submit-error";

const BACK = { href: "/", label: "Queue" };

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

  const back = <PageHeader back={BACK} title="Audit" />;

  if (loadError) return <Shell back={back}><p role="alert" className="text-small text-fail">Could not load the review: {loadError}</p><Button onClick={() => setReloads((n) => n + 1)}>Retry review</Button></Shell>;
  if (!inspector || task === undefined) return <Shell back={back}><LoadingState label="Loading milestone evidence and audit context…" /></Shell>;
  if (task === null) {
    return (
      <Shell back={back}>
        <Empty title={`Not in ${inspector.name}'s queue`} action={<Link href="/" className={buttonClass("secondary")}>Back to queue</Link>} />
      </Shell>
    );
  }
  if (task.needs !== "audit" && task.needs !== "re_audit") return <Shell back={back}><Empty title="No audit due" action={<Link href="/" className={buttonClass("secondary")}>Back to queue</Link>} /></Shell>;
  // Keyed so a reload (after the builder changed evidence) starts a clean draft bound to the new bundle.
  return <AuditForm key={`${inspector.address}:${reloads}`} task={task} checks={checks} browserExif={browserExif} inspector={inspector.address} inspectorName={inspector.name} onReload={() => setReloads((n) => n + 1)} />;
}

function Shell({ back, children }: { back: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-8">
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
  onReload,
}: {
  task: AuditTask;
  checks?: ChecksStatus;
  browserExif: ReadonlySet<string>;
  inspector: string;
  inspectorName: string;
  onReload(): void;
}) {
  const m = task.milestone;
  const [draft, setDraft] = useState<AuditDraft>(() => emptyDraft(task));
  const [showErrors, setShowErrors] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "filing">("idle");
  const [submitError, setSubmitError] = useState<SubmitErrorView>();
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
    let signedHere = false;
    try {
      const report = await buildAudit(task, inspector, draft, new Date().toISOString());
      let signed: SignedAttestation | undefined;
      if (sign && key && spv) {
        setPhase("signing");
        signed = await signAuditAttestation(report, spv, key);
        signedHere = true;
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
      setSubmitError(submitErrorView(err, signedHere));
    } finally {
      submitting.current = false;
      setPhase("idle");
    }
  }

  if (result) return <Filed result={result.res} signed={result.signed} task={task} />;
  const busy = phase !== "idle";
  const canSign = Boolean(key && spv);
  const answered = task.sov.filter((l) => draft.checklist[l.code]?.status).length;

  return (
    <div className="space-y-10">
      <PageHeader
        back={BACK}
        title={<>{task.projectName} <span className="text-ink-3">{m.title}</span></>}
        meta={isReAudit && <Badge tone={NEEDS.re_audit.tone}>{NEEDS.re_audit.label}</Badge>}
        action={
          <Facts
            items={[
              { label: "Milestone", value: <>{formatAmount(m.amount)} <span className="text-caption font-medium text-ink-2">RLUSD</span></> },
              ...(m.cancelAfter ? [{ label: "Escrow expires", value: formatDate(m.cancelAfter) }] : []),
              { label: "Inspector", value: inspectorName },
            ]}
          />
        }
      />

      <ReviewDialog open={reviewing} title="Review audit" note="Your audit records observations. It does not release funds." busy={busy}
        confirmLabel={phase === "signing" ? "Signing…" : phase === "filing" ? "Submitting…" : canSign ? "Sign and submit audit" : "Submit audit (core signs)"}
        onBack={() => setReviewing(false)} onConfirm={() => void submit(canSign)}>
        <Properties
          items={[
            { label: "Project", value: task.projectName },
            { label: "Milestone", value: <><span className="mr-1.5 text-ink-3 tabular">{m.index + 1}</span>{m.title}</> },
            { label: "Amount", value: <span className="tabular">{formatRlusd(m.amount)}</span> },
            { label: "Inspector", value: inspectorName },
          ]}
        />
        <ul aria-label="Checklist" className="divide-y divide-line border-y border-line">
          {task.sov.map((line) => {
            const entry = draft.checklist[line.code];
            return (
              <li key={line.code} className="py-2.5">
                <div className="flex items-center gap-3">
                  {entry?.status && <StatusIcon state={LINE_STATE[entry.status]} className="size-4" />}
                  <span className="min-w-0 flex-1">{line.title}</span>
                  <span className="font-medium">{entry?.status && LINE_LABEL[entry.status]}</span>
                </div>
                {entry?.note && <p className="mt-1 pl-7 text-ink-2">{entry.note}</p>}
              </li>
            );
          })}
        </ul>
        <p className="flex flex-wrap gap-x-5 text-ink-2 tabular">
          <span>{draft.photos.length} site photo{draft.photos.length === 1 ? "" : "s"}</span>
          <span>{task.evidence.length} builder files</span>
        </p>
        {draft.notes && <p className="whitespace-pre-wrap">{draft.notes}</p>}
        <Proof
          items={[
            { label: "Evidence version", value: <span className="font-mono">{bundle ? shortHash(bundle) : "…"}</span> },
            { label: "Signed by", value: canSign ? "Your key" : "Core" },
            { label: "Signing account", value: <span className="font-mono">{shortAddress(inspector, 8, 6)}</span> },
          ]}
        />
      </ReviewDialog>

      {isReAudit && <ReAuditContext task={task} checks={checks} inspector={inspector} bundle={bundle} onReload={onReload} busy={busy} />}

      <div className="grid items-start gap-x-12 gap-y-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: what the builder claims. */}
        <div className="min-w-0 space-y-10">
          <Section title="Builder evidence" aside={<span className="tabular">{ev.uploaded} file{ev.uploaded === 1 ? "" : "s"}</span>}>
            <EvidenceGallery evidence={task.evidence} site={task.siteGeo} browserExif={browserExif} />
          </Section>
          <Section title="Photo locations">
            <SiteMap site={task.siteGeo} pins={pins} />
          </Section>
        </div>

        {/* Right: the inspector's audit. */}
        <div className="min-w-0 space-y-10">
          <Card id="checklist">
            <CardHeader>
              <CardTitle>Checklist</CardTitle>
              <span className={cn("text-caption tabular", answered === task.sov.length ? "font-medium text-ink" : "text-ink-2")}>
                {answered} of {task.sov.length}
              </span>
            </CardHeader>
            <Checklist sov={task.sov} value={draft.checklist} onChange={setLine} showErrors={showErrors} />
          </Card>

          <Section id="photos" title="Site photos" aside={draft.photos.length > 0 && <span className="tabular">{draft.photos.length}</span>}>
            <PhotoPicker photos={draft.photos} onChange={(photos) => setDraft((d) => ({ ...d, photos }))} site={task.siteGeo} invalid={showErrors && draft.photos.length === 0} />
          </Section>

          <Section title="Notes">
            <textarea
              aria-label="Audit notes"
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={3}
              placeholder="Optional"
              className="block w-full rounded-control border border-line-2 bg-surface px-3 py-2.5 text-small placeholder:text-ink-3"
            />
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
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-fail-bg px-4 py-3 text-small text-fail">
                <span>{submitError.stale ? "The builder's evidence changed since you opened this audit. Reload it." : submitError.message}</span>
                {submitError.stale && (
                  <Button size="sm" variant="danger" className="bg-surface" onClick={onReload}>
                    Reload evidence
                  </Button>
                )}
              </div>
            )}
            {key === null && spv && <SigningPanel address={inspector} inspectorKey={key} onChange={() => setKeyVersion((v) => v + 1)} />}
            <div className="flex flex-wrap-reverse items-start justify-between gap-x-6 gap-y-2">
              <Proof
                className="min-w-0 flex-1"
                items={[
                  {
                    label: "Evidence version",
                    value: (
                      <span className="font-mono" title="Your audit is bound to these builder files. If they change, a re-audit is needed.">
                        {bundle ? shortHash(bundle) : "…"}
                      </span>
                    ),
                  },
                  { label: "Signing key", value: key && spv ? <SigningKey address={inspector} inspectorKey={key} onChange={() => setKeyVersion((v) => v + 1)} /> : "Core signs" },
                  { label: "Escrow owner", value: spv && <span className="font-mono">{shortAddress(spv, 8, 6)}</span> },
                ]}
              />
              <Button ref={submitButton} size="lg" className="max-sm:w-full" aria-keyshortcuts="Control+Enter Meta+Enter" onClick={() => {
                setShowErrors(true);
                if (problems.length) {
                  document.getElementById(problems[0]!.field)?.scrollIntoView({ block: "center" });
                  return;
                }
                setReviewing(true);
              }} disabled={busy || !bundle || key === undefined}>
                {phase === "signing" ? "Signing attestation…" : phase === "filing" ? "Filing audit…" : "Review audit"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const LINE_STATE = { done: "pass", partial: "warn", not_done: "fail" } as const;
const LINE_LABEL = { done: "Done", partial: "Partial", not_done: "Not done" } as const;

function Filed({ result, signed, task }: { result: SubmitAuditResult; signed?: SignedAttestation; task: AuditTask }) {
  const attested = result.events.find((e) => e.kind === "audit_attested") ?? result.events[0];
  const sameTx = signed && attested && signed.txHash.toUpperCase() === attested.txHash.toUpperCase();
  const status = result.milestone.status.replaceAll("_", " ");
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return (
    <div className="mx-auto max-w-[520px] space-y-8 pt-2">
      <div>
        <CheckCircle2 className="size-10 text-pass" aria-hidden />
        <h1 className="mt-4 text-title">{task.needs === "re_audit" || latestOwnAudit(task, result.audit.inspector) ? "Re-audit filed" : "Audit filed"}</h1>
      </div>
      <Properties
        items={[
          { label: "Project", value: task.projectName },
          { label: "Milestone", value: <><span className="mr-1.5 text-ink-3 tabular">{task.milestone.index + 1}</span>{task.milestone.title}</> },
          { label: "Status", value: <span className="font-medium">{status.charAt(0).toUpperCase() + status.slice(1)}</span> },
          ...(signed
            ? [
                { label: "Signed by", value: <span className="font-mono">{shortAddress(signed.signer, 8, 6)}</span> },
                { label: "Sent to", value: <span className="font-mono">{shortAddress(signed.spv, 8, 6)}</span> },
                { label: "Memo", value: <span className="font-mono">{shortHash(signed.memo.hash)}</span> },
                {
                  label: API_MODE === "mock" ? "Mock receipt" : "On ledger",
                  value: sameTx ? <span className="font-medium text-pass">{API_MODE === "mock" ? "Verified locally" : "Matches signature"}</span> : <span className="font-medium text-fail">Hash mismatch</span>,
                },
              ]
            : [{ label: "Signed by", value: "Core" }]),
          ...(attested && API_MODE !== "mock"
            ? [{
                label: "Attestation",
                value: (
                  <a href={attested.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono underline">
                    {shortHash(attested.txHash)} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ),
              }]
            : []),
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <Link href="/history" className={buttonClass("primary", "lg")}>
          View history
        </Link>
        <Link href="/" className={buttonClass("secondary", "lg")}>
          Back to queue
        </Link>
      </div>
    </div>
  );
}
