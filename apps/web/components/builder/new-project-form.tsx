"use client";

// Route 3: a builder submits a project as a Schedule of Values. Templates are pre-filled SoVs derived from the contract's
// MILESTONE_TEMPLATES; the evidence and checks on each line are read-only (the builder does not get to define "done").
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { MILESTONE_TEMPLATES } from "@xrlp/shared";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { Tag } from "@/components/ui/tag";
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

  const principalCents = toCents(principal.replace(/[^\d.]/g, ""));
  const totalCents = useMemo(() => rows.reduce((a, r) => a + toCents(r.line.amount), 0), [rows]);
  const diff = totalCents - principalCents;
  const problems = [
    !name.trim() && "Name the project",
    !siteAddress.trim() && "Add the site address",
    principalCents <= 0 && "Set the principal",
    rows.length === 0 && "Add at least one Schedule of Values line",
    diff !== 0 && principalCents > 0 && `Lines total ${formatAmount(fromCents(totalCents))} RLUSD; they must equal the principal`,
  ].filter(Boolean) as string[];

  const update = (id: number, patch: Partial<SovLine>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, line: { ...r.line, ...patch } } : r)));

  const submit = async () => {
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

  return (
    <div className="space-y-12">
      <section className="grid max-w-[760px] gap-5">
        <h2 className="text-heading">Project</h2>
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
        <Field label="Description" id="desc" hint="What gets built, and how the loan is repaid.">
          <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </section>

      <section className="grid max-w-[760px] gap-5">
        <h2 className="text-heading">Loan terms</h2>
        <div className="grid gap-5 sm:grid-cols-4">
          <Field label="Principal (RLUSD)" id="principal">
            <Input id="principal" inputMode="decimal" className="tabular" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
          <Field label="Rate (% a year)" id="rate">
            <Input id="rate" inputMode="decimal" className="tabular" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label="Term (months)" id="months">
            <Input id="months" inputMode="numeric" className="tabular" value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
          <Field label="Funding closes" id="deadline">
            <Input id="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-heading">Schedule of Values</h2>
          <div className="flex items-center gap-3 text-small">
            <span className={cn("tabular", diff === 0 ? "text-pass" : "text-fail")}>
              {formatAmount(fromCents(totalCents))} of {formatAmount(fromCents(principalCents))} RLUSD
              {diff !== 0 && ` · ${diff > 0 ? "over" : "under"} by ${formatAmount(fromCents(Math.abs(diff)))}`}
            </span>
            <Button variant="quiet" size="sm" onClick={() => setRows(templateRows(type, principalCents || 10_000_000))}>
              Reset to template
            </Button>
          </div>
        </div>
        <p className="max-w-[72ch] text-small text-ink-2">
          Each line becomes part of a milestone escrow. The evidence and checks per line are set by the template, or during verification for lines you add. You
          can change amounts and wording, not what counts as done.
        </p>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-line bg-band text-caption text-ink-2">
              <th className="w-[130px] px-3 py-2.5 font-medium">Code</th>
              <th className="px-3 py-2.5 font-medium">Work</th>
              <th className="w-[160px] px-3 py-2.5 font-medium">Trade</th>
              <th className="w-[150px] px-3 py-2.5 text-right font-medium">Amount (RLUSD)</th>
              <th className="w-[280px] px-3 py-2.5 font-medium">Evidence and checks</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line align-top">
                <td className="px-3 py-2">
                  <Input aria-label="Code" className="h-9 text-small" value={r.line.code} onChange={(e) => update(r.id, { code: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <Input aria-label="Work" className="h-9 text-small" value={r.line.title} onChange={(e) => update(r.id, { title: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <Input aria-label="Trade" className="h-9 text-small" value={r.line.trade} onChange={(e) => update(r.id, { trade: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label="Amount"
                    inputMode="decimal"
                    className="tabular h-9 text-right text-small"
                    value={r.line.amount}
                    onChange={(e) => update(r.id, { amount: e.target.value.replace(/[^\d.]/g, "") || "0" })}
                  />
                </td>
                <td className="px-3 py-2 text-caption text-ink-2" title={r.line.visualCriteria.length ? `Visual criteria: ${r.line.visualCriteria.join("; ")}` : undefined}>
                  {r.line.evidence.length ? (
                    <ul className="space-y-0.5 pt-2">
                      {r.line.evidence.map((ev) => (
                        <li key={ev.description}>
                          {ev.minCount} {ev.kind}
                          {ev.minCount > 1 ? "s" : ""}: {ev.description}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pt-2">Set during verification</p>
                  )}
                </td>
                <td className="py-2 pr-1">
                  <button
                    onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                    className="mt-1.5 rounded-control p-1.5 text-ink-3 transition-colors hover:bg-band hover:text-ink"
                    aria-label={`Remove ${r.line.title}`}
                  >
                    <X className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          Add line
        </Button>
      </section>

      <section className="max-w-[760px] space-y-3">
        <h2 className="text-heading">Documents</h2>
        <p className="text-small text-ink-2">Checked by the AI during verification against mock registries.</p>
        <ul className="divide-y divide-line border-y border-line">
          {DOCUMENTS.map((d) => (
            <li key={d.kind}>
              <label className="flex cursor-pointer items-center gap-3 py-2.5 text-small">
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
                <span className="font-mono text-[12px] text-ink-2">{d.filename}</span>
                <Tag className="h-5 px-1.5 text-[11px]">MOCK</Tag>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
        <Button size="lg" disabled={problems.length > 0 || busy} onClick={submit}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Create project
        </Button>
        <p className="text-small text-ink-2">
          {problems[0] ?? `Submitted as ${builderName}. Next: pay the 250 RLUSD verification fee.`}
        </p>
        {error && <p className="w-full rounded-control bg-fail-bg px-3 py-2 text-small text-fail">{error}</p>}
      </section>
    </div>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-caption text-ink-2">{hint}</p>}
    </div>
  );
}
