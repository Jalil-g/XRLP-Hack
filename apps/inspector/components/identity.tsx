"use client";
// Demo identity (no auth, docs/05-api.md §1): which panel inspector is using the app. Persisted in localStorage.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Inspector } from "@/lib/types";

const STORAGE_KEY = "drawproof.inspector";

type Identity = {
  status: "loading" | "ready" | "error";
  error?: string;
  inspectors: Inspector[];
  inspector: Inspector | null;
  select(address: string): void;
};

const IdentityContext = createContext<Identity | null>(null);

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<Identity["status"]>("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    api
      .listInspectors()
      .then((panel) => {
        if (!live) return;
        const saved = localStorage.getItem(STORAGE_KEY);
        setInspectors(panel);
        setAddress(panel.find((i) => i.address === saved)?.address ?? panel[0]?.address ?? null);
        setStatus("ready");
      })
      .catch((err: Error) => {
        if (!live) return;
        setError(err.message);
        setStatus("error");
      });
    return () => {
      live = false;
    };
  }, []);

  const select = useCallback((next: string) => {
    setAddress(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<Identity>(
    () => ({ status, error, inspectors, inspector: inspectors.find((i) => i.address === address) ?? null, select }),
    [status, error, inspectors, address, select],
  );
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): Identity {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return value;
}
