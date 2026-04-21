export default function SettingsLoading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto max-w-2xl space-y-8">
      <div className="h-9 w-40 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
      {[0, 1, 2].map((sec) => (
        <section
          key={sec}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 space-y-4"
        >
          <div className="h-5 w-40 animate-pulse rounded bg-[hsl(var(--surface-raised))]" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-[hsl(var(--surface-raised))]" />
          <div className="space-y-2 pt-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="h-4 w-32 animate-pulse rounded bg-[hsl(var(--border)/0.4)]" />
                <div className="h-8 w-24 animate-pulse rounded bg-[hsl(var(--border)/0.4)]" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
