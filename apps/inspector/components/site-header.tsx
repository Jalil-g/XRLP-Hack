"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { VerifiedInspectorBadge } from "@/components/verified-badge";
import { API_MODE } from "@/lib/api";
import { BRAND, shortAddress } from "@/lib/utils";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={`${BRAND.name} ${BRAND.app} home`}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h16" />
          <path d="M6 20V11l6-5 6 5v9" />
          <path d="m9.5 14 2 2 3.5-4" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">
        {BRAND.name} <span className="font-normal text-muted">{BRAND.app}</span>
      </span>
    </Link>
  );
}

function IdentityPicker() {
  const { status, inspectors, inspector, select } = useIdentity();
  if (status !== "ready" || !inspector) {
    return <span className="text-xs text-faint">{status === "error" ? "Panel unavailable" : "Loading panel…"}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <VerifiedInspectorBadge inspector={inspector} />
      <label className="relative">
        <span className="sr-only">Signed in as</span>
        <select
          value={inspector.address}
          onChange={(e) => select(e.target.value)}
          className="h-8 appearance-none rounded-md border border-line-strong bg-surface pr-8 pl-3 text-[13px] font-medium text-ink shadow-xs hover:bg-subtle focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
        >
          {inspectors.map((i) => (
            <option key={i.address} value={i.address}>
              {i.name} · {shortAddress(i.address)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-2 right-2.5 size-4 text-muted" />
      </label>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted md:inline-flex">
            <span className="size-2 rounded-full bg-emerald-500" />
            {BRAND.network}
            <span className="text-faint">· {API_MODE === "mock" ? "mock data" : "core"}</span>
          </span>
          <IdentityPicker />
        </div>
      </div>
    </header>
  );
}
