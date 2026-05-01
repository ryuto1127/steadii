"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "steadii.inbox.proposals_expanded";
const LAST_SEEN_KEY = "steadii.inbox.proposals_last_seen";

export type NoticedProposal = {
  id: string;
  issueType: string;
  issueSummary: string;
  status: "pending" | "resolved" | "dismissed" | string;
  createdAt: string;
};

export function SteadiiNoticedToggle({
  proposals,
}: {
  proposals: NoticedProposal[];
}) {
  const t = useTranslations("inbox");
  // Default collapsed. The toggle persists across reloads via
  // localStorage; if the user has never set a preference, we auto-expand
  // on the FIRST visit where there's at least one pending proposal newer
  // than `proposals_last_seen` (so a user pulled in by a fresh "Steadii
  // noticed" arrival lands on the expanded view once).
  const [expanded, setExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const lastSeenWriteRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") {
        setExpanded(true);
      } else if (stored === "0") {
        setExpanded(false);
      } else {
        // No preference yet — auto-expand if there's a pending proposal
        // newer than the last-seen marker.
        const lastSeenRaw = window.localStorage.getItem(LAST_SEEN_KEY);
        const lastSeen = lastSeenRaw ? Date.parse(lastSeenRaw) : 0;
        const hasFreshPending = proposals.some(
          (p) =>
            p.status === "pending" && Date.parse(p.createdAt) > lastSeen
        );
        if (hasFreshPending) setExpanded(true);
      }
    } catch {
      // localStorage unavailable — default to collapsed.
    }
    setHydrated(true);
  }, [proposals]);

  // Bump the last-seen marker once the user has actually expanded the
  // section (= had a chance to see the latest items). Persist only once
  // per mount so toggling doesn't churn writes.
  useEffect(() => {
    if (!expanded || lastSeenWriteRef.current) return;
    lastSeenWriteRef.current = true;
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
  }, [expanded]);

  const persistExpanded = (next: boolean) => {
    setExpanded(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const count = proposals.length;
  if (count === 0) return null;

  return (
    <section className="mb-6">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => persistExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
      >
        <Sparkles size={11} strokeWidth={2.5} />
        <span>{t("noticed")}</span>
        <span className="font-mono lowercase tracking-normal">({count})</span>
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`ml-auto transition-default ${
            expanded ? "rotate-90" : "rotate-0"
          }`}
        />
      </button>
      {expanded && hydrated ? (
        <ul className="mt-2 divide-y divide-[hsl(var(--border))] overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          {proposals.map((p) => {
            const isPending = p.status === "pending";
            const isAuto = p.issueType === "auto_action_log";
            return (
              <li key={p.id}>
                <Link
                  href={`/app/inbox/proposals/${p.id}`}
                  className="flex items-start gap-3 px-4 py-3 transition-hover hover:bg-[hsl(var(--surface-raised))]"
                  data-pending={isPending ? "true" : undefined}
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      isAuto
                        ? "text-[hsl(var(--muted-foreground))] bg-[hsl(var(--surface-raised))]"
                        : "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]"
                    }`}
                  >
                    {isAuto ? t("action_pill") : t("proposal_pill")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-[14px] ${
                        isPending
                          ? "font-semibold text-[hsl(var(--foreground))]"
                          : "font-normal text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      <AlertCircle
                        size={11}
                        strokeWidth={2.5}
                        className="mr-1 inline align-text-top"
                      />
                      {p.issueSummary}
                    </div>
                    <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
                      {p.status === "pending"
                        ? t("status_pending")
                        : p.status === "resolved"
                          ? t("status_resolved")
                          : t("status_dismissed")}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
