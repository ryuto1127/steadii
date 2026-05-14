"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

// Thin client wrapper for a single row in the sidebar Recent chats
// section. The parent Sidebar is a server component (it fetches the
// chats list during SSR), so it can't read `usePathname` itself —
// this row is the cheapest carve-out that lets the currently-viewed
// chat get an "active" highlight matching the icon row's
// `nav-active` pill.
export function SidebarRecentChatRow({
  id,
  title,
  timeLabel,
}: {
  id: string;
  title: string;
  timeLabel: string;
}) {
  const pathname = usePathname();
  const active = pathname === `/app/chat/${id}`;
  return (
    <Link
      href={`/app/chat/${id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-hover",
        active
          ? "bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]"
          : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
      )}
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 text-[11px] tabular-nums opacity-60">
        {timeLabel}
      </span>
    </Link>
  );
}
