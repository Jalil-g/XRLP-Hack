"use client";

// Where the money is, as a flow: Vault → Project account → Escrows → Builder. Amounts come from route 2 snapshots.
// When a value changes (release, refund, repayment) the node flashes once, so the movement is visible on stage.
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn, formatAmount } from "@/lib/utils";

export type MoneyNode = { key: string; label: string; amount: string; note: string; tone?: "pass" | "neutral" };

export function MoneyMap({ nodes }: { nodes: MoneyNode[] }) {
  const prev = useRef<Record<string, string>>({});
  const timers = useRef<number[]>([]);
  const [flash, setFlash] = useState<Record<string, number>>({});

  // Timers live in a ref: the page refreshes every few seconds with new props, which must not cancel a running flash.
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  useEffect(() => {
    const changed = nodes.filter((n) => prev.current[n.key] !== undefined && prev.current[n.key] !== n.amount).map((n) => n.key);
    prev.current = Object.fromEntries(nodes.map((n) => [n.key, n.amount]));
    if (!changed.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stamp = Date.now();
    setFlash((f) => ({ ...f, ...Object.fromEntries(changed.map((k) => [k, stamp])) }));
    timers.current.push(window.setTimeout(() => setFlash((f) => Object.fromEntries(Object.entries(f).filter(([, t]) => t !== stamp))), 1400));
  }, [nodes]);

  return (
    <ol className="money-map grid items-stretch gap-2" style={{ gridTemplateColumns: nodes.map(() => "minmax(0,1fr)").join(" 24px ") }} aria-label="Money map">
      {nodes.flatMap((n, i) => [
        ...(i > 0 ? [<ChevronRight key={`arrow-${n.key}`} className="size-5 self-center justify-self-center text-ink-3" aria-hidden />] : []),
        <li
          key={n.key}
          className={cn(
            "rounded-panel border border-line px-4 py-5 transition-colors duration-700 ease-out",
            flash[n.key] ? (n.tone === "pass" ? "bg-pass-bg" : "bg-info-bg") : "bg-surface",
          )}
        >
          <p className="text-caption text-ink-2">{n.label}</p>
          <p className="tabular mt-0.5 text-heading">
            {formatAmount(n.amount)} <span className="text-small font-normal text-ink-2">RLUSD</span>
          </p>
          <p className="mt-0.5 text-caption text-ink-2">{n.note}</p>
        </li>,
      ])}
    </ol>
  );
}
