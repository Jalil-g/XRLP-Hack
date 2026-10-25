"use client";

// Where the money is, as a flow: Vault → Project account → Escrows → Builder. Amounts come from route 2 snapshots.
// When a value changes (release, refund, repayment) the node flashes once, so the movement is visible on stage.
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

  return <ol className="money-map" aria-label="Money map">{nodes.map((node, index) => <li key={node.key} className={cn("money-node", flash[node.key] && "money-node-flash")}><div className="flex items-center justify-between gap-2"><span className="text-caption text-ink-2">{node.label}</span><span className="font-mono text-[10px] text-ink-2">0{index + 1}</span></div><p className={cn("mt-3 tabular text-[24px] font-medium tracking-tight", node.tone === "pass" && "text-pass")}>{formatAmount(node.amount)}<span className="ml-1 text-[10px] font-normal tracking-normal text-ink-2">RLUSD</span></p><p className="mt-2 text-caption text-ink-2">{node.note}</p></li>)}</ol>;
}
