"use server";

import { auth } from "@/lib/auth/config";
import { restoreFromAutoArchive } from "@/lib/agent/email/auto-archive";
import { revalidatePath } from "next/cache";

// Wave 5 — server action wrapping the restore helper. The Inbox Hidden
// view renders a Restore button per row that posts here; the helper
// flips status, stamps user_restored_at, and seeds the learned
// agent_rules row so similar items don't auto-hide again. The path
// revalidation ensures the freshly-restored row shows back up in the
// default inbox view immediately.
export async function restoreAutoArchivedAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("invalid id");
  }
  const result = await restoreFromAutoArchive(session.user.id, id);
  if (!result.ok) {
    throw new Error(`Restore failed: ${result.reason}`);
  }
  revalidatePath("/app/inbox");
  revalidatePath("/app");
}
