export default function CalendarLoading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-9 w-40 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
        <div className="flex gap-2">
          <div className="h-8 w-20 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
          <div className="h-8 w-20 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--border)/0.5)]">
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            key={i}
            className="flex h-24 flex-col gap-1.5 bg-[hsl(var(--surface))] p-2"
          >
            <div className="h-3 w-5 animate-pulse rounded bg-[hsl(var(--border)/0.5)]" />
            {i % 4 === 0 ? (
              <div className="h-3 w-3/4 animate-pulse rounded bg-[hsl(var(--border)/0.35)]" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
