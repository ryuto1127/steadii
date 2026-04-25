"use server";

import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { importNotionWorkspace } from "@/lib/integrations/notion/import-to-postgres";

export async function importNotionAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const summary = await importNotionWorkspace({ userId });
  const total =
    summary.classes.inserted +
    summary.classes.updated +
    summary.assignments.inserted +
    summary.assignments.updated +
    summary.mistakes.inserted +
    summary.mistakes.updated +
    summary.syllabi.inserted +
    summary.syllabi.updated;

  redirect(`/app/settings/connections?imported=${total}`);
}
