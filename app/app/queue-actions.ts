"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  agentConfirmations,
  agentContactPersonas,
  agentDrafts,
  agentProposals,
  autoCreatedCalendarEvents,
  chats,
  eventPreBriefs,
  groupProjects,
  inboxItems,
  messages,
  officeHoursRequests,
  type ActionOption,
  type AgentConfirmation,
} from "@/lib/db/schema";
import {
  approveAgentDraftAction,
  dismissAgentDraftAction,
  snoozeAgentDraftAction,
} from "@/lib/agent/email/draft-actions";
import { processL2 } from "@/lib/agent/email/l2";
import { recordProactiveFeedback } from "@/lib/agent/proactive/feedback-bias";
import {
  executeProactiveAction,
  stampLastMonthlyReviewAt,
} from "@/lib/agent/proactive/action-executor";
import { logEmailAudit } from "@/lib/agent/email/audit";
import { resolveGroupDetectClarification } from "@/lib/agent/groups/detect-actions";
import {
  pickOfficeHoursSlot,
  sendOfficeHoursDraft,
} from "@/lib/agent/office-hours/actions";
import {
  applyUserConfirmedFact,
  normalizeStructuredFactKey,
} from "@/lib/agent/queue/confirmation-fact-merge";
import { calendarCreateEvent } from "@/lib/agent/tools/calendar";
import {
  buildDeadlineDescription,
  buildDeadlineSummary,
  buildEventDescription,
  buildEventSummary,
  buildIsoStartEnd,
} from "@/lib/agent/proactive/auto-cal-slot";
import type { AutoCreatedEventRef } from "@/lib/db/schema";

// Wave 2 — server actions that back the Steadii queue cards on Home.
// Each action accepts a card id of the form `<kind>:<uuid>`; the prefix
// routes to the right pipeline. This avoids coupling the client to the
// underlying tables.
//
// Wave 3 added pre_brief and group_detect_* card kinds — the schema
// enforces the prefix is one of the known kinds; the parser then narrows
// the type.

type CardKind =
  | "proposal"
  | "draft"
  | "pre_brief"
  | "group_detect"
  | "office_hours"
  | "confirmation"
  | "autocal";

const CARD_KINDS: readonly CardKind[] = [
  "proposal",
  "draft",
  "pre_brief",
  "group_detect",
  "office_hours",
  "confirmation",
  "autocal",
];

const cardIdSchema = z
  .string()
  .regex(/^([a-z_]+):[0-9a-f-]{36}$/i);

function parseCardId(raw: string): { kind: CardKind; id: string } {
  const parsed = cardIdSchema.parse(raw);
  const [kind, id] = parsed.split(":");
  if (!CARD_KINDS.includes(kind as CardKind)) {
    throw new Error(`Unknown card kind: ${kind}`);
  }
  return { kind: kind as CardKind, id: id! };
}

async function getUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
}

// Default Dismiss = 24h snooze per spec. We model snooze on drafts via
// the existing snooze action; for proposals there's no snooze column
// today so we mark resolved with a `resolved_action='snooze'` marker —
// the dedup re-fire is gated on a 24h window per existing scanner
// behaviour, so the row will re-surface naturally.
export async function queueDismissAction(rawCardId: string): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind === "draft") {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await snoozeAgentDraftAction(id, until.toISOString());
  } else if (kind === "pre_brief") {
    await dismissPreBrief(userId, id);
  } else if (kind === "group_detect") {
    await resolveGroupDetectClarification(userId, id, {
      pickedKey: null,
      freeText: "",
      decision: "later",
    });
  } else if (kind === "office_hours") {
    await dismissOfficeHoursRequest(userId, id);
  } else if (kind === "confirmation") {
    await dismissConfirmation(userId, id);
  } else {
    await dismissProposalSnooze(userId, id);
  }
  revalidatePath("/app");
}

export async function queueSnoozeAction(
  rawCardId: string,
  hours: number
): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  const clamped = Math.max(1, Math.min(24 * 30, Math.round(hours)));
  if (kind === "draft") {
    const until = new Date(Date.now() + clamped * 60 * 60 * 1000);
    await snoozeAgentDraftAction(id, until.toISOString());
  } else if (kind === "pre_brief") {
    // Pre-briefs have a hard event-driven expiry — we don't honor a
    // user-chosen snooze beyond that. Treat snooze as dismiss.
    await dismissPreBrief(userId, id);
  } else if (kind === "group_detect") {
    await resolveGroupDetectClarification(userId, id, {
      pickedKey: null,
      freeText: "",
      decision: "later",
    });
  } else if (kind === "office_hours") {
    await dismissOfficeHoursRequest(userId, id);
  } else if (kind === "confirmation") {
    // Confirmations auto-stale after 14 days. Treat snooze as dismiss so
    // we don't leak a half-resolved state into the persona writer.
    await dismissConfirmation(userId, id);
  } else {
    await dismissProposalSnooze(userId, id, clamped);
  }
  revalidatePath("/app");
}

