"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  agentConfirmations,
  agentContactPersonas,
  agentRules,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";

// engineer-38 — manual override for the writing-style learner. Soft-deletes
// the rule so the L2 draft prompt stops injecting it. The next style-learner
// run will replace the slate; if the user wants to keep this rule out
// permanently, they can keep clicking remove (the learner uses the rule
// SENTENCE as the unique key, so re-extracting the same rule will resurface
// it). A future iteration could add a "blocked rules" allowlist; for α the
// kill-switch is sufficient.
export async function removeWritingStyleRuleAction(
  formData: FormData
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) return;

  const now = new Date();
  await db
    .update(agentRules)
    .set({ deletedAt: now, enabled: false, updatedAt: now })
    .where(
      and(
        eq(agentRules.id, id),
        eq(agentRules.userId, userId),
        eq(agentRules.scope, "writing_style")
      )
    );
  revalidatePath("/app/settings/how-your-agent-thinks");
}

// engineer-39 — wipe a persona row. The next L2 invocation for this
// contact falls back to the "no learned persona" empty state; the next
// persona-learner cron will regenerate the row from scratch (so deleting
// a persona is "wipe + relearn", not "permanently forget"). The user
// can keep clicking remove if the model keeps proposing a persona they
// dislike — a permanent allowlist is post-α territory.
export async function deletePersonaAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) return;

  await db
    .delete(agentContactPersonas)
    .where(
      and(
        eq(agentContactPersonas.id, id),
        eq(agentContactPersonas.userId, userId)
      )
    );
  revalidatePath("/app/settings/how-your-agent-thinks");
}

// engineer-42 — delete a Type F confirmation row from the "Questions
// Steadii is asking" section. Users come here to revisit answers after
// the fact; "delete" wipes the row so it can't re-surface and the
// persona structured_fact written on confirm is left intact (the user
// is asking us to forget the *question*, not their answer).
export async function deleteConfirmationAction(
  formData: FormData
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) return;

  await db
    .delete(agentConfirmations)
    .where(
      and(
        eq(agentConfirmations.id, id),
        eq(agentConfirmations.userId, userId)
      )
    );
  revalidatePath("/app/settings/how-your-agent-thinks");
}
