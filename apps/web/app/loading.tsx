export default function Loading() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-8">
      <p className="text-small text-ink-2">Loading workspace…</p>
      <div className="h-10 w-2/3 rounded-control bg-band" />
      <div className="h-48 rounded-[20px] bg-band" />
      <div className="finance-surface space-y-6" aria-hidden="true">
        {[1, 2, 3].map((row) => <div key={row} className="h-12 border-b border-line bg-band/40" />)}
      </div>
    </div>
  );
}
