"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server components every `ms` while the tab is visible, so demo actions show up live. */
export function AutoRefresh({ ms = 3000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      // A final deposit can change the project to funded and unmount its dialog.
      // Let the investor finish reading the transfer receipt before refreshing.
      if (document.visibilityState === "visible" && !document.querySelector('[data-pause-auto-refresh="true"]')) router.refresh();
    }, ms);
    return () => clearInterval(id);
  }, [router, ms]);
  return null;
}
