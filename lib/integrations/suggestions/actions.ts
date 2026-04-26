"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import {
  type IntegrationSourceId,
  type SuggestionSurface,
} from "@/lib/db/schema";
import { recordSuggestionDismissal } from "./impressions";

const VALID_SOURCES: ReadonlyArray<IntegrationSourceId> = [
  "microsoft",
  "ical",
  "notion",
];
const VALID_SURFACES: ReadonlyArray<SuggestionSurface> = [
  "onboarding_step2",
  "trigger_inbox_outlook",
  "trigger_chat_ical",
  "trigger_mistakes_notion",
];

export async function dismissSuggestionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");

  const source = formData.get("source");
  const surface = formData.get("surface");
  const revalidate = formData.get("revalidate");

  if (typeof source !== "string" || typeof surface !== "string")
    throw new Error("Invalid form payload");
  if (!VALID_SOURCES.includes(source as IntegrationSourceId))
    throw new Error("Unknown source");
  if (!VALID_SURFACES.includes(surface as SuggestionSurface))
    throw new Error("Unknown surface");

  await recordSuggestionDismissal(
    session.user.id,
    source as IntegrationSourceId,
    surface as SuggestionSurface
  );

  if (typeof revalidate === "string" && revalidate.startsWith("/")) {
    revalidatePath(revalidate);
  }
}