export async function queuePermanentDismissAction(
  rawCardId: string
): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind === "draft") {
    await dismissAgentDraftAction(id);
  } else if (kind === "pre_brief") {
    await dismissPreBrief(userId, id);
  } else if (kind === "group_detect") {
    await resolveGroupDetectClarification(userId, id, {
      pickedKey: null,
      freeText: "",
      decision: "not_group",
    });
  } else if (kind === "office_hours") {
    await dismissOfficeHoursRequest(userId, id);
  } else if (kind === "confirmation") {
    await dismissConfirmation(userId, id);
  } else {
    await dismissProposalPermanent(userId, id);
  }
  revalidatePath("/app");
}

// Wave 3.1 — Type B informational secondary actions.
// "mark_reviewed" is the only inline secondary today; it dismisses the
// pre-brief card without re-firing.
export async function queueSecondaryAction(
  rawCardId: string,
  actionKey: string
): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "pre_brief") return;
  if (actionKey === "mark_reviewed") {
    await db
      .update(eventPreBriefs)
      .set({ viewedAt: new Date(), dismissedAt: new Date() })
      .where(
        and(eq(eventPreBriefs.id, id), eq(eventPreBriefs.userId, userId))
      );
    revalidatePath("/app");
  }
}

// 2026-05-24 (PR 3) — 3-way disposition setter for Type B Draft cards.
//
// The disposition row on the card writes one of three values:
//   - 'resolved' (対応済み)  — user handled it; mirrors what the
//                                inbox-side dismiss does on the legacy
//                                status field but uses the canonical
//                                disposition column.
//   - 'skipped'  (スキップ)   — "not now"; re-surfaces after 24h via
//                                the disposition-resurface sweep.
//   - 'ignored'  (無視中)     — never re-surface; the UI guards this
//                                behind a confirm dialog.
//
// Only Type B Draft cards carry the disposition row. Other card kinds
// (proposals, pre-briefs, etc.) keep their existing single-action
// dismiss/snooze flow; the parser rejects non-draft card ids so a
// bug in a future renderer can't write to the wrong table.
const DISPOSITION_INPUT = z.enum(["resolved", "skipped", "ignored"]);

export type QueueDispositionInput = z.infer<typeof DISPOSITION_INPUT>;

export async function queueSetDispositionAction(
  rawCardId: string,
  disposition: QueueDispositionInput
): Promise<void> {
  const userId = await getUserId();
  const parsedDisposition = DISPOSITION_INPUT.parse(disposition);
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "draft") {
    throw new Error("Disposition only applies to Draft cards");
  }
  const now = new Date();
  await db
    .update(agentDrafts)
    .set({
      disposition: parsedDisposition,
      // Only stamp skipped_at when transitioning TO skipped; clear it
      // for the other two so a future re-skip starts fresh.
      skippedAt: parsedDisposition === "skipped" ? now : null,
      updatedAt: now,
    })
    .where(and(eq(agentDrafts.id, id), eq(agentDrafts.userId, userId)));

  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: id,
    detail: { subAction: `disposition_${parsedDisposition}` },
  });
  revalidatePath("/app");
}

// 2026-05-24 (PR 2) — inline Send for Type B draft cards on /app.
//
// Fires after the client-side 10s undo window elapses. The card id is
// `draft:<uuid>`; we extract the underlying agent_drafts row and delegate
// to the shared approveAgentDraftAction. That helper does its own
// server-side QStash undo (defense-in-depth on top of the client wait)
// + the pre-send fact-checker.
//
// Pre-send check policy: skipped here. The queue card is the fast lane
// — when the fact-checker flags a draft the user clicks 確認 to open the
// detail page where the warning modal is wired. Surfacing a modal from
// a sonner toast would clash with the card's fire-and-forget feel.
// Power users who never deviate from the queue still get safety from
// the client undo + the server undo.
export async function queueSendDraftAction(rawCardId: string): Promise<void> {
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "draft") {
    throw new Error("Card is not a draft");
  }
  await approveAgentDraftAction(id, { skipPreSendCheck: true });
  revalidatePath("/app");
}

// Wave 3.3 — office-hours Type B "Send" handler.
export async function queueSendOfficeHoursAction(
  rawCardId: string
): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "office_hours") throw new Error("Card is not an office hours request");
  await sendOfficeHoursDraft({ userId, requestId: id });
  revalidatePath("/app");
}

