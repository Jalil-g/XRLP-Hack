"use client";
// INS-03 audit form: the inspector's deliverable for one milestone. Builder evidence on the left (what the suite will check),
// the audit on the right: SoV checklist, site photos with EXIF, site map, notes. INS-04: the inspector signs the audit's
// attestation (XRPL-08 Payment to the SPV) in this browser and route 10 carries it as signedTxBlob.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, SectionLabel } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { buildAudit, draftProblems, emptyDraft, evidenceBundleHash, withBrowserExif, type AuditDraft } from "@/lib/audit";
import { evidenceStatus } from "@/lib/queue";
import { inspectorKey as loadInspectorKey, signAuditAttestation, type InspectorKey, type SignedAttestation } from "@/lib/signing";
import type { ChecksStatus, Inspector, InspectorTask, SubmitAuditResult } from "@/lib/types";
import { cn, formatDateTime, formatRlusd, shortAddress, shortHash } from "@/lib/utils";

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
  const { inspector } = useIdentity();
  if (!inspector) return <p className="text-sm text-muted">Loading inspector…</p>;
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
    <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4" /> Queue
    </Link>
  );

  if (loadError) return <Shell back={back}><p role="alert" className="text-sm text-bad">Could not load the review: {loadError}</p><Button onClick={() => setReloads((n) => n + 1)}>Retry review</Button></Shell>;
  if (!inspector || task === undefined) return <Shell back={back}><p className="text-sm text-muted">Loading…</p></Shell>;
  if (task === null) {
    return (
      <Shell back={back}>
        <p className="text-sm text-muted">This milestone is not in {inspector.name}&apos;s queue. Switch inspector, or go back to the queue.</p>
      </Shell>
    );
  }
  if (task.needs !== "audit" && task.needs !== "re_audit") return <Shell back={back}><p className="text-sm text-muted">No audit is due from you for this milestone. Return to the queue for your current assignments.</p></Shell>;
  // Keyed so a reload (after the builder changed evidence) starts a clean draft bound to the new bundle.
  return <AuditForm key={`${inspector.address}:${reloads}`} task={task} checks={checks} browserExif={browserExif} inspector={inspector.address} back={back} onReload={() => setReloads((n) => n + 1)} />;
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
  back,
  onReload,
}: {
  task: AuditTask;
  checks?: ChecksStatus;
  browserExif: ReadonlySet<string>;
  inspector: string;
  back: React.ReactNode;
  onReload(): void;
}) {
  const m = task.milestone;
  const [draft, setDraft] = useState<AuditDraft>(() => emptyDraft(task));
  const [showErrors, setShowErrors] = useState(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "filing">("idle");
  const [submitError, setSubmitError] = useState<{ message: string; stale: boolean }>();
  const [result, setResult] = useState<{ res: SubmitAuditResult; signed?: SignedAttestation }>();
  const [bundle, setBundle] = useState<string>();
  const [key, setKey] = useState<InspectorKey | null>();
  const [keyVersion, setKeyVersion] = useState(0);
  const spv = m.escrow?.owner;

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
    setShowErrors(true);
    setSubmitError(undefined);
    if (problems.length) {
      document.getElementById(problems[0]!.field)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
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
      setResult({ res, signed });
    } catch (err) {
      const message = (err as Error).message;
      setSubmitError({ message, stale: err instanceof ApiError && err.code === "validation" && message.includes("evidenceBundleHash") });
    } finally {
      setPhase("idle");
    }
  }

  if (result) return <Filed result={result.res} signed={result.signed} task={task} back={back} />;
  const busy = phase !== "idle";
  const canSign = Boolean(key && spv);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {back}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <SectionLabel>{task.projectName}</SectionLabel>
            <h1 className="text-2xl font-semibold tracking-tight">
              {isReAudit && "Re-audit: "}M{m.index + 1} · {m.title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="tabular font-medium">{formatRlusd(m.amount)}</span>
            {m.cancelAfter && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <CalendarClock className="size-3.5" /> escrow expires {formatDateTime(m.cancelAfter)}
              </span>
            )}
            <Badge tone={NEEDS[task.needs].tone} dot>
              {NEEDS[task.needs].label}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Left: what the builder claims. */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Current builder evidence</CardTitle>
                <CardDescription>
                  {ev.uploaded} file{ev.uploaded === 1 ? "" : "s"} · the suite checks these against your audit
                </CardDescription>
              </div>
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
        <div className="space-y-6">
          {isReAudit && <ReAuditContext task={task} checks={checks} inspector={inspector} bundle={bundle} onReload={onReload} busy={busy} />}

          <Card id="checklist">
            <CardHeader>
              <div>
                <CardTitle>Checklist</CardTitle>
                <CardDescription>{isReAudit ? "Record fresh observations for every SoV line; previous answers are not copied." : "One line per Schedule of Values item this milestone pays for."}</CardDescription>
              </div>
            </CardHeader>
            <Checklist sov={task.sov} value={draft.checklist} onChange={setLine} showErrors={showErrors} />
          </Card>

          <Card id="photos" className={cn(showErrors && draft.photos.length === 0 && "border-bad-line")}>
            <CardHeader>
              <div>
                <CardTitle>Your site photos</CardTitle>
                <CardDescription>Read in your browser: capture time and GPS are shown as the suite will see them.</CardDescription>
              </div>
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
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                rows={4}
                placeholder="Anything the builder's evidence does not show: workmanship, deviations from plans, safety."
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-faint focus:ring-2 focus:ring-brand-100 focus:outline-none"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <p className="flex items-start gap-2 text-xs text-muted">
                <Fingerprint className="mt-0.5 size-4 shrink-0 text-faint" />
                <span>
                  Your audit is bound to the {task.evidence.length} builder files you reviewed (bundle{" "}
                  <span className="font-mono text-ink-2">{bundle ? shortHash(bundle) : "…"}</span>). If the builder changes them, the suite asks for a
                  re-audit.
                </span>
              </p>
              {showErrors && problems.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-bad">
                  {problems.map((p) => (
                    <li key={p.field + p.message}>{p.message}</li>
                  ))}
                </ul>
              )}
              {submitError && (
                <div className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">
                  {submitError.stale ? "The builder's evidence changed since you opened this audit. Reload and review it again." : submitError.message}
                  {submitError.stale && (
                    <Button size="sm" variant="danger" className="ml-3" onClick={onReload}>
                      Reload evidence
                    </Button>
                  )}
                </div>
              )}
              {key !== undefined && spv && <SigningPanel address={inspector} inspectorKey={key} onChange={() => setKeyVersion((v) => v + 1)} />}
              <Button variant="brand" size="lg" className="w-full" onClick={() => void submit(canSign)} disabled={busy || !bundle || key === undefined}>
                {canSign && <PenLine />}
                {phase === "signing" ? "Signing attestation…" : phase === "filing" ? "Filing audit…" : canSign ? "Sign & file audit" : "File audit (core signs)"}
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
            <h1 className="text-xl font-semibold">Audit filed</h1>
            <p className="mt-1 text-sm text-muted">
              {task.projectName} · M{task.milestone.index + 1} {task.milestone.title} is now <span className="font-medium text-ink">{result.milestone.status}</span>.
              The AI runs the test suite over your audit and the builder&apos;s evidence.
            </p>
          </div>
          {(task.needs === "re_audit" || latestOwnAudit(task, result.audit.inspector)) && <p className="text-sm text-muted">Re-audit filed. This report supersedes your earlier report for the next suite. Filing it does not release the escrow; fresh checks must run.</p>}
          {attested && (
            <a href={attested.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-sm text-brand hover:underline">
              Attestation {shortHash(attested.txHash)} <ExternalLink className="size-3.5" />
            </a>
          )}
          <dl className="mx-auto max-w-sm space-y-1 rounded-md bg-subtle px-4 py-3 text-left text-xs">
            {signed ? (
              <>
                <Row label="Signed by">
                  <span className="font-mono">{shortAddress(signed.signer, 8, 6)}</span> in this browser
                </Row>
                <Row label="Sent to">
                  <span className="font-mono">{shortAddress(signed.spv, 8, 6)}</span> (project account), 1 drop
                </Row>
                <Row label="Memo">
                  <span className="font-mono">audit · {shortHash(signed.memo.hash)}</span>
                </Row>
                <Row label="On ledger">
                  {sameTx ? <span className="text-ok">same tx you signed ✓</span> : <span className="text-bad">tx hash differs from the one signed</span>}
                </Row>
              </>
            ) : (
              <Row label="Signed by">core, on your behalf (no key loaded in this browser)</Row>
            )}
          </dl>
          <div>
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
