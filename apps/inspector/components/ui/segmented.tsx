// One answer per line (checklist status, site-visit answers): an iOS-style segmented control. The chosen segment lifts onto
// white and its icon takes the state colour; the label always says it in words.
import { cn } from "@/lib/utils";

export type Segment<V extends string> = { value: V; label: string; Icon?: React.ComponentType<{ className?: string }>; tone: "pass" | "review" | "fail" };

const TONE = { pass: "text-pass", review: "text-review-icon", fail: "text-fail" } as const;

export function Segmented<V extends string>({ label, options, value, onChange, invalid, className }: {
  label: string;
  options: Segment<V>[];
  value?: V;
  onChange(next: V): void;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex rounded-full bg-band p-0.5", invalid && "ring-2 ring-fail", className)}>
      {options.map(({ value: v, label: text, Icon, tone }) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 text-caption font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
              on ? "bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.06)]" : "text-ink-2 hover:text-ink",
            )}
          >
            {Icon && <Icon className={cn("size-4", on ? TONE[tone] : "text-ink-3")} />}
            {text}
          </button>
        );
      })}
    </div>
  );
}
