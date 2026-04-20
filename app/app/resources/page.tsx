import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { registeredResources } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  addResourceAction,
  removeResourceAction,
  refreshResourcesAction,
} from "@/app/(auth)/onboarding/actions";
import { isNull } from "drizzle-orm";

export default async function ResourcesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const resources = await db
    .select()
    .from(registeredResources)
    .where(
      and(eq(registeredResources.userId, userId), isNull(registeredResources.archivedAt))
    );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Registered Resources</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Pages and databases the agent can reference.
          </p>
        </div>
        <form action={refreshResourcesAction}>
          <button
            type="submit"
            className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs transition hover:bg-[hsl(var(--surface-raised))]"
          >
            Refresh from Notion
          </button>
        </form>
      </div>

      <form action={addResourceAction} className="mt-8 flex gap-2">
        <input
          name="notion_url"
          placeholder="https://notion.so/..."
          className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          required
        />
        <button
          type="submit"
          className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
        >
          Add
        </button>
      </form>

      <ul className="mt-8 divide-y divide-[hsl(var(--border))] rounded-xl bg-[hsl(var(--surface))]">
        {resources.length === 0 ? (
          <li className="px-6 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No resources registered yet.
          </li>
        ) : (
          resources.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between px-6 py-4 text-sm"
            >
              <div>
                <p className="font-medium">{r.title ?? r.notionId}</p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                  {r.resourceType} · {r.autoRegistered ? "auto" : "manual"}
                </p>
              </div>
              {r.autoRegistered ? null : (
                <form action={removeResourceAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
                  >
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
