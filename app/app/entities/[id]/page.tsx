import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import {
  getEntityById,
  getLinksForEntity,
  listEntitiesForUser,
  resolveLinkLabels,
  type ResolvedLinkLabel,
} from "@/lib/agent/entity-graph/lookup";
import {
  deleteEntityAction,
  mergeEntitiesAction,
  unlinkSourceAction,
  updateEntityAction,
} from "../actions";

// engineer-51 — /app/entities/[id]. Detail surface for one entity:
// edit the descriptive metadata, view linked source rows in a unified
// timeline, merge with another canonical entity of the same kind.

export const dynamic = "force-dynamic";

const TIMELINE_LIMIT = 50;

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;

  const entity = await getEntityById({ userId, entityId: id });
  if (!entity) notFound();

  const t = await getTranslations("entities");

  const links = await getLinksForEntity({
    userId,
    entityId: id,
    limit: TIMELINE_LIMIT,
  });
  const labels = await resolveLinkLabels({ userId, links });
  const unlinkAriaLabel = t("detail_unlink_aria");

  // Merge candidates — other live entities of the same kind, so the
  // user can collapse "令和トラベル" + "Reiwa Travel" into one.
  const sameKind = await listEntitiesForUser({
    userId,
    kind: entity.kind,
    limit: 200,
  });
  const mergeOptions = sameKind.filter((e) => e.id !== entity.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-2 text-small text-[hsl(var(--muted-foreground))]">
        <Link
          href="/app/entities"
          className="inline-flex items-center gap-1 transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ChevronLeft size={14} strokeWidth={1.75} />
          {t("detail_back")}
        </Link>
      </div>

      <header>
        <p className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          {t(`kinds.${entity.kind}`)}
        </p>
        <h1 className="mt-1 text-h2 font-semibold">{entity.displayName}</h1>
        {entity.aliases.length > 0 ? (
          <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
            {entity.aliases.join(" · ")}
          </p>
        ) : null}
        {entity.description ? (
          <p className="mt-3 text-small">{entity.description}</p>
        ) : null}
        <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("detail_last_seen", { when: entity.lastSeenAt.toISOString().slice(0, 10) })}
        </p>
      </header>

      <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-body font-medium">{t("detail_edit_heading")}</h2>
        <form action={updateEntityAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="entityId" value={entity.id} />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("detail_field_display_name")}
            </span>
            <input
              name="displayName"
              defaultValue={entity.displayName}
              maxLength={120}
              required
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("detail_field_aliases")}
            </span>
            <textarea
              name="aliases"
              defaultValue={entity.aliases.join("\n")}
              rows={3}
              className="resize-y rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
              placeholder={t("detail_field_aliases_placeholder")}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("detail_field_description")}
            </span>
            <textarea
              name="description"
              defaultValue={entity.description ?? ""}
              rows={3}
              maxLength={800}
              className="resize-y rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="self-end rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            {t("detail_save")}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-body font-medium">
          {t("detail_timeline_heading")}
        </h2>
        <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("detail_timeline_description")}
        </p>
        {labels.length === 0 ? (
          <p className="mt-3 text-small text-[hsl(var(--muted-foreground))]">
            {t("detail_timeline_empty")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-[hsl(var(--border))]">
            {labels.map((lbl, i) => (
              <TimelineRow
                key={`${lbl.sourceKind}:${lbl.sourceId}`}
                label={lbl}
                linkId={links[i]?.id ?? null}
                entityId={entity.id}
                unlinkAriaLabel={unlinkAriaLabel}
              />
            ))}
          </ul>
        )}
      </section>

      {mergeOptions.length > 0 ? (
        <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <h2 className="text-body font-medium">
            {t("detail_merge_heading")}
          </h2>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("detail_merge_description")}
          </p>
          <form action={mergeEntitiesAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="winnerId" value={entity.id} />
            <label className="flex flex-1 min-w-0 flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {t("detail_merge_target")}
              </span>
              <select
                name="loserId"
                defaultValue=""
                required
                className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
              >
                <option value="" disabled>
                  {t("detail_merge_pick")}
                </option>
                {mergeOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-8 rounded-md border border-[hsl(var(--border))] px-3 text-small font-medium transition-hover hover:bg-[hsl(var(--background))]"
            >
              {t("detail_merge_submit")}
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-body font-medium text-red-600 dark:text-red-400">
          {t("detail_danger_heading")}
        </h2>
        <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("detail_danger_description")}
        </p>
        <form action={deleteEntityAction} className="mt-3">
          <input type="hidden" name="entityId" value={entity.id} />
          <button
            type="submit"
            className="rounded-md border border-red-300 px-3 py-1.5 text-small font-medium text-red-600 transition-hover hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            {t("detail_delete")}
          </button>
        </form>
      </section>
    </div>
  );
}

function TimelineRow({
  label,
  linkId,
  entityId,
  unlinkAriaLabel,
}: {
  label: ResolvedLinkLabel;
  linkId: string | null;
  entityId: string;
  unlinkAriaLabel: string;
}) {
  return (
    <li className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          {label.sourceKind.replace(/_/g, " ")}
        </p>
        {label.href ? (
          <Link
            href={label.href}
            className="block truncate text-small font-medium hover:underline"
          >
            {label.label}
          </Link>
        ) : (
          <p className="truncate text-small font-medium">{label.label}</p>
        )}
        {label.occurredAt ? (
          <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
            {label.occurredAt.toISOString().slice(0, 10)}
          </p>
        ) : null}
      </div>
      {linkId ? (
        <form action={unlinkSourceAction}>
          <input type="hidden" name="linkId" value={linkId} />
          <input type="hidden" name="entityId" value={entityId} />
          <button
            type="submit"
            className="text-[11px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-red-600"
            aria-label={unlinkAriaLabel}
          >
            ✕
          </button>
        </form>
      ) : null}
    </li>
  );
}
