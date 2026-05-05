"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Inbox,
  Home,
  MessagesSquare,
  GraduationCap,
  Calendar,
  ListChecks,
  Activity as ActivityIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  NAV_HREFS,
  NAV_ITEM_KEYS,
  NAV_SHORTCUTS,
  SECONDARY_NAV_ITEM_KEYS,
  type NavItemKey,
} from "./nav-items";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<NavItemKey, LucideIcon> = {
  inbox: Inbox,
  home: Home,
  chats: MessagesSquare,
  classes: GraduationCap,
  calendar: Calendar,
  tasks: ListChecks,
  activity: ActivityIcon,
};

export function SidebarNav({
  labels,
  badges,
  expanded = false,
}: {
  labels: Record<string, string>;
  // Server-fetched per-item counts. Today only `inbox` ships a badge
  // (pending agent_drafts), but the prop is keyed by NavItemKey so we
  // can extend without a new prop. Zero / missing → render no badge.
  badges?: Partial<Record<NavItemKey, number>>;
  // When true, labels and badge pills render at full width without
  // waiting for the rail's hover-reveal — used by the mobile drawer
  // where there is no hover state.
  expanded?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const containerRef = useRef<HTMLElement>(null);
  const t = useTranslations("primary_nav");

  // Global shortcut: press `g` then one of the per-item letters
  // (h/i/c/t/k/j) to jump. Skip when an input/textarea/contentEditable is
  // focused. The shortcut map covers BOTH the primary and secondary nav
  // blocks so the demoted 履歴 (j) still has its hotkey.
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

  const renderItem = (key: NavItemKey) => {
    const Icon = ICONS[key];
    const href = NAV_HREFS[key];
    const active = isActive(pathname, href);
    const badgeCount = badges?.[key] ?? 0;
    const showBadge = badgeCount > 0;
    return (
      <Link
        key={key}
        href={href}
        data-nav-item
        data-pending-count={showBadge ? badgeCount : undefined}
        aria-current={active ? "page" : undefined}
        title={`g${NAV_SHORTCUTS[key]} · ${labels[key] ?? key}${
          showBadge ? ` (${badgeCount} pending)` : ""
        }`}
        className={cn(
          "group/nav relative flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-medium",
          active
            ? "text-[hsl(var(--foreground))]"
            : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-9 rounded-lg transition-[width,background-color,opacity] duration-200",
            expanded ? "w-full" : "group-hover/sidebar:w-full",
            active
              ? "nav-active"
              : "opacity-0 group-hover/nav:bg-[hsl(var(--surface-raised))] group-hover/nav:opacity-100"
          )}
        />
        <span
          className="relative flex h-4 w-4 shrink-0 items-center justify-center"
          aria-hidden
        >
          <Icon size={16} strokeWidth={1.75} />
          {showBadge ? (
            <span
              data-nav-badge-dot
              aria-hidden
              className={cn(
                "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(38_92%_50%)] ring-2 ring-[hsl(var(--background))]",
                expanded ? "hidden" : "group-hover/sidebar:hidden"
              )}
            />
          ) : null}
        </span>
        <span
          className={cn(
            "relative flex flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap transition-all duration-200",
            expanded
              ? "max-w-[200px] opacity-100"
              : "max-w-0 opacity-0 group-hover/sidebar:max-w-[200px] group-hover/sidebar:opacity-100"
          )}
        >
          <span className="truncate">{labels[key] ?? key}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {showBadge ? (
              <span
                data-nav-badge-count
                aria-label={`${badgeCount} pending`}
                className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[hsl(38_92%_50%)] px-1.5 text-[11px] font-semibold leading-none tabular-nums text-[hsl(var(--foreground))] dark:bg-[hsl(38_92%_55%)] dark:text-[hsl(220_20%_10%)]"
              >
                {badgeCount > 99 ? "99+" : badgeCount}
              </span>
            ) : null}
            <kbd
              data-nav-shortcut
              aria-hidden
              className="rounded bg-[hsl(var(--surface))] px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] opacity-70"
            >
              g{NAV_SHORTCUTS[key]}
            </kbd>
          </span>
        </span>
      </Link>
    );
  };

  return (
    <nav
      ref={containerRef}
      onKeyDown={handleNavKey}
      className="flex-1 space-y-0.5"
      aria-label={t("aria_label")}
    >
      {NAV_ITEM_KEYS.map(renderItem)}
      {SECONDARY_NAV_ITEM_KEYS.length > 0 ? (
        <div
          aria-hidden
          data-nav-separator
          className={cn(
            "my-2 h-px bg-[hsl(var(--border)/0.6)] transition-opacity duration-200",
            expanded ? "opacity-100" : "opacity-0 group-hover/sidebar:opacity-100"
          )}
        />
      ) : null}
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
