import { Check, LockKeyhole } from "lucide-react";

export function ProcessFeedback({ state, title, detail }: { state: "pending" | "complete" | "held"; title: string; detail?: string }) {
  return <div className="space-y-4">
    <div className="process-scene" data-state={state} aria-hidden="true"><span className="process-orbit" /><span className="process-document"><span className="process-scan" /></span>{state !== "pending" && <span className="process-seal">{state === "complete" ? <Check className="size-5" /> : <LockKeyhole className="size-4" />}</span>}</div>
    <div role="status" className="text-center"><p className="text-small font-semibold">{title}</p>{detail && <p className="mx-auto mt-1 max-w-[44ch] text-caption text-ink-2">{detail}</p>}</div>
  </div>;
}
