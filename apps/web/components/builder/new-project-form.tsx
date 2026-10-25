"use client";

// Route 3: a builder submits a project as a Schedule of Values. Templates are pre-filled SoVs derived from the contract's
// MILESTONE_TEMPLATES; the evidence and checks on each line are read-only (the builder does not get to define "done"):
// a lock with the tooltip "Set by template" says so instead of a paragraph. Review → Edit keeps the draft.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Loader2, Lock, Plus, X } from "lucide-react";
import { MILESTONE_TEMPLATES } from "@xrlp/shared";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { Properties } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { validAmount } from "./amount";
import { ApiError, api } from "@/lib/api";
import type { BuilderDocument, ProjectType, SovLine } from "@/lib/contract";
import { PROJECT_TYPE } from "@/lib/display";
import { cn, formatAmount, fromCents, toCents } from "@/lib/utils";

const TRADE: Record<string, string> = {
  foundation: "Concrete",
  framing: "Carpentry",
  dry_in: "Roofing",
  finish: "Finishes",
  demo_rough: "Demolition and MEP",
  site_foundation: "Sitework",
  structure: "Structure",
  fitout: "Fit-out",
};

const DOCUMENTS: { kind: BuilderDocument["kind"]; label: string; filename: string }[] = [
  { kind: "license", label: "Contractor licence", filename: "contractor-licence.pdf" },
  { kind: "insurance", label: "Certificate of insurance", filename: "insurance-coi.pdf" },
  { kind: "entity", label: "Entity filing", filename: "entity-filing.pdf" },
  { kind: "permit", label: "Building permit", filename: "building-permit.pdf" },
  { kind: "plans", label: "Stamped plans", filename: "stamped-plans.pdf" },
];

type Row = { id: number; line: SovLine; fromTemplate: boolean };

function templateRows(type: ProjectType, principalCents: number): Row[] {
  const t = MILESTONE_TEMPLATES[type];
  let left = principalCents;
  return t.map((m, i) => {
    const cents = i === t.length - 1 ? left : Math.round((principalCents * m.defaultShare) / 10_000) * 10_000; // nearest 100 RLUSD
    left -= cents;
    return {
      id: i,
      fromTemplate: true,
      line: { code: m.key, title: m.title, amount: fromCents(cents), trade: TRADE[m.key] ?? "General", evidence: m.requiredEvidence, visualCriteria: m.visualCriteria },
    };
  });
}

