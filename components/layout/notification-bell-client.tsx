"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { HighRiskPendingItem } from "@/lib/agent/email/pending-queries";

// localStorage marker for the most recent moment the user opened the
// notification dropdown. Used to compute the "unseen" red dot client-side
// without an extra DB column. Per-browser, not synced cross-device — fine
// for α since the dot is a hint, not a critical signal.
const STORAGE_KEY = "steadii.notif.lastSeen";

export function NotificationBellClient({
  items,
}: {
  items: HighRiskPendingItem[];
}) {
  const [open, setOpen] = useState(false);
  const [lastSeenIso, setLastSeenIso] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Hydrate last-seen from localStorage after mount. Pre-mount we mirror
  // the server's "dot if any pending items" behavior so SSR + first client
  // render match (no hydration warning).
  useEffect(() => {
    setMounted(true);
    setLastSeenIso(localStorage.getItem(STORAGE_KEY));
  }, []);

  // Click-outside dismiss. Only attached while open to avoid the listener
  // running on every page where the bell mounts.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Toggling open is the "I've seen these" signal — bump lastSeen
  // immediately so the dot disappears on this open and only returns when a
  // strictly newer pending item shows up.
  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = new Date().toISOString();
      try {
        localStorage.setItem(STORAGE_KEY, now);
      } catch {
        // localStorage unavailable (Safari private mode, etc.) — degrade to
        // session-only state.
      }
      setLastSeenIso(now);
    }
  }

  // Clicking a notification row navigates to the draft. Close the popover
  // before the navigation so the user doesn't see a stale dropdown
  // momentarily on the destination page.
  function handleItemClick() {
    setOpen(false);
  }

  const hasItems = items.length > 0;
  const hasUnseen = !mounted
    ? hasItems
    : items.some((i) => {
        if (!lastSeenIso) return true;
        return new Date(i.receivedAt).getTime() > new Date(lastSeenIso).getTime();
      });

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-hover hover:bg-[hsl(var(--surface-raised))]"
      >
        <Bell
          size={16}
          strokeWidth={1.75}
          className="text-[hsl(var(--muted-foreground))]"
        />
        {hasUnseen ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--destructive))]"
          />
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-[340px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1 shadow-lg">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            Needs attention
          </div>
          {!hasItems ? (
            <div className="px-3 py-2 text-small text-[hsl(var(--muted-foreground))]">
              No high-risk items right now.
            </div>
          ) : (
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.agentDraftId}>
                  <Link
                    href={`/app/inbox/${item.agentDraftId}`}
                    onClick={handleItemClick}
                    className="flex flex-col gap-0.5 rounded-md px-3 py-2 transition-hover hover:bg-[hsl(var(--surface-raised))]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider ${
                          item.riskTier === "high"
                            ? "text-[hsl(var(--destructive))]"
                            : item.riskTier === "medium"
                              ? "text-[hsl(38_92%_40%)]"
                              : "text-[hsl(var(--muted-foreground))]"
                        }`}
                      >
                        {item.riskTier}
                      </span>
                      <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
                        {item.senderName}
                      </span>
                    </div>
                    <div className="truncate text-[12px] text-[hsl(var(--muted-foreground))]">
                      {item.subject}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 border-t border-[hsl(var(--border))] px-3 py-2">
            <Link
              href="/app/inbox"
              onClick={handleItemClick}
              className="text-[12px] text-[hsl(var(--primary))] hover:underline"
            >
              View all →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
