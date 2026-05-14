import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SidebarNav } from "./sidebar-nav";
import { ALL_NAV_ITEM_KEYS } from "./nav-items";
import { Logo } from "./logo";
import { SidebarRecentChatRow } from "./sidebar-recent-chat-row";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { countPendingDrafts } from "@/lib/agent/email/pending-queries";
import { shortRelativeTime } from "@/lib/utils/relative-time";

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name && name.trim()) || (email && email.split("@")[0]) || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

// Rail-plus-overlay sidebar. A narrow w-14 column is always reserved in
// layout; the <aside> absolutely overlays on hover and expands to
// w-60. Labels, Recent, and the profile footer live in group-hover:
// reveal wrappers so we keep the whole thing as a server component
// (data + SSR) without any client-state glue.
//
// `variant` controls layout mode. "rail" (default) is the desktop
// hover-to-expand pattern. "expanded" forces full-width with all labels
// visible — used inside the mobile drawer where there's no hover and
// the user expects the full nav up front.
export async function Sidebar({
  creditsUsed,
  creditsLimit,
  plan,
  variant = "rail",
}: {
  creditsUsed: number;
  creditsLimit: number;
  plan: "free" | "student" | "pro" | "admin";
  variant?: "rail" | "expanded";
}) {
  const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);
  // Percentage consumed; 0 for admins (shown as a full bar with infinity-tone).
  const percentUsed =
    plan === "admin"
      ? 0
      : creditsLimit > 0
      ? Math.min(100, (creditsUsed / creditsLimit) * 100)
      : 0;
  const barTone =
    plan === "admin"
      ? "bg-[hsl(268_70%_56%)] dark:bg-[hsl(268_80%_78%)]"
      : creditsUsed >= creditsLimit
      ? "bg-[hsl(var(--destructive))]"
      : creditsUsed >= creditsLimit * 0.8
      ? "bg-[hsl(38_92%_50%)]"
      : "bg-[hsl(var(--primary))]";
  const t = await getTranslations("nav");
  const tLayout = await getTranslations("app_layout");
  const labels: Record<string, string> = {};
  for (const key of ALL_NAV_ITEM_KEYS) labels[key] = t(key);

  const session = await auth();
  const user = session?.user;
  const displayName = user?.name?.trim() || user?.email?.split("@")[0] || tLayout("you_fallback");
  const initial = initials(user?.name, user?.email);
  const avatarUrl = user?.image ?? null;

  let recent: { id: string; title: string | null; updatedAt: Date }[] = [];
  // Pending Inbox count drives the sidebar badge ("Inbox · 3"). Fetched
  // alongside `recent` so the entire sidebar stays one server pass.
  let pendingInboxCount = 0;
  if (user?.id) {
    [recent, pendingInboxCount] = await Promise.all([
      db
        .select({
          id: chats.id,
          title: chats.title,
          updatedAt: chats.updatedAt,
        })
        .from(chats)
        .where(and(eq(chats.userId, user.id), isNull(chats.deletedAt)))
        .orderBy(desc(chats.updatedAt))
        .limit(5),
      countPendingDrafts(user.id),
    ]);
  }

  const creditsLabel =
    plan === "admin"
      ? tLayout("credits_unlimited_short")
      : tLayout("credits_remaining", { n: creditsRemaining.toLocaleString() });
  const planLabel =
    plan === "admin"
      ? tLayout("plan_admin")
      : plan === "pro"
      ? tLayout("plan_pro")
      : plan === "student"
      ? tLayout("plan_student")
      : tLayout("plan_free");
  const planColorClass =
    plan === "pro" || plan === "student"
      ? "text-[hsl(var(--primary))]"
      : plan === "admin"
      ? "text-[hsl(268_70%_56%)] dark:text-[hsl(268_80%_78%)]"
      : "text-[hsl(var(--muted-foreground))]";

  // The mobile drawer is always-expanded: no hover-to-reveal, labels +
  // recent + credits bar are visible from the moment the drawer opens.
  // The rail variant keeps the existing hover-reveal pattern unchanged.
  const expanded = variant === "expanded";
  const outerClass = expanded ? "relative w-full flex-1" : "relative z-20 w-14 shrink-0";
  const asideClass = expanded
    ? "group/sidebar flex h-full w-full flex-col overflow-y-auto px-3 py-3"
    : "group/sidebar absolute inset-y-0 left-0 flex w-14 flex-col overflow-hidden rounded-xl px-2 py-3 transition-all duration-200 ease-out hover:w-60 hover:bg-[hsl(var(--background))] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]";
  const labelRevealClass = expanded
    ? ""
    : "opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100";

  return (
    <div className={outerClass}>
      <aside aria-label={tLayout("primary_aria")} className={asideClass}>
        <Link
          href="/app"
          aria-label={tLayout("sidebar_brand_aria")}
          className="flex h-9 items-center gap-2.5 rounded-lg px-1 transition-hover"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center">
            <Logo size={32} />
          </span>
          <span
            className={`flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap text-[15px] font-semibold tracking-tight text-[hsl(var(--foreground))] transition-opacity duration-200 ${
              expanded ? "opacity-100" : "opacity-0 group-hover/sidebar:opacity-100"
            }`}
          >
            Steadii
            <ChevronRight
              size={14}
              strokeWidth={2}
              className="ml-0.5 text-[hsl(var(--muted-foreground))]"
              aria-hidden
            />
          </span>
        </Link>

        <div className="mt-4">
          <SidebarNav
            labels={labels}
            badges={{ inbox: pendingInboxCount }}
            expanded={expanded}
          />
        </div>

        {/*
          Recent chats — appears below the icon row, above the credits
          bar. Server-rendered so the list refreshes on every route
          change (no client-side subscription needed for α). The 5-row
          limit matches the most-recent set Inbox / agent surfaces use
          for parity. Empty state replaces the rows when the user has
          zero chats so the section still announces "we know what this
          space is for".
        */}
        <div className={`mt-5 flex flex-col gap-0.5 ${labelRevealClass}`}>
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              {tLayout("recent_chats")}
            </span>
            <Link
              href="/app/chats"
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              aria-label={tLayout("recent_view_all_aria")}
            >
              {tLayout("recent_view_all")}
              <ChevronRight size={11} strokeWidth={2} aria-hidden />
            </Link>
          </div>
          {recent.length > 0 ? (
            recent.map((c) => (
              <SidebarRecentChatRow
                key={c.id}
                id={c.id}
                title={c.title ?? tLayout("untitled")}
                timeLabel={shortRelativeTime(c.updatedAt)}
              />
            ))
          ) : (
            <p className="px-2 pt-0.5 text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
              {tLayout("recent_empty")}
            </p>
          )}
        </div>

        {/*
          Credits progress bar. Per product decision (2026-04-21): the sidebar
          shows a visual bar only — numbers live in Settings. Rendered only in
          the expanded (hover) state so the collapsed rail stays minimal.
          Admin accounts get a full-width tinted bar (no meaningful percent).
        */}
        <div
          className={`mt-auto px-1.5 pb-2 ${labelRevealClass}`}
          aria-hidden
        >
          <Link
            href="/app/settings/billing"
            aria-label={
              plan === "admin"
                ? tLayout("credits_unlimited_aria")
                : tLayout("credits_used_aria", {
                    used: creditsUsed,
                    limit: creditsLimit,
                  })
            }
            className="block"
          >
            <div className="h-1 w-full overflow-hidden rounded-full bg-[hsl(var(--surface-raised))]">
              <div
                className={`h-full rounded-full ${barTone} transition-[width] duration-300 ease-out`}
                style={{ width: plan === "admin" ? "100%" : `${percentUsed}%` }}
              />
            </div>
          </Link>
        </div>

        <Link
          href="/app/settings"
          className="flex h-11 items-center gap-2.5 rounded-lg px-1.5 text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--surface-raised))] text-[11px] font-semibold text-[hsl(var(--foreground))]"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              initial
            )}
          </span>
          <span
            className={`flex min-w-0 flex-1 flex-col whitespace-nowrap ${labelRevealClass}`}
          >
            <span className="flex items-center gap-1.5 truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
              <span className="truncate">{displayName}</span>
            </span>
            <span className="flex items-center gap-1.5 truncate text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
              <span className={`font-semibold uppercase tracking-wider ${planColorClass}`}>
                {planLabel}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate">{creditsLabel}</span>
            </span>
          </span>
        </Link>
      </aside>
    </div>
  );
}
