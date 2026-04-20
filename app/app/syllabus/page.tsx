import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import {
  getRichText,
  getTitle,
  listFromDatabase,
} from "@/lib/views/notion-list";
import { ListFilter } from "@/components/views/list-filter";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string }>;

export default async function SyllabusListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const rows = await listFromDatabase({
    userId: session.user.id,
    databaseSelector: "syllabiDbId",
  });

  const items = rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: getTitle(r),
    term: getRichText(r, "Term"),
    textbooks: getRichText(r, "Textbooks"),
  }));

  const filtered = params.q
    ? items.filter((i) =>
        [i.title, i.term, i.textbooks]
          .join(" ")
          .toLowerCase()
          .includes(params.q!.toLowerCase())
      )
    : items;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">Syllabi</h1>
        <Link
          href="/app/syllabus/new"
          className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
        >
          Upload
        </Link>
      </div>

      <ListFilter fields={[]} searchName="q" searchValue={params.q} />

      {filtered.length === 0 ? (
        <p className="mt-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No syllabi yet. Upload one.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[hsl(var(--border))] rounded-xl bg-[hsl(var(--surface))]">
          {filtered.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between px-6 py-4 text-sm"
            >
              <div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {s.title}
                </a>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                  {s.term}
                </p>
              </div>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
              >
                Open in Notion →
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
