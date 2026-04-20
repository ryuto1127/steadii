"use server";

import { auth } from "@/lib/auth/config";
import { setUserConfirmationMode } from "@/lib/agent/preferences";
import type { ConfirmationMode } from "@/lib/agent/confirmation";
import { redirect } from "next/navigation";

export async function setConfirmationModeAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const raw = formData.get("mode");
  if (raw !== "destructive_only" && raw !== "all" && raw !== "none") {
    throw new Error("invalid mode");
  }
  await setUserConfirmationMode(session.user.id, raw as ConfirmationMode);
  redirect("/app/settings");
}
