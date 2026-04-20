import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import {
  getDate,
  getSelect,
  getTitle,
  listFromDatabase,
} from "@/lib/views/notion-list";
import { ListFilter } from "@/components/views/list-filter";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ status?: string; q?: string }>;

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const rows = await listFromDatabase({
    userId: session.user.id,
    databaseSelector: "assignmentsDbId",
  });

  const items = rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: getTitle(r),
    status: getSelect(r, "Status"),
    priority: getSelect(r, "Priority"),
    due: getDate(r, "Due"),
  }));

  const filtered = items
    .filter((i) => (params.status ? i.status === params.status : true))
    .filter((i) =>
      params.q ? i.title.toLowerCase().includes(params.q.toLowerCase()) : true
    )
    .sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-serif text-3xl">Assignments</h1>
      <ListFilter
        fields={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "", label: "all" },
              { value: "Not started", label: "not started" },
              { value: "In progress", label: "in progress" },
              { value: "Done", label: "done" },
            ],
            current: params.status,
          },
        ]}
        searchName="q"
        searchValue={params.q}
      />

      {filtered.length === 0 ? (
        <p className="mt-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Nothing assigned.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[hsl(var(--border))] rounded-xl bg-[hsl(var(--surface))]">
          {filtered.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between px-6 py-4 text-sm"
            >
              <div>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {a.title}
                </a>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                  {[a.status, a.priority, a.due].filter(Boolean).join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