const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export function NewProjectForm({ builderId, builderName }: { builderId: string; builderName: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>("residential_new");
  const [siteAddress, setSiteAddress] = useState("");
  const [description, setDescription] = useState("");
  const [principal, setPrincipal] = useState("100000");
  const [rate, setRate] = useState("10.5");
  const [months, setMonths] = useState("12");
  const [deadline, setDeadline] = useState(addDays(21));
  const [rows, setRows] = useState<Row[]>(() => templateRows("residential_new", 10_000_000));
  const [docs, setDocs] = useState(() => new Set(DOCUMENTS.map((d) => d.kind)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const principalCents = validAmount(principal) ? toCents(principal) : 0;
  const totalCents = useMemo(() => rows.reduce((total, row) => total + (validAmount(row.line.amount) ? toCents(row.line.amount) : 0), 0), [rows]);
  const diff = totalCents - principalCents;
  const problems = [
    !name.trim() && "Name the project",
    !siteAddress.trim() && "Add the site address",
    !validAmount(principal) && "Enter a principal, up to 2 decimals",
    (!Number.isFinite(Number(rate)) || !rate.trim() || Number(rate) < 0 || Number(rate) > 100) && "Rate must be 0 to 100%",
    (!Number.isInteger(Number(months)) || Number(months) <= 0 || Number(months) > 120) && "Term must be 1 to 120 whole months",
    (!Number.isFinite(Date.parse(deadline)) || Date.parse(`${deadline}T16:00:00Z`) <= Date.now()) && "Pick a future closing date",
    rows.length === 0 && "Add a schedule line",
    rows.some((row) => !validAmount(row.line.amount) || !row.line.title.trim() || !row.line.code.trim() || !row.line.trade.trim()) && "Fill in code, work, trade and amount on every line",
    diff !== 0 && principalCents > 0 && `Lines total ${formatAmount(fromCents(totalCents))}, not the principal`,
  ].filter(Boolean) as string[];

  const update = (id: number, patch: Partial<SovLine>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, line: { ...r.line, ...patch } } : r)));

  const submit = async () => {
    if (busy || problems.length || !reviewing) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({
        name: name.trim(),
        type,
        builderId,
        siteAddress: siteAddress.trim(),
        siteGeo: { lat: 41.9312, lng: -74.0004, radiusM: 60 },
        description: description.trim(),
        terms: {
          principal: fromCents(principalCents),
          interestRateBps: Math.round(Number(rate) * 100),
          termDays: Math.round(Number(months) * 30.4),
          paymentIntervalDays: 30,
          fundingDeadline: new Date(`${deadline}T16:00:00Z`).toISOString(),
        },
        sov: rows.map((r) => r.line),
        documents: DOCUMENTS.filter((d) => docs.has(d.kind)).map((d) => ({ kind: d.kind, filename: d.filename })),
      });
      router.push(`/projects/${project.id}/verification`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Could not create the project");
      setBusy(false);
    }
  };

  if (reviewing)
    return (
      <section aria-labelledby="review-title" className="max-w-[720px] space-y-8">
        <h2 id="review-title" className="text-heading">
          Review {name}
        </h2>
        <Properties
          labelWidth={150}
          items={[
            { label: "Builder", value: builderName },
            { label: "Site", value: siteAddress },
            { label: "Principal", value: <span className="font-semibold tabular-nums">{formatAmount(principal, { cents: true })} RLUSD</span> },
            { label: "Rate", value: <span className="tabular-nums">{rate}%</span> },
            { label: "Term", value: <span className="tabular-nums">{months} months</span> },
            { label: "Funding closes", value: deadline },
            { label: "Documents", value: <span className="tabular-nums">{docs.size} of {DOCUMENTS.length}</span> },
          ]}
        />
        <div>
          <h3 className="text-[17px] leading-6 font-semibold tracking-[-0.01em]">Schedule of Values</h3>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {rows.map((row) => (
              <li key={row.id} className="flex justify-between gap-4 py-2.5 text-small">
                <span className="min-w-0 break-words">{row.line.title}</span>
                <span className="shrink-0 tabular-nums">{formatAmount(row.line.amount, { cents: true })}</span>
              </li>
            ))}
          </ul>
        </div>
        {error && (
          <p role="alert" className="rounded-control bg-fail-bg px-3 py-2.5 text-small text-fail">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" size="lg" disabled={busy} onClick={() => setReviewing(false)}>
            Edit project
          </Button>
          <Button size="lg" disabled={busy || problems.length > 0} onClick={() => void submit()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {busy ? "Creating project…" : "Create project"}
          </Button>
        </div>
      </section>
    );

  return (
    <div className="space-y-14">
      <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="h-project" className="grid gap-5">
          <h2 id="h-project" className={H2}>
            Project
          </h2>
          <Field label="Name" id="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cedar Ln ADU" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Type" id="type">
              <Select
                id="type"
                value={type}
                onChange={(e) => {
                  const t = e.target.value as ProjectType;
                  setType(t);
                  setRows(templateRows(t, principalCents || 10_000_000));
                }}
              >
                {(Object.keys(PROJECT_TYPE) as ProjectType[]).map((t) => (
                  <option key={t} value={t}>
                    {PROJECT_TYPE[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Site address" id="site">
              <Input id="site" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="9 Cedar Ln, Woodstock, NY 12498" />
            </Field>
          </div>
          <Field label="Description" id="desc">
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What gets built, and how the loan is repaid" />
          </Field>
        </section>

        <section aria-labelledby="h-terms" className="grid gap-5">
          <h2 id="h-terms" className={H2}>
            Loan terms
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
            <Field label="Principal (RLUSD)" id="principal">
              <Input id="principal" inputMode="decimal" className="tabular" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-5">
              <Field label="Rate (% a year)" id="rate">
                <Input id="rate" inputMode="decimal" className="tabular" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
              <Field label="Term (months)" id="months">
                <Input id="months" inputMode="numeric" className="tabular" value={months} onChange={(e) => setMonths(e.target.value)} />
              </Field>
            </div>
            <Field label="Funding closes" id="deadline">
              <Input id="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          </div>
        </section>
      </div>

      <section aria-labelledby="h-sov" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <h2 id="h-sov" className={H2}>
            Schedule of Values
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
            <span className={cn("flex items-center gap-1.5 font-medium tabular-nums", diff === 0 ? "text-pass" : "text-fail")}>
              {diff === 0 ? <Check className="size-4" aria-hidden /> : null}
              {formatAmount(fromCents(totalCents))} of {formatAmount(fromCents(principalCents))}
              {diff !== 0 && <span className="font-normal">({diff > 0 ? "over" : "under"} {formatAmount(fromCents(Math.abs(diff)))})</span>}
            </span>
            <Button variant="quiet" size="sm" onClick={() => setRows(templateRows(type, principalCents || 10_000_000))}>
              Reset to template
            </Button>
          </div>
        </div>
        <div role="region" aria-label="Edit Schedule of Values" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-caption text-ink-2">
                <th className="w-[130px] px-2 py-2 font-medium">Code</th>
                <th className="px-2 py-2 font-medium">Work</th>
                <th className="w-[150px] px-2 py-2 font-medium">Trade</th>
                <th className="w-[140px] px-2 py-2 text-right font-medium">Amount</th>
                <th className="w-[260px] px-2 py-2 font-medium">Evidence</th>
                <th className="w-11" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line align-middle">
                  <td className="px-2 py-2">
                    <Input aria-label="Code" className="h-11 text-small" value={r.line.code} onChange={(e) => update(r.id, { code: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <Input aria-label="Work" className="h-11 text-small" value={r.line.title} onChange={(e) => update(r.id, { title: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <Input aria-label="Trade" className="h-11 text-small" value={r.line.trade} onChange={(e) => update(r.id, { trade: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label="Amount"
                      inputMode="decimal"
                      className="tabular h-11 text-right text-small"
                      value={r.line.amount}
                      onChange={(e) => update(r.id, { amount: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <LockedEvidence line={r.line} />
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                      className="flex size-11 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-band hover:text-ink"
                      aria-label={`Remove ${r.line.title || "line"}`}
                    >
                      <X className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { id: Math.max(-1, ...rs.map((x) => x.id)) + 1, fromTemplate: false, line: { code: "", title: "", amount: "0", trade: "", evidence: [], visualCriteria: [] } },
            ])
          }
        >
          <Plus aria-hidden />
          Add line
        </Button>
      </section>

      <section aria-labelledby="h-docs" className="max-w-[720px] space-y-3">
        <h2 id="h-docs" className={cn(H2, "flex items-center gap-2.5")}>
          Documents <Tag className="h-5 px-1.5 text-[11px]">Mock</Tag>
        </h2>
        <ul className="divide-y divide-line border-y border-line">
          {DOCUMENTS.map((d) => (
            <li key={d.kind}>
              <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 py-2 text-small">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-action)]"
                  checked={docs.has(d.kind)}
                  onChange={(e) =>
                    setDocs((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(d.kind);
                      else n.delete(d.kind);
                      return n;
                    })
                  }
                />
                <span className="flex-1">{d.label}</span>
                <span className="break-all text-caption text-ink-3">{d.filename}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Submit" className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-6">
        <Button size="lg" disabled={problems.length > 0 || busy} onClick={() => setReviewing(true)}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Review project
        </Button>
        {problems[0] && <p className="text-small text-ink-2">{problems[0]}</p>}
        {error && <p className="w-full rounded-control bg-fail-bg px-3 py-2 text-small text-fail">{error}</p>}
      </section>
    </div>
  );
}

const H2 = "text-[17px] leading-6 font-semibold tracking-[-0.01em]";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What counts as done for a line: set by the template (or during verification for added lines), never by the builder. */
function LockedEvidence({ line }: { line: SovLine }) {
  const locked = line.evidence.length > 0;
  const kinds = (["photo", "invoice", "document"] as const)
    .map((k) => [k, line.evidence.filter((e) => e.kind === k).reduce((a, e) => a + e.minCount, 0)] as const)
    .filter(([, n]) => n > 0);
  const tip = locked ? "Set by template" : "Set in verification";
  const detail = [...line.evidence.map((e) => `${e.minCount} ${e.kind}: ${e.description}`), ...line.visualCriteria.map((c) => `Visual: ${c}`)].join("\n");
  return (
    <span className="flex min-h-11 items-center gap-2 text-small whitespace-nowrap text-ink-2" title={detail ? `${tip}\n${detail}` : tip}>
      <span role="img" aria-label={tip} className="text-ink-3">
        <Lock className="size-3.5" aria-hidden />
      </span>
      {locked ? kinds.map(([k, n]) => plural(n, k)).join(", ") : <span className="text-ink-3">{tip}</span>}
    </span>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
