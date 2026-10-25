import { Check } from "lucide-react";

export function ProcessFeedback({ complete = false, title, detail }: { complete?: boolean; title: string; detail?: string }) {
  return <div className="space-y-4">
    <div className="process-scene" data-state={complete ? "complete" : "pending"} aria-hidden="true"><span className="process-orbit" /><span className="process-document"><span className="process-scan" /></span>{complete && <span className="process-seal"><Check className="size-5" /></span>}</div>
    <div role="status" className="text-center"><p className="text-small font-semibold">{title}</p>{detail && <p className="mt-1 text-caption text-muted">{detail}</p>}</div>
  </div>;
}
