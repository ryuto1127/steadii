"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export type SidebarNavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  iconOffsetPx?: number;
};

export function SidebarNav({ items }: { items: readonly SidebarNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        const offset = item.iconOffsetPx ?? 0;
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
            <span>{item.label}</span>
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
