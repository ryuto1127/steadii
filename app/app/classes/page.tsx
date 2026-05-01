import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { loadClasses, loadTimelineForToday } from "@/lib/classes/loader";
import { TimelineStrip } from "@/components/ui/timeline-strip";
import { DenseList } from "@/components/ui/dense-list";
import { DenseRowLink } from "@/components/ui/dense-row-link";
import { EmptyState } from "@/components/ui/empty-state";
import { GraduationCap } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClassesListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("classes_list");
  const tNav = await getTranslations("nav");

  const [classes, timelineDays] = await Promise.all([
    loadClasses(userId),
    loadTimelineForToday(userId),
  ]);

  // Wire each timeline event to its class color by best-effort title match.
  const classesByNameLower = new Map(
    classes.map((c) => [c.name.toLowerCase(), c] as const)
  );
  const enrichedDays = timelineDays.map((d) => ({
    ...d,
    events: d.events.map((e) => {
      const match = [...classesByNameLower.entries()].find(([k]) =>
        e.title.toLowerCase().includes(k)
      );
      return { ...e, color: match?.[1].color ?? null };
    }),
  }));

  const active = classes.filter((c) => c.status !== "archived");

  if (active.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-2 md:py-6">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">{tNav("classes")}</h1>
        <div className="mt-8">
          <EmptyState
            icon={<GraduationCap size={18} strokeWidth={1.5} />}
            title={t("empty_title")}
            description={t("empty_description")}
            actions={[{ label: t("add_class_button"), href: "/app/classes/new" }]}
          />
        </div>
      </div>
    );
  }

  const todaysLabels = classesByLabel(enrichedDays[0]?.events ?? []);
  const tomorrowLabels = classesByLabel(enrichedDays[1]?.events ?? []);

  return (
    <div className="mx-auto max-w-4xl py-2 md:py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">{tNav("classes")}</h1>
        <Link
          href="/app/classes/new"
          className="inline-flex h-9 shrink-0 items-center rounded-md bg-[hsl(var(--primary))] px-3 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
        >
          {t("new_class_button")}
        </Link>
      </div>

      <section className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 sm:p-5">
        <TimelineStrip days={enrichedDays} />
      </section>

      <section className="mt-6">
        <DenseList ariaLabel={t("aria_classes")}>
          {active.map((c) => (
            <DenseRowLink
              key={c.id}
              href={`/app/classes/${c.id}`}
              leadingDot={c.color}
              title={c.code ?? c.name}
              secondary={c.code ? c.name : null}
              metadata={buildMetadata(
                {
                  term: c.term,
                  professor: c.professor,
                  next:
                    todaysLabels.get(c.name) ??
                    tomorrowLabels.get(c.name) ??
                    null,
                  dueCount: c.dueCount,
                  mistakesCount: c.mistakesCount,
                },
                {
                  due: t("metadata_due", { n: c.dueCount }),
                  mistakes: t("metadata_mistakes", { n: c.mistakesCount }),
                }
              )}
            />
          ))}
        </DenseList>
      </section>
    </div>
  );
}

function classesByLabel(events: { title: string; start: Date }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of events) {
    const t = e.start.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    m.set(e.title, t);
  }
  return m;
}

function buildMetadata(
  args: {
    term: string | null;
    professor: string | null;
    next: string | null;
    dueCount: number;
    mistakesCount: number;
  },
  labels: { due: string; mistakes: string }
): string[] {
  const parts: string[] = [];
  if (args.professor) parts.push(args.professor);
  if (args.term) parts.push(args.term);
  if (args.next) parts.push(args.next);
  if (args.dueCount > 0) parts.push(labels.due);
  if (args.mistakesCount > 0) parts.push(labels.mistakes);
  return parts;
}
