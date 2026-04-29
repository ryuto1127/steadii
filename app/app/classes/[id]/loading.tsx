export default function ClassDetailLoading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto max-w-4xl py-2 md:py-6">
      <header className="flex items-start gap-4 pb-4">
        <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[hsl(var(--border)/0.7)]" />
        <div className="flex-1 space-y-2">
          <div className="flex items-baseline gap-3">
            <div className="h-8 w-56 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
            <div className="h-4 w-20 animate-pulse rounded bg-[hsl(var(--surface-raised))]" />
          </div>
          <div className="h-4 w-72 animate-pulse rounded bg-[hsl(var(--surface-raised))]" />
        </div>
      </header>
      <nav className="flex items-center gap-1 border-b border-[hsl(var(--border))]">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="mx-1 my-2 h-5 w-20 animate-pulse rounded bg-[hsl(var(--surface-raised))]"
          />
        ))}
      </nav>
      <div className="mt-6 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-md border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface))] p-4"
          >
            <div className="mt-0.5 h-4 w-4 shrink-0 animate-pulse rounded bg-[hsl(var(--border)/0.5)]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-[hsl(var(--border)/0.4)]" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-[hsl(var(--border)/0.3)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
