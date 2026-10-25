import { Camera, ClipboardCheck, FileSearch, PenLine, ShieldCheck } from "lucide-react";
import Link from "next/link";

export function AuditWorkspace({ children, siteVisit = false }: { children: React.ReactNode; siteVisit?: boolean }) {
  const sections = [
    { id: siteVisit ? "site" : "evidence", label: siteVisit ? "Site" : "Evidence", icon: FileSearch },
    { id: siteVisit ? "answers" : "checklist", label: "Checklist", icon: ClipboardCheck },
    { id: "photos", label: "Site photos", icon: Camera },
    { id: "review", label: "Review", icon: ShieldCheck },
    ...(!siteVisit ? [{ id: "sign", label: "Sign", icon: PenLine }] : []),
  ];
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="rounded-panel border border-line bg-surface p-5 lg:sticky lg:top-24">
        <p className="mb-4 text-[22px] leading-[30px]">{siteVisit ? "Site visit" : "Milestone audit"}</p>
        <nav aria-label="Audit sections" className="flex flex-col">
          {sections.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#${id}`} className="flex min-h-11 items-center gap-2.5 rounded-control px-2 text-[15px] hover:bg-band">
              <Icon className="size-4" strokeWidth={1.5} aria-hidden />{label}
            </a>
          ))}
        </nav>
        <p className="my-5 border-t border-line pt-4 text-small text-ink-2">Your report records observations. It does not release funds.</p>
        <Link href="/" className="inline-flex min-h-11 items-center text-small underline">Back to queue</Link>
      </aside>
      <div className="min-w-0 space-y-10 rounded-panel border border-line bg-surface px-5 py-7 sm:px-8">{children}</div>
    </div>
  );
}
