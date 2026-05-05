type StatBucket = {
  label: string;
  archived: number;
  draftsSent: number;
  proposalsResolved: number;
  calendarImports: number;
};

// Stats grid for the /app/activity page header. Four mini-cards
// horizontally: This Week / This Month / All Time / Time Saved. The
// time-saved cell shows the all-time aggregate; per-window time-saved
// estimates are too noisy to surface as their own narrow cards.
export function ActivityStatsCard({
  thisWeek,
  thisMonth,
  allTime,
  timeSavedFormatted,
  labels,
}: {
  thisWeek: StatBucket;
  thisMonth: StatBucket;
  allTime: StatBucket;
  timeSavedFormatted: string;
  labels: {
    statsHeading: string;
    timeSaved: string;
    timeSavedCaption: string;
    archivedShort: string;
    draftedShort: string;
    calendarShort: string;
  };
}) {
  return (
    <section
      aria-labelledby="activity-stats"
      className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <h2 id="activity-stats" className="sr-only">
        {labels.statsHeading}
      </h2>
      {[thisWeek, thisMonth, allTime].map((bucket, idx) => (
        <Cell key={idx} label={bucket.label}>
          <ValueRow left={labels.archivedShort} value={bucket.archived} />
          <ValueRow left={labels.draftedShort} value={bucket.draftsSent} />
          <ValueRow
            left={labels.calendarShort}
            value={bucket.calendarImports}
          />
        </Cell>
      ))}
      <Cell label={labels.timeSaved} highlight>
        <div className="font-mono text-[28px] font-semibold tabular-nums text-[hsl(var(--foreground))]">
          {timeSavedFormatted}
        </div>
        <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          {labels.timeSavedCaption}
        </div>
      </Cell>
    </section>
  );
}

function Cell({
  label,
  highlight = false,
  children,
}: {
  label: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        highlight
          ? "flex flex-col rounded-lg border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--surface))] to-[hsl(var(--surface-raised))] p-4"
          : "flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
      }
    >
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
        {label}
      </div>
      {children}
    </div>
  );
}

function ValueRow({ left, value }: { left: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[13px]">
      <span className="text-[hsl(var(--muted-foreground))]">{left}</span>
      <span className="font-mono font-semibold tabular-nums text-[hsl(var(--foreground))]">
        {value}
      </span>
    </div>
  );
}
