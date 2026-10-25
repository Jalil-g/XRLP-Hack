"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Presentation only; kept in the shared layout across client-side navigation. */
export function ProjectorToggle() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.projector = String(enabled);
    return () => { delete document.documentElement.dataset.projector; };
  }, [enabled]);
  return (
    <Button variant="secondary" size="sm" aria-pressed={enabled}
      title="Larger text and stronger contrast for presenting"
      onClick={() => setEnabled((value) => !value)}>
      Projector {enabled ? "on" : "off"}
    </Button>
  );
}