// Type A — picks an option from the proposal's actionOptions[].
// Mirrors the /api/agent/proposal/[id]/resolve endpoint but accessible
// as a server action so the queue cards can call it inline.
export async function queueResolveProposalAction(
  rawCardId: string,
  actionKey: string
): Promise<{ redirectTo?: string }> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);

  if (kind === "office_hours") {
    if (actionKey === "edit") {
      // Wave 3.3 ship: "Edit questions" routes to a future detail page.
      // For now we treat it as dismiss since the card already shows the
      // question list inline.
      return {};
    }
    const m = actionKey.match(/^slot:(\d+)$/);
    if (!m) throw new Error("Invalid slot key");
    const slotIndex = Number(m[1]);
    await pickOfficeHoursSlot({ userId, requestId: id, slotIndex });
    return {};
  }

  if (kind !== "proposal") throw new Error("Card is not a proposal");

  const [proposal] = await db
    .select()
    .from(agentProposals)
    .where(
      and(eq(agentProposals.id, id), eq(agentProposals.userId, userId))
    )
    .limit(1);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "pending") {
    throw new Error("Proposal already resolved");
  }
  const option = (proposal.actionOptions as ActionOption[]).find(
    (o) => o.key === actionKey
  );
  if (!option) throw new Error("Invalid action");

  const result = await executeProactiveAction({
    userId,
    option,
    proposal,
  });

  await db
    .update(agentProposals)
    .set({
      status: "resolved",
      resolvedAction: actionKey,
      resolvedAt: new Date(),
      viewedAt: proposal.viewedAt ?? new Date(),
    })
    .where(eq(agentProposals.id, id));

  await recordProactiveFeedback({
    userId,
    issueType: proposal.issueType,
    userResponse: "sent",
    proposalId: id,
  });

  revalidatePath("/app");
  return { redirectTo: result.redirectTo };
}

// engineer-46 — Type E "Steadii と話す" entry point. Opens a chat
// session seeded with the inbox item + the L2 reasoning so the student
// can resolve the ambiguity collaboratively, not via the single-shot
// textarea. The orchestrator detects this case via
// `chats.clarifyingDraftId` and prepends a continuation system prompt
// + makes the `resolve_clarification` tool available.
//
// The first assistant message renders Steadii's clarifying question
// verbatim from the original draft row, so the chat opens already
// showing the question instead of a blank canvas.
export async function startClarificationChatAction(
  rawCardId: string
): Promise<{ chatId: string }> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "draft") {
    throw new Error("Card is not a clarifying draft");
  }

  const [row] = await db
    .select({ draft: agentDrafts, inbox: inboxItems })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(and(eq(agentDrafts.id, id), eq(agentDrafts.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Draft not found");
  if (row.draft.action !== "ask_clarifying") {
    throw new Error("Draft is not a clarifying-input card");
  }
  if (row.draft.status !== "pending") {
    throw new Error("Draft is no longer pending");
  }

  // Title makes the /app/chats sidebar entry recognizable instead of
  // showing the generic "New chat" placeholder. Keep it short — the
  // queue-driven chat-title cron would also rewrite this later if it
  // ran, but the seeded value is fine for first paint.
  const senderLabel = row.inbox.senderName ?? row.inbox.senderEmail;
  const title = `${senderLabel} — ${row.inbox.subject ?? "(no subject)"}`.slice(
    0,
    120
  );

  const [chat] = await db
    .insert(chats)
    .values({
      userId,
      title,
      clarifyingDraftId: row.draft.id,
    })
    .returning({ id: chats.id });

  // First assistant turn renders the clarifying question so the chat
  // doesn't open blank. Card body is built from draft.reasoning today
  // (see lib/agent/queue/build.ts:594), so we mirror that here. When
  // a draft has neither reasoning nor body we fall back to a generic
  // prompt; the orchestrator's seed-system block still carries the
  // full context so the agent can pick up from there.
  const seedContent =
    (row.draft.reasoning?.trim() ||
      row.draft.draftBody?.trim() ||
      `${senderLabel} からのメールについて、少し確認させてください。詳しいことを教えてもらえますか?`).slice(
      0,
      4000
    );

  await db.insert(messages).values({
    chatId: chat.id,
    role: "assistant",
    content: seedContent,
  });

  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: row.draft.id,
    detail: {
      subAction: "clarification_chat_opened",
      chatId: chat.id,
    },
  });

  return { chatId: chat.id };
}

