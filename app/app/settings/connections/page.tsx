import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { notionConnections, accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { disconnectNotionAction } from "@/app/(auth)/onboarding/actions";

export default async function ConnectionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [notionConn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, userId))
    .limit(1);

  const googleAcct = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);

  const calendarConnected = googleAcct[0]?.scope?.includes("calendar") ?? false;

  return (
    <div className="max-w-2xl">
      <h1 className="font-serif text-3xl">Connections</h1>

      <section className="mt-10 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Notion</h2>
        {notionConn ? (
          <>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              Connected to <strong>{notionConn.workspaceName ?? "workspace"}</strong>
              {notionConn.setupCompletedAt ? " — setup complete." : " — setup pending."}
            </p>
            <form action={disconnectNotionAction} className="mt-4 flex gap-3">
              <button
                type="submit"
                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
              >
                Disconnect
              </button>
              <Link
                href="/api/integrations/notion/connect"
                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
              >
                Re-connect
              </Link>
            </form>
          </>
        ) : (
          <Link
            href="/api/integrations/notion/connect"
            className="mt-4 inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
          >
            Connect Notion
          </Link>
        )}
      </section>

      <section className="mt-6 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Google Calendar</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          {calendarConnected
            ? "Calendar scope granted."
            : "Calendar scope missing. Sign out and back in to re-authorize."}
        </p>
      </section>
    </div>
  );
}
