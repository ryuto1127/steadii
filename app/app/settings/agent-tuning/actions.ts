"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import type { AgentDraftAction } from "@/lib/db/schema";
import {
  revokePromotion,
  forgiveSender,
  resetAllSenderConfidence,
} from "@/lib/agent/learning/sender-confidence";

// engineer-49 — server actions backing the agent-tuning settings page.
// All three actions are user-scoped: they read `auth().user.id` and
// pass it through to the learner helpers, which only touch rows
// matching that userId. No cross-user mutation is possible from this
// surface.

const ACTION_TYPES: AgentDraftAction[] = [
  "draft_reply",
  "archive",
  "snooze",
  "no_op",
  "ask_clarifying",
  "notify_only",
  "paused",
];

const SenderActionSchema = z.object({
  senderEmail: z.string().email().min(3).max(254),
  actionType: z.enum(ACTION_TYPES as [AgentDraftAction, ...AgentDraftAction[]]),
});

async function getUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
}

export async function revokePromotionAction(
  formData: FormData
): Promise<void> {
  const userId = await getUserId();
  const parsed = SenderActionSchema.parse({
    senderEmail: formData.get("sender_email"),
    actionType: formData.get("action_type"),
  });
  await revokePromotion({
    userId,
    senderEmail: parsed.senderEmail,
    actionType: parsed.actionType,
  });
  revalidatePath("/app/settings/agent-tuning");
}

export async function forgiveSenderAction(formData: FormData): Promise<void> {
  const userId = await getUserId();
  const parsed = SenderActionSchema.parse({
    senderEmail: formData.get("sender_email"),
    actionType: formData.get("action_type"),
  });
  await forgiveSender({
    userId,
    senderEmail: parsed.senderEmail,
    actionType: parsed.actionType,
  });
  revalidatePath("/app/settings/agent-tuning");
}

export async function resetAllSenderConfidenceAction(): Promise<void> {
  const userId = await getUserId();
  await resetAllSenderConfidence(userId);
  revalidatePath("/app/settings/agent-tuning");
}