// Type E — clarifying input. When the user types a free-text answer and
// submits, we (a) log the audit entry, (b) re-run L2 against the same
// inbox item with the answer threaded into the agentic-L2 user message
// as authoritative context, then (c) dismiss the original ask_clarifying
// draft. The re-run typically produces a fresh draft row in the queue
// within a few seconds — the user no longer has to wait for the next
// inbound email from the same sender for their input to land.
//
// When `freeText` is empty (radio-only clarification), we skip the
// re-run and fall back to the original audit + dismiss flow.
//
// Wave 3.2 adds group_detect cards, which also show as Type E but resolve
// to a different pipeline (creates a group_projects row on confirm).
export async function queueSubmitClarificationAction(
  rawCardId: string,
  args: { pickedKey: string | null; freeText: string }
): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);

  if (kind === "group_detect") {
    await resolveGroupDetectClarification(userId, id, {
      pickedKey: args.pickedKey,
      freeText: args.freeText,
      decision: args.pickedKey === "create" ? "create" : "not_group",
    });
    revalidatePath("/app");
    return;
  }

  if (kind !== "draft") throw new Error("Card is not a clarifying card");

  const [row] = await db
    .select({ draft: agentDrafts, inbox: inboxItems })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(and(eq(agentDrafts.id, id), eq(agentDrafts.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Draft not found");
  if (row.draft.action !== "ask_clarifying") {
    throw new Error("Draft is not a clarifying-input card");
  }

  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: id,
    detail: {
      subAction: "queue_clarification_response",
      pickedKey: args.pickedKey,
      freeText: args.freeText.slice(0, 1000),
    },
  });

  // engineer-45 — immediate re-run path. When the user supplied free-
  // text, thread it into a fresh processL2 call so the agentic loop
  // can re-decide the action with the clarification as authoritative
  // input. Empty / whitespace-only freeText falls through to the
  // original audit + dismiss only flow (radio-only clarifications
  // don't carry new context for the loop).
  const trimmed = (args.freeText ?? "").trim();
  if (trimmed.length > 0) {
    try {
      await processL2(row.inbox.id, { userClarification: trimmed });
    } catch (err) {
      // The re-run is best-effort: a transient failure should not
      // strip the user's clarification from the audit log or block
      // the dismissal of the original draft. The error already lives
      // in Sentry via processL2's own span instrumentation.
      console.error("[queueSubmitClarificationAction] re-run failed", err);
    }
  }

  // Mark the original draft dismissed — the user's answer is captured
  // in the audit log AND, when present, in the new draft produced by
  // the re-run above.
  await db
    .update(agentDrafts)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(eq(agentDrafts.id, id));
  revalidatePath("/app");
}

// ── Internal helpers ─────────────────────────────────────────────────

async function dismissProposalSnooze(
  userId: string,
  proposalId: string,
  hours: number = 24
): Promise<void> {
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const [proposal] = await db
    .select({ issueType: agentProposals.issueType })
    .from(agentProposals)
    .where(
      and(eq(agentProposals.id, proposalId), eq(agentProposals.userId, userId))
    )
    .limit(1);
  await db
    .update(agentProposals)
    .set({
      status: "dismissed",
      resolvedAction: "snooze",
      resolvedAt: new Date(),
      expiresAt,
      viewedAt: new Date(),
    })
    .where(
      and(eq(agentProposals.id, proposalId), eq(agentProposals.userId, userId))
    );
  // engineer-49 — monthly check-in dismiss path also stamps the cadence
  // preference so the rule waits another 30 days before re-firing.
  if (proposal?.issueType === "monthly_boundary_review") {
    await stampLastMonthlyReviewAt(userId);
  }
  // Soft snooze: feedback bias stays neutral — we don't want a snooze
  // to bias the scanner away from this issue type.
}

async function dismissOfficeHoursRequest(
  userId: string,
  requestId: string
): Promise<void> {
  await db
    .update(officeHoursRequests)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(
      and(
        eq(officeHoursRequests.id, requestId),
        eq(officeHoursRequests.userId, userId)
      )
    );
}

async function dismissPreBrief(
  userId: string,
  preBriefId: string
): Promise<void> {
  await db
    .update(eventPreBriefs)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(eventPreBriefs.id, preBriefId),
        eq(eventPreBriefs.userId, userId)
      )
    );
}

async function dismissProposalPermanent(
  userId: string,
  proposalId: string
): Promise<void> {
  const [proposal] = await db
    .select({ issueType: agentProposals.issueType })
    .from(agentProposals)
    .where(
      and(eq(agentProposals.id, proposalId), eq(agentProposals.userId, userId))
    )
    .limit(1);
  if (!proposal) return;

  await db
    .update(agentProposals)
    .set({
      status: "dismissed",
      resolvedAction: "dismissed",
      resolvedAt: new Date(),
      viewedAt: new Date(),
    })
    .where(
      and(eq(agentProposals.id, proposalId), eq(agentProposals.userId, userId))
    );

  // engineer-49 — monthly check-in permanent-dismiss also stamps
  // cadence so the rule honors the user's "looks good" signal.
  if (proposal.issueType === "monthly_boundary_review") {
    await stampLastMonthlyReviewAt(userId);
  }

  await recordProactiveFeedback({
    userId,
    issueType: proposal.issueType,
    userResponse: "dismissed",
    proposalId,
  });
}

// ── engineer-42 — Type F confirmations ───────────────────────────────

// Confirm = the inferred value was correct. Flip status, pin the
// inferred value into agent_contact_personas.structured_facts at
// confidence 1.0, stamp confirmedAt.
export async function queueConfirmAction(rawCardId: string): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "confirmation") {
    throw new Error("Card is not a confirmation");
  }
  const row = await loadPendingConfirmation(userId, id);
  if (!row) return; // already resolved → idempotent no-op
  const value = (row.inferredValue ?? "").trim();
  if (!value) {
    // Nothing to pin; just flip status so the card disappears.
    await markConfirmationResolved(id, "confirmed", null);
    revalidatePath("/app");
    return;
  }
  await markConfirmationResolved(id, "confirmed", value);
  if (row.senderEmail) {
    await upsertStructuredFact({
      userId,
      contactEmail: row.senderEmail,
      topic: row.topic,
      value,
    });
  }
  revalidatePath("/app");
}

