"use client";
// Which key will sign this audit's attestation. Mock: the fixture inspector's public-entropy key. http: a devnet seed the
// inspector imports into this browser (never sent anywhere: signing happens here, only the signed blob goes to core).
// With a key loaded it is plumbing (shown in Proof); without one, loading a key is a task, so the form sits in the page.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { forgetKey, importKey, type InspectorKey } from "@/lib/signing";
import { shortAddress } from "@/lib/utils";

/** The loaded key, inline: signing address plus "Forget key" for an imported seed. */
export function SigningKey({ address, inspectorKey, onChange }: { address: string; inspectorKey: InspectorKey; onChange(): void }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3"
      title={inspectorKey.source === "mock" ? "Mock key from public test entropy. Core verifies the signature and memo before filing." : "Software key imported into this browser (devnet). Only the signed attestation leaves it."}>
      <span className="font-mono">{shortAddress(address, 8, 6)}</span>
      {inspectorKey.source === "imported" && (
        <button type="button" className="min-h-11 font-medium text-ink-2 underline hover:text-ink" onClick={() => { forgetKey(address); onChange(); }}>
          Forget key
        </button>
      )}
    </span>
  );
}

export function SigningPanel({ address, inspectorKey, onChange }: { address: string; inspectorKey: InspectorKey | null; onChange(): void }) {
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string>();

  if (inspectorKey) return <SigningKey address={address} inspectorKey={inspectorKey} onChange={onChange} />;

  return (
    <form
      className="space-y-2"
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
      <label htmlFor="inspector-seed" className="block text-small font-medium" title="Stored in this browser only (devnet). Without a key, core attests the audit on your behalf.">
        Inspector key
      </label>
      <div className="flex gap-2">
        <input
          id="inspector-seed"
          type="password"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Devnet seed (s…)"
          autoComplete="off"
          spellCheck={false}
          aria-label="Inspector seed"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-line-2 bg-surface px-3 font-mono text-small placeholder:font-sans placeholder:text-ink-3"
        />
        <Button type="submit" variant="secondary" disabled={!seed.trim()}>
          Load key
        </Button>
      </div>
      {error && <p className="text-caption text-fail">{error}</p>}
    </form>
  );
}
