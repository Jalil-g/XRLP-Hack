"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Session-local: never changes signing identity, API mode, or saved audit data. */
export function ProjectorToggle() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.projector = String(enabled);
    return () => { delete document.documentElement.dataset.projector; };
  }, [enabled]);
  return (
    <Button variant="secondary" size="sm" aria-pressed={enabled}
      onClick={() => setEnabled((value) => !value)} title="Larger text and stronger contrast for the demo screen">
      Projector {enabled ? "on" : "off"}
    </Button>
  );
}
