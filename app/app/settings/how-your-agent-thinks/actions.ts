"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { agentRules } from "@/lib/db/schema";
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