// Correct = user supplied a different value. Persona persistence is the
// same shape as confirm, but with the user's value at confidence 1.0.
export async function queueCorrectAction(
  rawCardId: string,
  correctedValue: string
): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "confirmation") {
    throw new Error("Card is not a confirmation");
  }
  const trimmed = (correctedValue ?? "").trim();
  if (!trimmed) {
    throw new Error("Corrected value is required");
  }
  const row = await loadPendingConfirmation(userId, id);
  if (!row) return;
  await markConfirmationResolved(id, "corrected", trimmed);
  if (row.senderEmail) {
    await upsertStructuredFact({
      userId,
      contactEmail: row.senderEmail,
      topic: row.topic,
      value: trimmed,
    });
  }
  revalidatePath("/app");
}

async function loadPendingConfirmation(
  userId: string,
  id: string
): Promise<AgentConfirmation | null> {
  const [row] = await db
    .select()
    .from(agentConfirmations)
    .where(
      and(
        eq(agentConfirmations.id, id),
        eq(agentConfirmations.userId, userId),
        eq(agentConfirmations.status, "pending")
      )
    )
    .limit(1);
  return row ?? null;
}

async function markConfirmationResolved(
  id: string,
  status: "confirmed" | "corrected" | "dismissed",
  resolvedValue: string | null
): Promise<void> {
  const now = new Date();
  await db
    .update(agentConfirmations)
    .set({
      status,
      resolvedValue,
      resolvedAt: now,
      updatedAt: now,
    })
    // Status guard so a concurrent double-click is a no-op rather than a
    // double-write.
    .where(
      and(
        eq(agentConfirmations.id, id),
        eq(agentConfirmations.status, "pending")
      )
    );
}

async function dismissConfirmation(
  userId: string,
  id: string
): Promise<void> {
  const row = await loadPendingConfirmation(userId, id);
  if (!row) return;
  // Dismiss = "don't ask me". Persona is NOT written.
  await markConfirmationResolved(id, "dismissed", null);
}

// Read existing structured_facts blob, set the targeted key at
// confidence 1.0, write back. Critical: do not clobber other keys —
// users may have separately-confirmed timezone + language facts on the
// same persona row, and we never want one Type F resolve to wipe another.
async function upsertStructuredFact(args: {
  userId: string;
  contactEmail: string;
  topic: string;
  value: string;
}): Promise<void> {
  const key = normalizeStructuredFactKey(args.topic);
  if (!key) return;
  const email = args.contactEmail.trim().toLowerCase();
  if (!email) return;

  const [existing] = await db
    .select({
      id: agentContactPersonas.id,
      structuredFacts: agentContactPersonas.structuredFacts,
    })
    .from(agentContactPersonas)
    .where(
      and(
        eq(agentContactPersonas.userId, args.userId),
        eq(agentContactPersonas.contactEmail, email)
      )
    )
    .limit(1);

  if (existing) {
    const merged = applyUserConfirmedFact(
      existing.structuredFacts ?? {},
      key,
      args.value
    );
    await db
      .update(agentContactPersonas)
      .set({ structuredFacts: merged, updatedAt: new Date() })
      .where(eq(agentContactPersonas.id, existing.id));
  } else {
    const facts = applyUserConfirmedFact({}, key, args.value);
    await db.insert(agentContactPersonas).values({
      userId: args.userId,
      contactEmail: email,
      facts: [],
      structuredFacts: facts,
    });
  }
}

// ── 2026-05-24 — Round-3 propose-confirm auto-cal Type G' actions ────
//
// The agent now PROPOSES events instead of writing them to Google
// Calendar before user confirmation. The three actions below cover
// the user's three response paths on a Type G' card:
//
//   Add to calendar   → call calendarCreateEvent NOW with the
//                       proposal's agreed slot, persist event_refs,
//                       flip status to 'confirmed'. The actual user
//                       calendar is only touched here, never at
//                       propose time.
//   Edit              → mutate agreedSlot in DB only (no calendar
//                       call). User must follow up with Add to commit.
//   Dismiss           → flip status to 'cancelled' (no calendar
//                       call since event_refs is empty for proposals).
//
// All three are scoped to userId, audit-logged, and idempotent.

// Title used when calendarCreateEvent runs from a Type G' Add action.
// Falls back to a generic label if the agreedSlot doesn't carry a
// topic (legacy mutual_agreement rows don't store one — for those
// the card surfaces the inbound subject which the client passes via
// the editProposal "title" mutation, persisted to a fresh
// proposal-side metadata column post-α). For now use a stable default.
const DEFAULT_MUTUAL_AGREEMENT_TITLE = "Meeting";

