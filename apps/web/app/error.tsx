"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { errorFeedback } from "@/lib/error-feedback";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  const feedback = errorFeedback(error);
  return (
    <div className="mx-auto max-w-[640px] py-24 text-center">
      <h1 className="text-title">{feedback.title}</h1>
      <p className="mt-3 text-body text-ink-2">{feedback.description}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>Refresh page</Button>
        <Link href="/" className={buttonClass("quiet")}>Browse projects</Link>
      </div>
      {error.digest && <p className="mt-6 text-caption text-ink-3">Reference {error.digest}</p>}
    </div>
  );
}
