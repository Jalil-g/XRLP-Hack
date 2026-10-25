export function LoadingState({ label = "Loading inspector workspace…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-6">
      <p className="sr-only">{label}</p>
      <div aria-hidden="true" className="space-y-4">
        <div className="h-4 w-24 rounded-full bg-band" />
        <div className="h-10 w-1/3 rounded-control bg-band" />
        <div className="h-px bg-line" />
        <div className="h-14 rounded-control bg-band/70" />
        <div className="h-14 rounded-control bg-band/70" />
      </div>
    </div>
  );
}
