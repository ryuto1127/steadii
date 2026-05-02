import Link from "next/link";
import { getTranslations } from "next-intl/server";
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
import { refreshGmailInboxAction } from "../actions";

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
  const tConn = await getTranslations("settings.connections");
  const t = await getTranslations("connections_page");

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
  const gmailConnected = googleAcct[0]?.scope?.includes("gmail") ?? false;

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
      <h1 className="text-h1">{t("title")}</h1>

      {repaired && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--primary)/0.1)] px-4 py-3 text-sm text-[hsl(var(--foreground))]">
          {t("setup_rerun_success")}
        </div>
      )}
      {imported && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--primary)/0.1)] px-4 py-3 text-sm text-[hsl(var(--foreground))]">
          {t("imported_prefix")} {imported} {t("imported_suffix")}
        </div>
      )}
      {ms === "connected" && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--primary)/0.1)] px-4 py-3 text-sm text-[hsl(var(--foreground))]">
          {t("microsoft_connected_toast")}
        </div>
      )}
      {ms === "disconnected" && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
          {t("microsoft_disconnected_toast")}
        </div>
      )}
      {ical && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
          {t("ical_subscription_added")} {ical}.
        </div>
      )}

      <section className="mt-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">{t("notion_label")}</h2>
        {notionConn ? (
          <>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              {t("connected_to")} <strong>{notionConn.workspaceName ?? "workspace"}</strong>
              {notionConn.setupCompletedAt ? " — setup complete." : " — setup pending."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <form action={importNotionAction}>
                <button
                  type="submit"
                  className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:opacity-90"
                >
                  {t("import_button")}
                </button>
              </form>
              <form action={repairSetupAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
                >
                  {t("rerun_setup")}
                </button>
              </form>
              <Link
                href="/api/integrations/notion/connect"
                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
              >
                {t("reconnect")}
              </Link>
              <form action={disconnectNotionAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
                >
                  {t("disconnect")}
                </button>
              </form>
            </div>
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
              {t("notion_blurb")}
            </p>
          </>
        ) : (
          <Link
            href="/api/integrations/notion/connect"
            className="mt-4 inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
          >
            {t("connect_notion")}
          </Link>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">{t("google_calendar")}</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          {calendarConnected
            ? "Calendar scope granted."
            : "Calendar scope missing. Sign out and back in to re-authorize."}
        </p>
      </section>

      <section className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">{t("gmail")}</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          {gmailConnected
            ? "Gmail scope granted. The agent can triage and draft replies."
            : "Gmail scope missing. Sign out and back in to re-authorize."}
        </p>
        {gmailConnected && (
          <form action={refreshGmailInboxAction} className="mt-4">
            <button
              type="submit"
              title={tConn("refresh_inbox_title")}
              className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
            >
              {tConn("refresh_inbox")}
            </button>
          </form>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">{t("microsoft_label")}</h2>
        {msAcct ? (
          <>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              {t("connected_simple")}{" "}
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
                    {t("reconnect_missing_scopes")}
                  </button>
                </form>
              )}
              <form action={disconnectMicrosoftAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
                >
                  {t("disconnect")}
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              {t("microsoft_blurb")}
            </p>
            <form action={connectMicrosoftAction} className="mt-4">
              <button
                type="submit"
                className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
              >
                {t("connect_microsoft")}
              </button>
            </form>
          </>
        )}
      </section>

      <section
        id="ical"
        className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
      >
        <h2 className="text-lg font-medium">{t("ical_heading")}</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          {t("ical_blurb")}
        </p>

        <form
          action={addIcalSubscriptionAction}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            {t("url_label")}
            <input
              type="url"
              name="url"
              required
              placeholder={t("url_placeholder")}
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))] sm:w-40">
            {t("label_optional_label")}
            <input
              type="text"
              name="label"
              placeholder={t("label_placeholder")}
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
          >
            {t("add_button")}
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
                        {t("paused_prefix")} {sub.consecutiveFailures} failures
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {sub.url}
                  </p>
                  {sub.lastError && (
                    <p className="mt-0.5 text-xs text-[hsl(var(--destructive,red))]">
                      {t("last_error_prefix")} {sub.lastError}
                    </p>
                  )}
                  {sub.lastSyncedAt && (
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {t("last_synced_prefix")}{" "}
                      {sub.lastSyncedAt.toISOString().slice(0, 16)}
                      {t("last_synced_z_suffix")}
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
                        {t("reactivate")}
                      </button>
                    </form>
                  )}
                  <form action={removeIcalSubscriptionAction}>
                    <input type="hidden" name="id" value={sub.id} />
                    <button
                      type="submit"
                      className="rounded border border-[hsl(var(--border))] px-3 py-1 text-xs transition hover:bg-[hsl(var(--surface-raised))]"
                    >
                      {t("remove")}
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
