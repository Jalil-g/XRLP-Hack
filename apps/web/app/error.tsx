"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { errorFeedback } from "@/lib/error-feedback";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  const feedback = errorFeedback(error);
  return (
    <div className="finance-surface mx-auto max-w-[640px] py-12 text-center">
      <h1 className="text-title">{feedback.title}</h1>
      <p className="mt-3 text-body text-ink-2">
        {feedback.description}
      </p>
      <Button className="mt-8" onClick={reset}>
        Refresh page
      </Button>
      <Link href="/" className="ml-4 text-small text-link hover:underline">Back to projects</Link>
      {error.digest && <p className="mt-4 text-caption text-ink-2">Support reference: {error.digest}</p>}
    </div>
  );
}
