"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle,
  Calendar,
  BookOpen,
  FileText,
  CheckSquare,
  FolderOpen,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Lucide icons share viewBox="0 0 24 24" but the painted content has
// inconsistent left margins: Calendar/BookOpen/CheckSquare draw their body
// at x=3, FileText/MessageCircle at x=4, while FolderOpen and Settings draw
// their body flush at x=2. At size=16 that puts the latter two ~1 px
// further left than the rest. Wrapper CSS can't fix this (the SVG bbox IS
// centered — it's the paint within that's shifted). We nudge the two
// outliers right by 1 px so the strokes visually align.
export const ICON_OFFSET_PX: Record<string, number> = {
  resources: 1, // FolderOpen body at x=2
  settings: 1,  // Settings gear's leftmost spoke at x=2
};

type NavItem = { key: string; href: string; icon: LucideIcon };

// Items live here (client-side) because `icon` is a React component — a
// function — and functions cannot cross the server→client props boundary.
// The server `<Sidebar>` only hands down a plain translations map.
const ITEMS: readonly NavItem[] = [
  { key: "chat", href: "/app/chat", icon: MessageCircle },
  { key: "calendar", href: "/app/calendar", icon: Calendar },
  { key: "mistakes", href: "/app/mistakes", icon: BookOpen },
  { key: "syllabus", href: "/app/syllabus", icon: FileText },
  { key: "assignments", href: "/app/assignments", icon: CheckSquare },
  { key: "resources", href: "/app/resources", icon: FolderOpen },
  { key: "settings", href: "/app/settings", icon: Settings },
];

export function SidebarNav({ labels }: { labels: Record<string, string> }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        const offset = ICON_OFFSET_PX[item.key] ?? 0;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "flex items-center gap-3 rounded-lg bg-[hsl(var(--surface))] px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))] shadow-sm"
                : "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))]"
            }
          >
            <span
              className={
                active
                  ? "flex h-5 w-5 shrink-0 items-center justify-center text-[hsl(var(--primary))]"
                  : "flex h-5 w-5 shrink-0 items-center justify-center"
              }
              style={offset ? { transform: `translateX(${offset}px)` } : undefined}
              aria-hidden
            >
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <span>{labels[item.key] ?? item.key}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}

// Exposed for unit tests (keeps offset invariants honest without a DOM).
export const NAV_ITEM_KEYS = ITEMS.map((i) => i.key);
