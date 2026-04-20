import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SidebarNav } from "./sidebar-nav";
import { NAV_ITEM_KEYS } from "./nav-items";
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

export async function Sidebar() {
  const t = await getTranslations("nav");
  const labels: Record<string, string> = {};
  for (const key of NAV_ITEM_KEYS) labels[key] = t(key);

  const session = await auth();
  let recent: { id: string; title: string | null; updatedAt: Date }[] = [];
  if (session?.user?.id) {
    recent = await db
      .select({
        id: chats.id,
        title: chats.title,
        updatedAt: chats.updatedAt,
      })
      .from(chats)
      .where(and(eq(chats.userId, session.user.id), isNull(chats.deletedAt)))
      .orderBy(desc(chats.updatedAt))
      .limit(3);
  }

  return (
    <aside
      className="sidebar-bg sticky top-0 flex h-screen w-56 shrink-0 flex-col px-3 py-5"
      aria-label="Primary"
    >
      <div className="flex items-baseline gap-2 px-2 pb-1">
        <span className="text-[15px] font-semibold leading-none tracking-[-0.02em] text-[hsl(var(--foreground))]">
          Steadii
        </span>
      </div>
      <span className="mb-5 px-2 font-mono text-[11px] tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
        v0.1 · α
      </span>

      <SidebarNav labels={labels} />

      {recent.length > 0 ? (
        <div className="mt-5 flex flex-col gap-0.5 pt-4">
          <span className="px-2 pb-1 font-mono text-[11px] tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
            RECENT
          </span>
          {recent.map((c) => (
            <Link
              key={c.id}
              href={`/app/chat/${c.id}`}
              className="flex h-7 items-center gap-2 rounded-lg px-2 text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))]"
            >
              <span className="min-w-0 flex-1 truncate">
                {c.title ?? "Untitled"}
              </span>
              <span className="font-mono text-[11px] tabular-nums opacity-60">
                {shortTime(c.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
