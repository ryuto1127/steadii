import { cn } from "@/lib/utils/cn";

export function ProgressDots({
  total,
  current,
}: {
  total: number;
  current: number;
}) {
  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={`Step ${current} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        return (
          <span
            key={n}
            aria-hidden
            className={cn(
              "h-1.5 w-8 rounded-full transition-default",
              n < current
                ? "bg-[hsl(var(--primary))]"
                : n === current
                ? "bg-[hsl(var(--foreground))]"
                : "bg-[hsl(var(--surface-raised))]"
            )}
          />
        );
      })}
      <span className="ml-3 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
        step {current} of {total}
      </span>
    </div>
  );
}
