import { Card, CardContent } from "@/components/ui/card";

export function LoadingState({ label = "Loading inspector workspace…" }: { label?: string }) {
  return (
    <Card role="status" aria-live="polite" aria-busy="true">
      <CardContent className="space-y-6">
        <p className="text-small font-medium">{label}</p>
        <div aria-hidden="true" className="space-y-4">
          <div className="h-5 w-2/3 rounded bg-subtle" />
          <div className="h-4 w-1/2 rounded bg-subtle" />
          <div className="h-24 rounded-control bg-subtle" />
        </div>
      </CardContent>
    </Card>
  );
}