// Add = user clicked カレンダーに追加 on a Type G' proposal card.
// Calls calendarCreateEvent with the agreed slot, persists the
// resulting event refs, and flips status to 'confirmed'. Errors in
// the calendar create surface back to the caller so the toast can
// distinguish "succeeded but couldn't reach the calendar" from
// "proposal not actionable anymore".
export async function autoCalProposalAddAction(
  rawCardId: string,
): Promise<{ undoToken?: string }> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "autocal") {
    throw new Error("Card is not an auto-cal proposal");
  }
  const [row] = await db
    .select()
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.id, id),
        eq(autoCreatedCalendarEvents.userId, userId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error("Proposal not found");
  }
  // Only 'proposed' rows are actionable here. 'confirmed' = already
  // added; 'cancelled' = user already dismissed. 'provisional' is
  // legacy — those rows shouldn't surface in the Type G' queue but
  // are guarded against just in case.
  if (row.status !== "proposed") {
    throw new Error(`Proposal is not in 'proposed' state (status=${row.status})`);
  }

  const slot = row.agreedSlot;
  const isAllDay = slot.durationMin === 0;

  // Build the calendar event payload from the agreed slot. For
  // all-day deadline-kind rows, calendarCreateEvent treats
  // YYYY-MM-DD strings as all-day; for timed mutual_agreement rows
  // we go through buildIsoStartEnd for RFC3339 + correct offset.
  let summary: string;
  let start: string;
  let end: string;
  let description: string;

  if (row.kind === "deadline") {
    // Deadline proposals store the topic in a custom field added when
    // edit lands; pre-edit rows fall back to a stable default.
    const topic =
      (row.agreedSlot as { topic?: string }).topic?.trim() ||
      "Deadline";
    summary = buildDeadlineSummary(topic);
    start = slot.date;
    end = slot.date;
    description = buildDeadlineDescription({
      reasoning: `Confirmed by user from Steadii queue at ${new Date().toISOString()}.`,
      date: slot.date,
      timezone: slot.timezone,
      topic,
    });
  } else if (row.kind === "event") {
    // Scheduled event: TIMED (like mutual_agreement, NOT all-day). The
    // detector stored the topic in the slot blob; a user title override
    // (set via Edit) wins when present.
    const topic =
      (row.agreedSlot as { title?: string }).title?.trim() ||
      (row.agreedSlot as { topic?: string }).topic?.trim() ||
      "Event";
    summary = buildEventSummary(topic);
    const { startIso, endIso } = buildIsoStartEnd(slot);
    start = startIso;
    end = endIso;
    description = buildEventDescription({
      reasoning: `Confirmed by user from Steadii queue at ${new Date().toISOString()}.`,
      date: slot.date,
      startTime: slot.startTime,
      timezone: slot.timezone,
      durationMin: slot.durationMin,
      topic,
    });
  } else {
    // mutual_agreement: timed event. Use stored title override if
    // the user edited it; otherwise the stable default.
    summary =
      (row.agreedSlot as { title?: string }).title?.trim() ||
      DEFAULT_MUTUAL_AGREEMENT_TITLE;
    const { startIso, endIso } = buildIsoStartEnd(slot);
    start = startIso;
    end = endIso;
    description = `Added to your calendar from a detected mutual scheduling agreement, confirmed by you in Steadii queue.\n\nAgreed slot: ${slot.date} ${slot.startTime} ${slot.timezone}${
      isAllDay ? "" : ` (${slot.durationMin} min)`
    }.`;
  }

  const created = await calendarCreateEvent.execute(
    { userId },
    {
      summary,
      start,
      end,
      description,
    },
  );

  const eventRefs: AutoCreatedEventRef[] = created.createdIn.map(
    (provider) => ({
      provider,
      eventId: created.eventId,
      htmlLink: created.htmlLink,
    }),
  );

  await db
    .update(autoCreatedCalendarEvents)
    .set({
      status: "confirmed",
      eventRefs,
    })
    .where(eq(autoCreatedCalendarEvents.id, id));

  await logEmailAudit({
    userId,
    action: "auto_cal_proposal_added",
    result: "success",
    resourceId: id,
    detail: {
      autoCreateId: id,
      kind: row.kind,
      agreedSlot: row.agreedSlot,
      eventRefs,
    },
  });

  revalidatePath("/app");
  return {};
}

// Edit = user changed date / start / end / title on a proposal via
// the inline editor. Mutates agreedSlot in DB only — does NOT touch
// the calendar. The user still has to click Add to commit. The
// schema's agreedSlot blob already accommodates date / startTime /
// durationMin; title and (deadline-kind) topic are stored alongside
// in the same JSONB column so this PR doesn't need a fresh schema
// change.
const editProposalArgsSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    durationMin: z.number().int().min(0).max(60 * 24).optional(),
    title: z.string().min(1).max(200).optional(),
  })
  .strict();

export type AutoCalProposalEditArgs = z.infer<typeof editProposalArgsSchema>;

