"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { removeIgnoredSender } from "@/lib/agent/email/ignored-senders";
import { logEmailAudit } from "@/lib/agent/email/audit";

// 今後この送信者を無視 — server action backing the settings "解除" (remove)
// button. User-scoped: reads auth().user.id and only deletes rows
// matching that userId. No cross-user mutation is possible from this
// surface.

const RemoveSchema = z.object({
  senderEmail: z.string().trim().email().min(3).max(254),
});

async function getUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
}

export async function removeIgnoredSenderAction(
  formData: FormData
): Promise<void> {
  const userId = await getUserId();
  const parsed = RemoveSchema.parse({
    senderEmail: formData.get("sender_email"),
  });
  const removed = await removeIgnoredSender({
    userId,
    senderEmail: parsed.senderEmail,
  });
  if (removed) {
    await logEmailAudit({
      userId,
      action: "ignore_sender_removed",
      result: "success",
      detail: { senderEmail: parsed.senderEmail.toLowerCase() },
    });
  }
  revalidatePath("/app/settings/ignored-senders");
  revalidatePath("/app");
}
