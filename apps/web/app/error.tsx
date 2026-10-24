"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { API_MODE } from "@/lib/api";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  const unreachable = /unreachable|fetch failed|ECONNREFUSED/i.test(error.message);
  return (
    <div className="mx-auto max-w-[560px] py-20 text-center">
      <h1 className="text-title">{unreachable ? "Can't reach the Drawproof API" : "Something went wrong"}</h1>
      <p className="mt-3 text-body text-ink-2">
        {unreachable
          ? `The app is in ${API_MODE} mode and core did not answer. Start it with pnpm --filter @xrlp/core serve, or set NEXT_PUBLIC_API_MODE=mock.`
          : error.message}
      </p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