export async function autoCalProposalEditAction(
  rawCardId: string,
  rawArgs: AutoCalProposalEditArgs,
): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "autocal") {
    throw new Error("Card is not an auto-cal proposal");
  }
  const args = editProposalArgsSchema.parse(rawArgs);

  const [row] = await db
    .select()
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.id, id),
        eq(autoCreatedCalendarEvents.userId, userId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error("Proposal not found");
  }
  if (row.status !== "proposed") {
    throw new Error(`Proposal is not in 'proposed' state (status=${row.status})`);
  }

  // Merge the requested fields onto the existing slot blob. Untouched
  // fields stay as-is. The `title` field is stored in the same JSONB
  // alongside the structural slot — keeps the schema flat without
  // a separate column at α scope.
  const merged: typeof row.agreedSlot & { title?: string } = {
    ...(row.agreedSlot as typeof row.agreedSlot & { title?: string }),
    ...(args.date ? { date: args.date } : {}),
    ...(args.startTime ? { startTime: args.startTime } : {}),
    ...(args.durationMin !== undefined ? { durationMin: args.durationMin } : {}),
    ...(args.title ? { title: args.title } : {}),
  };

  await db
    .update(autoCreatedCalendarEvents)
    .set({
      agreedSlot: merged,
    })
    .where(eq(autoCreatedCalendarEvents.id, id));

  await logEmailAudit({
    userId,
    action: "auto_cal_proposal_edited",
    result: "success",
    resourceId: id,
    detail: {
      autoCreateId: id,
      kind: row.kind,
      before: row.agreedSlot,
      after: merged,
    },
  });

  revalidatePath("/app");
}

// Dismiss = user clicked 破棄 on a proposal. Flip status to
// 'cancelled' — no calendar API call since event_refs is empty
// (proposals never created a calendar event in the first place).
export async function autoCalProposalDismissAction(
  rawCardId: string,
): Promise<void> {
  const userId = await getUserId();
  const { kind, id } = parseCardId(rawCardId);
  if (kind !== "autocal") {
    throw new Error("Card is not an auto-cal proposal");
  }
  const [row] = await db
    .select()
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.id, id),
        eq(autoCreatedCalendarEvents.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return; // already gone → idempotent
  // Idempotent on already-dismissed rows. We deliberately allow
  // dismissing 'proposed' AND legacy 'provisional' rows — the latter
  // lets users clean up rows from before the propose-confirm flow
  // shipped. Confirmed rows are no-ops (the calendar event is the
  // user's now; deletion belongs in Google Calendar).
  if (row.status !== "proposed" && row.status !== "provisional") return;

  await db
    .update(autoCreatedCalendarEvents)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
    })
    .where(eq(autoCreatedCalendarEvents.id, id));

  await logEmailAudit({
    userId,
    action: "auto_cal_proposal_dismissed",
    result: "success",
    resourceId: id,
    detail: {
      autoCreateId: id,
      kind: row.kind,
      priorStatus: row.status,
    },
  });

  revalidatePath("/app");
}

// ── Legacy shim: queueCancelAutoCalAction / queueConfirmAutoCalAction ─
//
// The Wave-3-era queue card on Home wires the two legacy handlers
// (`onCancelAutoCal` / `onConfirmAutoCal`) — those names persist until
// PR B rewires the Type G card to the Add/Edit/Dismiss surface. Both
// shims route to the propose-confirm equivalents so the build stays
// green between PR A merge and PR B merge:
//   Cancel  → Dismiss   (no calendar API call; proposal cancelled)
//   Confirm → Add       (calendar event finally created)
// Remove these shims once PR B lands.
export async function queueCancelAutoCalAction(rawCardId: string): Promise<void> {
  await autoCalProposalDismissAction(rawCardId);
}

export async function queueConfirmAutoCalAction(
  rawCardId: string,
): Promise<void> {
  await autoCalProposalAddAction(rawCardId);
}

// ── 2026-05-24 — Round 4 propose-confirm auto-archive batch (Type H) ──
//
// The Type H queue card surfaces a batch confirmation for inbox rows
// the auto-archive detector flagged (`proposed_archive_at` set). The
// user has three paths:
//
//   confirmAll(undefined)       — archive every currently-proposed item
//   confirmAll({ inboxItemIds }) — archive the user-selected subset
//   dismissAll()                 — clear every proposal; nothing archived
//
// Both actions are scoped to userId and idempotent (already-archived
// rows are skipped, not double-counted). Audit logs preserve the
// existing 'auto_archive' shape on confirm so Wave 5 downstream
// readers (digest section, Hidden chip, activity feed) keep working
// unchanged; only the detector's `auto_archive_proposed` step is new.

const inboxItemIdSchema = z.string().uuid();
const archiveConfirmArgsSchema = z
  .object({
    inboxItemIds: z.array(inboxItemIdSchema).min(1).optional(),
  })
  .strict();

export type ArchiveProposalConfirmArgs = z.infer<
  typeof archiveConfirmArgsSchema
>;

