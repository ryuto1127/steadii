// engineer-44 — Multi-tier assignment deadline reminders.
//
// Source-agnostic: reads from `assignments` directly (the snapshot already
// filters out status='done' and deletedAt-non-null rows). Works for manual
// entries, Classroom-synced, chat-tool-created, and future Teams sync —
// the underlying value isn't who created the row, it's the cadence of the
// nag. Replaces the standalone Classroom-deadline-imminent rule for
// non-Classroom data sources.
//
// 4-tier ladder, applied in order — first match wins so a single
// assignment never produces multiple cards in one scan (the scanner
// cron runs 6× hourly; the user would feel spammed otherwise):
//
//   due_today  : 0 ≤ Δ ≤ 24h            any non-done status
//   due_in_1d  : 24h < Δ ≤ 48h          any non-done status
//   due_in_3d  : 48h < Δ ≤ 72h          not_started OR in_progress (copy differs)
//   due_in_7d  : 120h < Δ ≤ 168h        not_started only
//
// Notes on the gaps:
//   - 72h < Δ < 120h (3-5 days out) deliberately quiet.
//   - Past-due (Δ < 0) intentionally out of scope — overdue_assignment
//     is a future separate rule.

import type { ProactiveRule, DetectedIssue, UserSnapshot } from "../types";

const HOUR_MS = 3600 * 1000;

type Tier =
  | { name: "due_today"; hoursLeft: number }
  | { name: "due_in_1d"; hoursLeft: number }
  | { name: "due_in_3d"; variant: "not_started" | "in_progress" }
  | { name: "due_in_7d" };

export const assignmentDeadlineReminderRule: ProactiveRule = {
  name: "assignment_deadline_reminder",
  detect(snapshot) {
    const issues: DetectedIssue[] = [];
    for (const a of snapshot.assignments) {
      if (!a.dueAt) continue;
      if (a.status === "done") continue;
      const deltaMs = a.dueAt.getTime() - snapshot.now.getTime();
      if (deltaMs < 0) continue;
      const tier = pickTier(deltaMs, a.status);
      if (!tier) continue;
      issues.push(buildIssue(a, tier));
    }
    return issues;
  },
};

function pickTier(
  deltaMs: number,
  status: string
): Tier | null {
  const deltaH = deltaMs / HOUR_MS;
  if (deltaH <= 24) {
    return {
      name: "due_today",
      hoursLeft: Math.max(0, Math.ceil(deltaH)),
    };
  }
  if (deltaH <= 48) {
    return {
      name: "due_in_1d",
      hoursLeft: Math.ceil(deltaH),
    };
  }
  if (deltaH <= 72) {
    if (status !== "not_started" && status !== "in_progress") return null;
    return {
      name: "due_in_3d",
      variant: status === "in_progress" ? "in_progress" : "not_started",
    };
  }
  if (deltaH > 120 && deltaH <= 168) {
    if (status !== "not_started") return null;
    return { name: "due_in_7d" };
  }
  return null;
}

function buildIssue(
  a: UserSnapshot["assignments"][number],
  tier: Tier
): DetectedIssue {
  const title = a.title;
  let summary: string;
  let reasoning: string;
  switch (tier.name) {
    case "due_today":
      summary = `「${title}」が今日締切。まだ完了してません`;
      reasoning = `Assignment "${title}" is due today and status is still ${a.status}. Last call — either submit now or accept the late penalty.`;
      break;
    case "due_in_1d":
      summary = `「${title}」が明日締切（残り${tier.hoursLeft}h）`;
      reasoning = `Assignment "${title}" is due tomorrow (${tier.hoursLeft}h left). Status: ${a.status}. Where are you on it?`;
      break;
    case "due_in_3d":
      if (tier.variant === "in_progress") {
        summary = `「${title}」が3日後締切（着手中）`;
        reasoning = `Assignment "${title}" is due in 3 days. You're in progress — final push.`;
      } else {
        summary = `「${title}」が3日後締切、まだ未着手`;
        reasoning = `Assignment "${title}" is due in 3 days and you haven't started. Time to block work.`;
      }
      break;
    case "due_in_7d":
      summary = `「${title}」が1週間後締切、まだ未着手`;
      reasoning = `Assignment "${title}" is due in 7 days. Worth blocking time on the calendar this week.`;
      break;
  }

  return {
    issueType: "assignment_deadline_reminder",
    // Include the tier in the dedup key so the user gets a fresh card
    // as the deadline crosses each threshold (the same assignment fires
    // at 7d, then again at 3d, then 1d, then 0d). Without the tier the
    // dedup index would suppress the escalation.
    sourceRecordIds: [a.id, tier.name],
    issueSummary: summary,
    reasoning,
    sourceRefs: [
      {
        kind: "assignment",
        id: a.id,
        label: title,
      },
    ],
  };
}
