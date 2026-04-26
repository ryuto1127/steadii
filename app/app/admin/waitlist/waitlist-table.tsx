"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveWaitlistAction,
  denyWaitlistAction,
  markGoogleSyncedAction,
  type ApprovalRowResult,
} from "./actions";

export type WaitlistRow = {
  id: string;
  email: string;
  name: string | null;
  university: string | null;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  requestedAt: string; // ISO
  approvedAt: string | null;
  emailSentAt: string | null;
  googleTestUserAddedAt: string | null;
  inviteUrl: string | null;
  stripePromotionCode: string | null;
};

export type Tab =
  | "pending"
  | "approved_unsynced"
  | "approved_synced"
  | "denied"
  | "all";

export function WaitlistTable({
  rows,
  tab,
}: {
  rows: WaitlistRow[];
  tab: Tab;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && selected.size < rows.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function ids(): string[] {
    return Array.from(selected);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function onApprove() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Approve ${selected.size} request(s)? This generates a Stripe Promotion Code and sends an email per row.`
      )
    )
      return;
    startTransition(async () => {
      const results: ApprovalRowResult[] = await approveWaitlistAction(ids());
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      setFeedback(
        failed > 0
          ? `Approved ${ok}, ${failed} failed. Check Sentry for details.`
          : `Approved ${ok}.`
      );
      clearSelection();
      router.refresh();
    });
  }

  function onDeny() {
    if (selected.size === 0) return;
    if (!confirm(`Deny ${selected.size} request(s)? No email will be sent.`))
      return;
    startTransition(async () => {
      await denyWaitlistAction(ids());
      setFeedback(`Denied ${selected.size}.`);
      clearSelection();
      router.refresh();
    });
  }

  function onMarkSynced() {
    if (selected.size === 0) return;
    startTransition(async () => {
      await markGoogleSyncedAction(ids());
      setFeedback(`Marked ${selected.size} as Google-synced.`);
      clearSelection();
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {tab === "pending" ? (
          <>
            <ActionButton
              variant="primary"
              disabled={selected.size === 0 || isPending}
              onClick={onApprove}
            >
              Approve selected ({selected.size})
            </ActionButton>
            <ActionButton
              variant="danger"
              disabled={selected.size === 0 || isPending}
              onClick={onDeny}
            >
              Deny selected ({selected.size})
            </ActionButton>
          </>
        ) : null}
        {tab === "approved_unsynced" ? (
          <ActionButton
            variant="primary"
            disabled={selected.size === 0 || isPending}
            onClick={onMarkSynced}
          >
            完了 mark ({selected.size})
          </ActionButton>
        ) : null}
        {feedback ? (
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {feedback}
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
          (none)
        </p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <th className="py-2 pr-2 font-medium">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="py-2 pr-2 font-medium">Email</th>
              <th className="py-2 pr-2 font-medium">Name</th>
              <th className="py-2 pr-2 font-medium">University</th>
              <th className="py-2 pr-2 font-medium">Reason</th>
              <th className="py-2 pr-2 font-medium">Requested</th>
              <th className="py-2 pr-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[hsl(var(--border))] align-top"
              >
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    aria-label={`Select ${row.email}`}
                  />
                </td>
                <td className="py-2 pr-2 font-mono text-xs">{row.email}</td>
                <td className="py-2 pr-2">{row.name ?? "—"}</td>
                <td className="py-2 pr-2">{row.university ?? "—"}</td>
                <td className="py-2 pr-2 max-w-[260px]">
                  {row.reason ? (
                    <span className="line-clamp-3 text-xs text-[hsl(var(--muted-foreground))]">
                      {row.reason}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-2 font-mono text-xs">
                  {formatDate(row.requestedAt)}
                </td>
                <td className="py-2 pr-2">
                  <StatusBadge row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ row }: { row: WaitlistRow }) {
  if (row.status === "pending") {
    return (
      <span className="rounded-md bg-[hsl(var(--surface-raised))] px-2 py-0.5 font-mono text-[11px]">
        pending
      </span>
    );
  }
  if (row.status === "denied") {
    return (
      <span className="rounded-md bg-[hsl(var(--destructive)/0.1)] px-2 py-0.5 font-mono text-[11px] text-[hsl(var(--destructive))]">
        denied
      </span>
    );
  }
  // approved
  return (
    <div className="flex flex-col gap-0.5 font-mono text-[11px]">
      <span className="rounded-md bg-[hsl(142_76%_36%/0.1)] px-2 py-0.5 text-[hsl(142_76%_36%)]">
        approved
      </span>
      {row.googleTestUserAddedAt ? (
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
          synced {formatDate(row.googleTestUserAddedAt)}
        </span>
      ) : (
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
          awaiting Google sync
        </span>
      )}
      {row.emailSentAt ? (
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
          email sent {formatDate(row.emailSentAt)}
        </span>
      ) : null}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant: "primary" | "danger" | "default";
}) {
  const tone =
    variant === "primary"
      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90"
      : variant === "danger"
        ? "border border-[hsl(var(--destructive))] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.05)]"
        : "border border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center rounded-md px-3 text-xs font-medium transition-hover disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
    >
      {children}
    </button>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
