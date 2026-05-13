"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  userFactDeleteAction,
  userFactReconfirmAction,
  userFactUpsertAction,
} from "@/app/app/settings/facts/actions";
import type { UserFactCategory, UserFactSource } from "@/lib/db/schema";

// engineer-47 — one row in the /app/settings/facts list. Read-mode
// shows the fact + category tag + provenance line; edit-mode swaps in a
// textarea + select. Server actions handle the writes; this component
// is purely a state toggle.
//
// engineer-48 — surfaces lifecycle metadata (next review, expiry,
// last-reviewed) and the manual Reconfirm button.

export type UserFactRowData = {
  id: string;
  fact: string;
  category: UserFactCategory | null;
  source: UserFactSource;
  createdAt: string;
  sourceChatMessageId: string | null;
  expiresAt: string | null;
  nextReviewAt: string | null;
  reviewedAt: string | null;
};

const CATEGORIES: UserFactCategory[] = [
  "schedule",
  "communication_style",
  "location_timezone",
  "academic",
  "personal_pref",
  "other",
];

export function UserFactRow({ data }: { data: UserFactRowData }) {
  const [editing, setEditing] = useState(false);
  const t = useTranslations("settings_user_facts");
  const category = data.category ?? "other";

  if (editing) {
    return (
      <li className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3">
        <form
          action={async (fd) => {
            await userFactUpsertAction(fd);
            setEditing(false);
          }}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="id" value={data.id} />
          <textarea
            name="fact"
            defaultValue={data.fact}
            maxLength={500}
            rows={2}
            className="w-full resize-y rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              name="category"
              defaultValue={category}
              className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded border border-[hsl(var(--border))] px-3 py-1 text-[11px] transition-hover hover:bg-[hsl(var(--surface-raised))]"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                className="rounded bg-[hsl(var(--primary))] px-3 py-1 text-[11px] font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                {t("save")}
              </button>
            </div>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="rounded bg-[hsl(var(--surface-raised))] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t(`categories.${category}`)}
            </span>
            <p className="text-small text-[hsl(var(--foreground))]">
              {data.fact}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
            {data.source === "user_explicit"
              ? t("provenance_user")
              : t("provenance_agent")}
            <span className="mx-1.5">·</span>
            <span className="font-mono">{data.createdAt}</span>
          </p>
          {data.nextReviewAt || data.expiresAt ? (
            <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {data.nextReviewAt ? (
                <>
                  {t("lifecycle_next_review")}{" "}
                  <span className="font-mono">{data.nextReviewAt}</span>
                </>
              ) : null}
              {data.nextReviewAt && data.expiresAt ? (
                <span className="mx-1.5">·</span>
              ) : null}
              {data.expiresAt ? (
                <>
                  {t("lifecycle_expires")}{" "}
                  <span className="font-mono">{data.expiresAt}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <form action={userFactReconfirmAction}>
            <input type="hidden" name="id" value={data.id} />
            <button
              type="submit"
              className="rounded border border-[hsl(var(--border))] px-3 py-1 text-[11px] transition-hover hover:bg-[hsl(var(--surface-raised))]"
              title={t("reconfirm_hint")}
            >
              {t("reconfirm")}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-[hsl(var(--border))] px-3 py-1 text-[11px] transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            {t("edit")}
          </button>
          <form action={userFactDeleteAction}>
            <input type="hidden" name="id" value={data.id} />
            <button
              type="submit"
              className="rounded border border-[hsl(var(--border))] px-3 py-1 text-[11px] text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--destructive))]"
            >
              {t("delete")}
            </button>
          </form>
        </div>
      </div>
    </li>
  );
}
