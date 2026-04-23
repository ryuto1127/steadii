"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  Inbox,
  Home,
  MessagesSquare,
  GraduationCap,
  Calendar,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  NAV_HREFS,
  NAV_ITEM_KEYS,
  NAV_SHORTCUTS,
  type NavItemKey,
} from "./nav-items";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<NavItemKey, LucideIcon> = {
  inbox: Inbox,
  home: Home,
  chats: MessagesSquare,
  classes: GraduationCap,
  calendar: Calendar,
};

export function SidebarNav({ labels }: { labels: Record<string, string> }) {
  const pathname = usePathname();
  const router = useRouter();
  const containerRef = useRef<HTMLElement>(null);

  // Global shortcut: press `g` then one of h/c/l/a/s to jump. Skip when an
  // input/textarea/contentEditable is focused.
  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (!armed && e.key.toLowerCase() === "g") {
        armed = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => (armed = false), 900);
        return;
      }
      if (armed) {
        const key = e.key.toLowerCase();
        const match = (Object.entries(NAV_SHORTCUTS) as [NavItemKey, string][]).find(
          ([, k]) => k === key
        );
        if (match) {
          e.preventDefault();
          router.push(NAV_HREFS[match[0]]);
        }
        armed = false;
        if (timer) clearTimeout(timer);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  const handleNavKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const nav = containerRef.current;
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a[data-nav-item]"));
    if (links.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? links.indexOf(active as HTMLAnchorElement) : -1;
    e.preventDefault();
    let next = idx;
    if (e.key === "ArrowDown") next = idx < 0 ? 0 : Math.min(idx + 1, links.length - 1);
    if (e.key === "ArrowUp") next = idx < 0 ? 0 : Math.max(idx - 1, 0);
    links[next]?.focus();
  };

  return (
    <nav
      ref={containerRef}
      onKeyDown={handleNavKey}
      className="flex-1 space-y-0.5"
      aria-label="Primary navigation"
    >
      {NAV_ITEM_KEYS.map((key) => {
        const Icon = ICONS[key];
        const href = NAV_HREFS[key];
        const active = isActive(pathname, href);
        return (
          <Link
            key={key}
            href={href}
            data-nav-item
            aria-current={active ? "page" : undefined}
            title={`g${NAV_SHORTCUTS[key]} · ${labels[key] ?? key}`}
            className={cn(
              // Collapsed: 36×36 square centered in the rail. Expanded (on
              // sidebar hover): grows to full width with icon + label row.
              "group mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-[14px] font-medium transition-all duration-200",
              "group-hover/sidebar:mx-0 group-hover/sidebar:w-full group-hover/sidebar:justify-start group-hover/sidebar:gap-2.5 group-hover/sidebar:px-2.5",
              active
                ? "nav-active text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
            )}
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center"
              aria-hidden
            >
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <span className="max-w-0 flex-1 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover/sidebar:max-w-[200px] group-hover/sidebar:opacity-100">
              {labels[key] ?? key}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // Home is an exact match only (otherwise /app matches every /app/* route).
  if (href === "/app") return pathname === "/app";
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}
