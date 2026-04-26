import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import {
  notionConnections,
  accounts,
  icalSubscriptions,
} from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  disconnectNotionAction,
  repairSetupAction,
} from "@/app/(auth)/onboarding/actions";
import {
  importNotionAction,
  connectMicrosoftAction,
  disconnectMicrosoftAction,
  addIcalSubscriptionAction,
  removeIcalSubscriptionAction,
  reactivateIcalSubscriptionAction,
} from "./actions";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    repaired?: string;
    imported?: string;
    ms?: string;
    ical?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { repaired, imported, ms, ical } = await searchParams;

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

  const [msAcct] = await db
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.userId, userId), eq(accounts.provider, "microsoft-entra-id"))
    )
    .limit(1);
  const msScope = msAcct?.scope?.toLowerCase() ?? "";
  const msCalendar = msScope.includes("calendars.read");
  const msTasks = msScope.includes("tasks.read");

  const icalSubs = await db
    .select()
    .from(icalSubscriptions)
    .where(eq(icalSubscriptions.userId, userId))
    .orderBy(asc(icalSubscriptions.createdAt));

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
      {ms === "connected" && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--primary)/0.1)] px-4 py-3 text-sm text-[hsl(var(--foreground))]">
          Microsoft 365 connected.
        </div>
      )}
      {ms === "disconnected" && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
          Microsoft 365 disconnected.
        </div>
      )}
      {ical && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
          iCal subscription {ical}.
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

      <section className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">Microsoft 365</h2>
        {msAcct ? (
          <>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              Connected.{" "}
              {msCalendar ? "Calendar scope granted." : "Calendar scope missing."}{" "}
              {msTasks ? "Tasks scope granted." : "Tasks scope missing."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {(!msCalendar || !msTasks) && (
                <form action={connectMicrosoftAction}>
                  <button
                    type="submit"
                    className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
                  >
                    Re-connect to grant missing scopes
                  </button>
                </form>
              )}
              <form action={disconnectMicrosoftAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
                >
                  Disconnect
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              Pull Outlook calendar events and Microsoft To Do tasks into the
              same prompt block as Google.
            </p>
            <form action={connectMicrosoftAction} className="mt-4">
              <button
                type="submit"
                className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
              >
                Connect Microsoft 365
              </button>
            </form>
          </>
        )}
      </section>

      <section
        id="ical"
        className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
      >
        <h2 className="text-lg font-medium">iCal subscriptions</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Paste any read-only iCal feed (school timetable, public calendar) and
          Steadii will sync it every 6 hours.
        </p>

        <form
          action={addIcalSubscriptionAction}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            URL
            <input
              type="url"
              name="url"
              required
              placeholder="https://… or webcal://…"
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))] sm:w-40">
            Label (optional)
            <input
              type="text"
              name="label"
              placeholder="e.g. UToronto"
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
          >
            Add
          </button>
        </form>

        {icalSubs.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {icalSubs.map((sub) => (
              <li
                key={sub.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {sub.label ?? "(unlabeled)"}
                    </span>
                    {!sub.active && (
                      <span className="rounded bg-[hsl(var(--surface-raised))] px-2 py-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        Paused — {sub.consecutiveFailures} failures
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {sub.url}
                  </p>
                  {sub.lastError && (
                    <p className="mt-0.5 text-xs text-[hsl(var(--destructive,red))]">
                      Last error: {sub.lastError}
                    </p>
                  )}
                  {sub.lastSyncedAt && (
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      Last synced {sub.lastSyncedAt.toISOString().slice(0, 16)}Z
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!sub.active && (
                    <form action={reactivateIcalSubscriptionAction}>
                      <input type="hidden" name="id" value={sub.id} />
                      <button
                        type="submit"
                        className="rounded border border-[hsl(var(--border))] px-3 py-1 text-xs transition hover:bg-[hsl(var(--surface-raised))]"
                      >
                        Reactivate
                      </button>
                    </form>
                  )}
                  <form action={removeIcalSubscriptionAction}>
                    <input type="hidden" name="id" value={sub.id} />
                    <button
                      type="submit"
                      className="rounded border border-[hsl(var(--border))] px-3 py-1 text-xs transition hover:bg-[hsl(var(--surface-raised))]"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
