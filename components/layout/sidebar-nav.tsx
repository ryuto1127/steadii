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
import { ICON_OFFSET_PX, NAV_ITEM_KEYS, type NavItemKey } from "./nav-items";

const ICONS: Record<NavItemKey, LucideIcon> = {
  chat: MessageCircle,
  calendar: Calendar,
  mistakes: BookOpen,
  syllabus: FileText,
  assignments: CheckSquare,
  resources: FolderOpen,
  settings: Settings,
};

const HREFS: Record<NavItemKey, string> = {
  chat: "/app/chat",
  calendar: "/app/calendar",
  mistakes: "/app/mistakes",
  syllabus: "/app/syllabus",
  assignments: "/app/assignments",
  resources: "/app/resources",
  settings: "/app/settings",
};

export function SidebarNav({ labels }: { labels: Record<string, string> }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1">
      {NAV_ITEM_KEYS.map((key) => {
        const Icon = ICONS[key];
        const href = HREFS[key];
        const active = isActive(pathname, href);
        const offset = ICON_OFFSET_PX[key] ?? 0;
        return (
          <Link
            key={key}
            href={href}
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
            <span>{labels[key] ?? key}</span>
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
