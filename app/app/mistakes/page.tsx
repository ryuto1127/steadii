import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import {
  getDate,
  getMultiSelect,
  getRichText,
  getSelect,
  getTitle,
  listFromDatabase,
} from "@/lib/views/notion-list";
import { ListFilter } from "@/components/views/list-filter";
import { checkDatabaseHealth } from "@/lib/views/notion-health";
import { DeadDbBanner } from "@/components/views/dead-db-banner";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ subject?: string; difficulty?: string; q?: string }>;

export default async function MistakesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const health = await checkDatabaseHealth({
    userId: session.user.id,
    databaseSelector: "mistakesDbId",
  });
  if (!health.ok) {
    return <DeadDbBanner title="Mistake Notes" reason={health.reason} />;
  }

  const rows = await listFromDatabase({
    userId: session.user.id,
    databaseSelector: "mistakesDbId",
    limit: 100,
  });

  const items = rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: getTitle(r),
    unit: getRichText(r, "Unit"),
    difficulty: getSelect(r, "Difficulty"),
    tags: getMultiSelect(r, "Tags"),
    date: getDate(r, "Date"),
  }));

  const filtered = items
    .filter((i) => (params.difficulty ? i.difficulty === params.difficulty : true))
    .filter((i) =>
      params.q
        ? [i.title, i.unit, i.tags.join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(params.q.toLowerCase())
        : true
    );

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-serif text-3xl">Mistake Notes</h1>
      <ListFilter
        fields={[
          {
            name: "difficulty",
            label: "Difficulty",
            options: [
              { value: "", label: "all" },
              { value: "easy", label: "easy" },
              { value: "medium", label: "medium" },
              { value: "hard", label: "hard" },
            ],
            current: params.difficulty,
          },
        ]}
        searchName="q"
        searchValue={params.q}
      />

      {filtered.length === 0 ? (
        <p className="mt-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No mistake notes yet.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[hsl(var(--border))] rounded-xl bg-[hsl(var(--surface))]">
          {filtered.map((m) => (
            <li key={m.id} className="px-6 py-4 text-sm">
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                {m.title}
              </a>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {[m.difficulty, m.unit, m.date].filter(Boolean).join(" · ")}
              </p>
              {m.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-[hsl(var(--surface-raised))] px-2 py-0.5 text-[11px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
