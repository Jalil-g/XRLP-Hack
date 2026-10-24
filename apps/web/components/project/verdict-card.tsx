import { AlertTriangle, CheckCircle2, MinusCircle, ScanSearch, Sparkles, XCircle } from "lucide-react";
import type { CheckResult, Verdict } from "@xrlp/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PROJECT_TYPE, RISK_TIER, VERDICT, checkLabel } from "@/lib/display";
import { cn, formatDateTime } from "@/lib/utils";

const CHECK_ICON: Record<CheckResult["result"], { icon: typeof CheckCircle2; className: string }> = {
  pass: { icon: CheckCircle2, className: "text-ok" },
  fail: { icon: XCircle, className: "text-bad" },
  warn: { icon: AlertTriangle, className: "text-warn" },
  skipped: { icon: MinusCircle, className: "text-faint" },
};

export function VerdictCard({ verdict, className }: { verdict: Verdict | null; className?: string }) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="items-center py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
            <Sparkles className="size-4" />
          </span>
          <CardTitle>AI evidence verdict</CardTitle>
        </div>
        {verdict && (
          <Badge tone={VERDICT[verdict.decision].tone} className="px-2.5 py-1 text-[13px]">
            {verdict.decision === "pass" ? <CheckCircle2 /> : verdict.decision === "fail" ? <XCircle /> : <AlertTriangle />}
            {VERDICT[verdict.decision].label}
          </Badge>
        )}
      </CardHeader>

      {!verdict ? (
        <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <ScanSearch className="size-6 text-faint" />
          <p className="text-sm font-medium text-ink-2">No verdict yet</p>
          <p className="max-w-xs text-[13px] text-muted">
            When the builder submits evidence, the AI checks location, timing, duplicates, documents and budget.
          </p>
        </CardContent>
      ) : (
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm leading-relaxed text-ink-2">{verdict.summary}</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-muted">Confidence</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                <div
                  className={cn("h-full rounded-full", verdict.decision === "pass" ? "bg-ok" : verdict.decision === "fail" ? "bg-bad" : "bg-warn")}
                  style={{ width: `${Math.round(verdict.confidence * 100)}%` }}
                />
              </div>
              <span className="tabular text-xs font-medium text-ink-2">{Math.round(verdict.confidence * 100)}%</span>
            </div>
          </div>

          <ul className="divide-y divide-line rounded-lg border border-line">
            {verdict.checks.map((c) => {
              const { icon: Icon, className } = CHECK_ICON[c.result];
              return (
                <li key={c.check} className={cn("flex gap-3 px-3 py-2.5", c.result === "fail" && "bg-bad-bg/60")}>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-label={c.result} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink">{checkLabel(c)}</div>
                    <div className="text-[13px] text-muted">{c.reason}</div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
            <span>
              Policy: {PROJECT_TYPE[verdict.policy.projectType]} · {RISK_TIER[verdict.policy.riskTier].label} ·{" "}
              {verdict.policy.requiredInspectors} inspector{verdict.policy.requiredInspectors > 1 ? "s" : ""}
            </span>
            <span>Model: {verdict.model === "mock" ? "mock verifier" : verdict.model}</span>
            <span>{formatDateTime(verdict.createdAt)}</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
