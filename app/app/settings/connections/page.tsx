import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { notionConnections, accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  disconnectNotionAction,
  repairSetupAction,
} from "@/app/(auth)/onboarding/actions";
import { importNotionAction } from "./actions";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ repaired?: string; imported?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { repaired, imported } = await searchParams;

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
    <div className="mx-auto max-w-2xl">
      <h1 className="text-h1">Connections</h1>

      {repaired && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--primary)/0.1)] px-4 py-3 text-sm text-[hsl(var(--foreground))]">
          Setup re-run successfully. Your Steadii workspace has been re-created in Notion.
        </div>
      )}
      {imported && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--primary)/0.1)] px-4 py-3 text-sm text-[hsl(var(--foreground))]">
          Imported {imported} rows from Notion into Steadii.
        </div>
      )}

      <section className="mt-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">Notion</h2>
        {notionConn ? (
          <>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              Connected to <strong>{notionConn.workspaceName ?? "workspace"}</strong>
              {notionConn.setupCompletedAt ? " — setup complete." : " — setup pending."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <form action={importNotionAction}>
                <button
                  type="submit"
                  className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:opacity-90"
                >
                  Import from Notion
                </button>
              </form>
              <form action={repairSetupAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
                >
                  Re-run setup
                </button>
              </form>
              <Link
                href="/api/integrations/notion/connect"
                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
              >
                Re-connect
              </Link>
              <form action={disconnectNotionAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
                >
                  Disconnect
                </button>
              </form>
            </div>
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
              Import copies your Notion classes, mistakes, syllabi, and assignments
              into Steadii&rsquo;s Postgres store (idempotent — safe to re-run).
              Re-run setup if the Steadii page has been deleted from Notion or the
              four databases are out of sync.
            </p>
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

      <section className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
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
