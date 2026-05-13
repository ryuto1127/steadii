import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { userFacts } from "@/lib/db/schema";
import {
  UserFactRow,
  type UserFactRowData,
} from "@/components/settings/user-fact-row";
import { userFactUpsertAction } from "./actions";

// engineer-47 — /app/settings/facts. View / edit / soft-delete the
// persistent user_facts the chat agent has saved via save_user_fact,
// plus an inline "add new fact" form. Renders facts newest-first by
// lastUsedAt (matches the prompt-injection order, so the user sees
// what's currently in the prompt at the top).

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "schedule",
  "communication_style",
  "location_timezone",
  "academic",
  "personal_pref",
  "other",
] as const;

export default async function FactsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("settings_user_facts");

  const rows = await db
    .select({
      id: userFacts.id,
      fact: userFacts.fact,
      category: userFacts.category,
      source: userFacts.source,
      createdAt: userFacts.createdAt,
      sourceChatMessageId: userFacts.sourceChatMessageId,
      expiresAt: userFacts.expiresAt,
      nextReviewAt: userFacts.nextReviewAt,
      reviewedAt: userFacts.reviewedAt,
    })
    .from(userFacts)
    .where(and(eq(userFacts.userId, userId), isNull(userFacts.deletedAt)))
    .orderBy(sql`${userFacts.lastUsedAt} DESC NULLS LAST`, desc(userFacts.createdAt));

  const data: UserFactRowData[] = rows.map((r) => ({
    id: r.id,
    fact: r.fact,
    category: r.category,
    source: r.source,
    createdAt: formatStamp(r.createdAt),
    sourceChatMessageId: r.sourceChatMessageId,
    expiresAt: r.expiresAt ? formatDay(r.expiresAt) : null,
    nextReviewAt: r.nextReviewAt ? formatDay(r.nextReviewAt) : null,
    reviewedAt: r.reviewedAt ? formatDay(r.reviewedAt) : null,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div className="flex items-center gap-2 text-small text-[hsl(var(--muted-foreground))]">
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ChevronLeft size={14} strokeWidth={1.75} />
          {t("settings_back")}
        </Link>
      </div>
      <header>
        <h1 className="text-h2 font-semibold">{t("title")}</h1>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          {t("description")}
        </p>
        <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("plaintext_warning")}
        </p>
      </header>

      <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        {data.length === 0 ? (
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {t("empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((d) => (
              <UserFactRow key={d.id} data={d} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-body font-medium">{t("add_heading")}</h2>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          {t("add_description")}
        </p>
        <form
          action={userFactUpsertAction}
          className="mt-3 flex flex-col gap-2"
        >
          <textarea
            name="fact"
            maxLength={500}
            rows={2}
            placeholder={t("add_placeholder")}
            required
            className="w-full resize-y rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              name="category"
              defaultValue="other"
              className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="ml-auto rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
            >
              {t("add_submit")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function formatStamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
