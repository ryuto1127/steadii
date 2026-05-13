import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { listEntitiesForUser } from "@/lib/agent/entity-graph/lookup";
import type { EntityKind } from "@/lib/db/schema";

// engineer-51 — /app/entities. Read-side list of the user's
// cross-source entity graph, grouped by kind. Each card surfaces
// display name, aliases, last-seen, and links to the detail page.

export const dynamic = "force-dynamic";

const KIND_ORDER: EntityKind[] = [
  "person",
  "project",
  "course",
  "org",
  "event_series",
];

export default async function EntitiesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("entities");

  const all = await listEntitiesForUser({ userId, limit: 500 });
  const groups: Record<EntityKind, typeof all> = {
    person: [],
    project: [],
    course: [],
    org: [],
    event_series: [],
  };
  for (const e of all) {
    groups[e.kind].push(e);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-h2 font-semibold">{t("title")}</h1>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          {t("description")}
        </p>
      </header>

      {all.length === 0 ? (
        <section className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 text-center">
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {t("empty")}
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          {KIND_ORDER.map((kind) => {
            const items = groups[kind];
            if (items.length === 0) return null;
            return (
              <section
                key={kind}
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
              >
                <h2 className="mb-3 flex items-center gap-2 text-body font-medium">
                  <span>{t(`kinds.${kind}`)}</span>
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {items.length}
                  </span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/app/entities/${e.id}`}
                        className="block rounded-md border border-transparent px-3 py-2 transition-hover hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--background))]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-small font-medium">
                              {e.displayName}
                            </p>
                            {e.aliases.length > 0 ? (
                              <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                                {e.aliases.slice(0, 4).join(" · ")}
                              </p>
                            ) : null}
                            {e.description ? (
                              <p className="mt-1 line-clamp-2 text-[12px] text-[hsl(var(--muted-foreground))]">
                                {e.description}
                              </p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">
                            {formatRelative(e.lastSeenAt)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 2) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
