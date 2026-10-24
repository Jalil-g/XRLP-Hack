"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { explorerTxUrl } from "@xrlp/shared";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/client";
import type { DemoAction, DemoStep } from "@/lib/types";
import { cn, shortHash } from "@/lib/utils";

export function DemoSteps({ steps }: { steps: DemoStep[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<DemoAction | null>(null);

  const run = async (action: DemoAction) => {
    setBusy(action);
    try {
      const res = await client.demo(action);
      const last = res.events[res.events.length - 1];
      toast.success(res.message, {
        description: last ? `${res.events.length} tx · ${shortHash(last.txHash)}` : undefined,
        action: last ? { label: "Explorer", onClick: () => window.open(explorerTxUrl(last.txHash), "_blank") } : undefined,
      });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <button
          key={s.action}
          disabled={!s.enabled || busy !== null}
          onClick={() => run(s.action)}
          className={cn(
            "group w-full rounded-xl border bg-surface p-3 text-left shadow-card transition-all",
            s.enabled ? "border-line hover:border-brand hover:ring-2 hover:ring-brand/10" : "cursor-not-allowed border-line opacity-55",
          )}
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                s.enabled ? "bg-brand text-white" : "bg-subtle text-faint",
              )}
            >
              {busy === s.action ? <Loader2 className="size-3.5 animate-spin" /> : s.enabled ? <Play className="size-3 fill-current" /> : s.scriptStep}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ink">{s.title}</div>
              <div className="text-xs leading-snug text-muted">{s.description}</div>
              <div className={cn("mt-1 text-[11.5px] font-medium", s.enabled ? "text-brand" : "text-faint")}>{s.hint}</div>
            </div>
          </div>
        </button>
      ))}
      <Button variant="ghost" size="sm" className="w-full" disabled={busy !== null} onClick={() => run("reset")}>
        <RotateCcw /> Reset demo to start
      </Button>
    </div>
  );
}
