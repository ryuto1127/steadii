"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  agentConfirmations,
  agentContactPersonas,
  agentDrafts,
  agentProposals,
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
  | "confirmation";

const CARD_KINDS: readonly CardKind[] = [
  "proposal",
  "draft",
  "pre_brief",
  "group_detect",
  "office_hours",
  "confirmation",
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
