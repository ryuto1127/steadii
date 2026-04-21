import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SidebarNav } from "./sidebar-nav";
import { NAV_ITEM_KEYS } from "./nav-items";
import { Logo } from "./logo";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

function shortTime(d: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

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
export async function Sidebar({
  creditsRemaining,
  plan,
}: {
  creditsRemaining: number;
  plan: "free" | "pro" | "admin";
}) {
  const t = await getTranslations("nav");
  const labels: Record<string, string> = {};
  for (const key of NAV_ITEM_KEYS) labels[key] = t(key);

  const session = await auth();
  const user = session?.user;
  const displayName = user?.name?.trim() || user?.email?.split("@")[0] || "You";
  const initial = initials(user?.name, user?.email);
  const avatarUrl = user?.image ?? null;

  let recent: { id: string; title: string | null; updatedAt: Date }[] = [];
  if (user?.id) {
    recent = await db
      .select({
        id: chats.id,
        title: chats.title,
        updatedAt: chats.updatedAt,
      })
      .from(chats)
      .where(and(eq(chats.userId, user.id), isNull(chats.deletedAt)))
      .orderBy(desc(chats.updatedAt))
      .limit(3);
  }

  const creditsLabel =
    plan === "admin" ? "∞ credits" : `${creditsRemaining.toLocaleString()} credits left`;

  return (
    <div className="relative z-20 w-14 shrink-0">
      <aside
        aria-label="Primary"
        className="group/sidebar absolute inset-y-0 left-0 flex w-14 flex-col overflow-hidden rounded-xl px-2 py-3 transition-all duration-300 ease-out hover:w-60 hover:bg-[hsl(var(--background))] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
      >
        <Link
          href="/app"
          aria-label="Steadii home"
          className="flex h-9 items-center gap-2.5 rounded-lg px-1.5 transition-hover"
        >
          <Logo size={26} />
          <span className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap text-[15px] font-semibold tracking-tight text-[hsl(var(--foreground))] opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
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
          <SidebarNav labels={labels} />
        </div>

        {recent.length > 0 ? (
          <div className="mt-5 flex flex-col gap-0.5 opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
            <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Recent chats
            </span>
            {recent.map((c) => (
              <Link
                key={c.id}
                href={`/app/chat/${c.id}`}
                className="flex h-8 items-center gap-2 rounded-lg px-2 text-[14px] text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
              >
                <span className="min-w-0 flex-1 truncate">
                  {c.title ?? "Untitled"}
                </span>
                <span className="shrink-0 text-[12px] tabular-nums opacity-60">
                  {shortTime(c.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        <Link
          href="/app/settings"
          className="mt-auto flex h-10 items-center gap-2.5 rounded-lg px-1.5 text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
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
          <span className="flex min-w-0 flex-1 flex-col whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
            <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
              {displayName}
            </span>
            <span className="truncate text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
              {creditsLabel}
            </span>
          </span>
        </Link>
      </aside>
    </div>
  );
}
