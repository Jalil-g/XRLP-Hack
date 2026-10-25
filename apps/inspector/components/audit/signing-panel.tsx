"use client";
// Which key will sign this audit's attestation. Mock: the fixture inspector's public-entropy key. http: a devnet seed the
// inspector imports into this browser (never sent anywhere: signing happens here, only the signed blob goes to core).
import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { forgetKey, importKey, type InspectorKey } from "@/lib/signing";
import { shortAddress } from "@/lib/utils";

export function SigningPanel({ address, inspectorKey, onChange }: { address: string; inspectorKey: InspectorKey | null; onChange(): void }) {
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string>();

  if (inspectorKey) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-ok-bg px-3 py-2 text-xs text-ok">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            You sign in this browser as <span className="font-mono">{shortAddress(address, 8, 6)}</span>
          </p>
          <p className="text-ok/80">
            {inspectorKey.source === "mock"
              ? "Mock key from public test entropy (never funded). Core verifies the signature and memo before filing."
              : "Software key imported into this browser (devnet). Only the signed attestation leaves it."}
          </p>
        </div>
        {inspectorKey.source === "imported" && (
          <button
            type="button"
            className="shrink-0 underline hover:no-underline"
            onClick={() => {
              forgetKey(address);
              onChange();
            }}
          >
            Forget key
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-2 rounded-md border border-line bg-subtle px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          importKey(address, seed);
          setSeed("");
          setError(undefined);
          onChange();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
        <KeyRound className="size-3.5" /> Load your inspector key to sign in this browser
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder={`Devnet seed for ${shortAddress(address, 6, 4)} (s…)`}
          autoComplete="off"
          spellCheck={false}
          aria-label="Inspector seed"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-xs placeholder:font-sans placeholder:text-faint focus:ring-2 focus:ring-brand-100 focus:outline-none"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!seed.trim()}>
          Load key
        </Button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <p className="text-[11px] text-muted">Stored in this browser only (devnet). Without a key, core attests the audit on your behalf.</p>
    </form>
  );
}
