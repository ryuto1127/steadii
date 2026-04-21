export default function ChatsLoading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-9 w-32 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
      </div>
      <div className="flex flex-col divide-y divide-[hsl(var(--border)/0.6)] rounded-md border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface))]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3"
            style={{ opacity: 1 - i * 0.12 }}
          >
            <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-[hsl(var(--border)/0.5)]" />
            <div className="h-4 flex-1 animate-pulse rounded bg-[hsl(var(--border)/0.4)]" />
            <div className="h-3 w-16 animate-pulse rounded bg-[hsl(var(--border)/0.4)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