// Confirm = the user clicked [全部アーカイブする] or finalized a per-item
// review subset. For each picked row:
//   - UPDATE inbox_items SET status='archived', auto_archived=true,
//     proposed_archive_at=NULL, proposed_archive_reason=NULL
//   - INSERT audit_log row action='auto_archive' (preserves the
//     existing Wave 5 audit shape — digest, Hidden chip, activity
//     feed all key on this action string).
//
// idempotent: rows whose status is already 'archived' OR whose
// proposed_archive_at is already cleared are skipped silently. We
// only audit the rows actually flipped this call.
export async function archiveProposalConfirmAllAction(
  rawArgs?: ArchiveProposalConfirmArgs,
): Promise<{ archived: number }> {
  const userId = await getUserId();
  const args = rawArgs ? archiveConfirmArgsSchema.parse(rawArgs) : { inboxItemIds: undefined };

  // Pull candidates server-side. We re-fetch (rather than trusting the
  // client list) so two paths share guards:
  //   1. ids are scoped to userId via the WHERE clause
  //   2. we only touch rows actually flagged (proposed_archive_at set)
  //      AND still in a non-archived status — the user could have
  //      moved the email manually in Gmail between propose + confirm.
  const baseWhere = and(
    eq(inboxItems.userId, userId),
    isNotNull(inboxItems.proposedArchiveAt),
  );
  const candidates = await db
    .select({
      id: inboxItems.id,
      status: inboxItems.status,
      autoArchived: inboxItems.autoArchived,
      senderEmail: inboxItems.senderEmail,
      senderDomain: inboxItems.senderDomain,
      subject: inboxItems.subject,
      proposedArchiveReason: inboxItems.proposedArchiveReason,
    })
    .from(inboxItems)
    .where(
      args.inboxItemIds
        ? and(baseWhere, inArray(inboxItems.id, args.inboxItemIds))
        : baseWhere,
    );

  if (candidates.length === 0) {
    revalidatePath("/app");
    revalidatePath("/app/inbox");
    return { archived: 0 };
  }

  const now = new Date();
  let archived = 0;
  for (const row of candidates) {
    // Skip already-archived rows (defensive — possible if the user
    // double-clicked or another path flipped status concurrently).
    if (row.status === "archived" && row.autoArchived) {
      // Clear stale proposed_archive_at so the row drops out of the
      // queue card on next refresh; no audit row needed.
      await db
        .update(inboxItems)
        .set({
          proposedArchiveAt: null,
          proposedArchiveReason: null,
          updatedAt: now,
        })
        .where(eq(inboxItems.id, row.id));
      continue;
    }
    await db
      .update(inboxItems)
      .set({
        status: "archived",
        autoArchived: true,
        proposedArchiveAt: null,
        proposedArchiveReason: null,
        updatedAt: now,
      })
      .where(eq(inboxItems.id, row.id));
    archived++;
    // Audit row mirrors the legacy Wave 5 'auto_archive' shape so
    // existing readers don't need to fork. The `triggered_by` detail
    // discriminates between detector-time archives (impossible
    // post-Round-4) and user-confirm archives so a future audit query
    // can split them.
    try {
      await logEmailAudit({
        userId,
        action: "auto_archive",
        result: "success",
        resourceId: row.id,
        detail: {
          triggeredBy: "user_confirm",
          senderEmail: row.senderEmail,
          senderDomain: row.senderDomain,
          subject: row.subject,
          proposedReason: row.proposedArchiveReason,
        },
      });
    } catch {
      // best-effort — the inbox flip already happened.
    }
  }

  revalidatePath("/app");
  revalidatePath("/app/inbox");
  return { archived };
}

// Dismiss = user clicked [全部キャンセル] on the Type H card. Clears
// every proposed_archive_at flag on the user's inbox (scoped to
// userId). Nothing is archived; items stay visible. Single batched
// audit row carries the count so admin can correlate without joining
// per-item audits.
export async function archiveProposalDismissAllAction(): Promise<{
  cleared: number;
}> {
  const userId = await getUserId();
  // Pull ids first so we can audit-attribute the batch. The partial
  // index makes the SELECT a cheap probe over just the proposed set.
  const candidates = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        isNotNull(inboxItems.proposedArchiveAt),
      ),
    );
  if (candidates.length === 0) {
    revalidatePath("/app");
    revalidatePath("/app/inbox");
    return { cleared: 0 };
  }
  const now = new Date();
  // Single UPDATE — proposed_archive_at IS NOT NULL on a per-user
  // scope. We don't loop per-row here because there's no per-row
  // audit row to emit (the batched dismiss carries one count).
  await db
    .update(inboxItems)
    .set({
      proposedArchiveAt: null,
      proposedArchiveReason: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(inboxItems.userId, userId),
        isNotNull(inboxItems.proposedArchiveAt),
      ),
    );
  try {
    await logEmailAudit({
      userId,
      action: "auto_archive_dismissed_batch",
      result: "success",
      resourceId: null,
      detail: {
        count: candidates.length,
        inboxItemIds: candidates.map((r) => r.id),
      },
    });
  } catch {
    // best-effort
  }
  revalidatePath("/app");
  revalidatePath("/app/inbox");
  return { cleared: candidates.length };
}
