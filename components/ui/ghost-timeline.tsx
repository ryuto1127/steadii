import { cn } from "@/lib/utils/cn";

// Empty-state placeholder for the TODAY card — renders hour rows with
// faded hash marks so the card never looks blank. When `message` is
// given it's overlaid centered across the grid.
const HOURS = [6, 9, 12, 15, 18, 21];

export function GhostTimeline({
  message,
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative py-1", className)}>
      <ul className="space-y-1.5">
        {HOURS.map((h) => (
          <li
            key={h}
            className="flex items-center gap-3 text-[11px] leading-none text-[hsl(var(--muted-foreground))]"
          >
            <span className="w-10 font-mono tabular-nums opacity-70">
              {h.toString().padStart(2, "0")}:00
            </span>
            <span
              aria-hidden
              className="h-px flex-1 border-t border-dashed border-[hsl(var(--border))]"
            />
          </li>
        ))}
      </ul>
      {message ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-live="polite"
        >
          <span className="rounded-md border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-[11px] text-[hsl(var(--muted-foreground))]">
            {message}
          </span>
        </div>
      ) : null}
    </div>
  );
}
