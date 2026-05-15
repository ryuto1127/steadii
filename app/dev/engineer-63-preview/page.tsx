import { notFound } from "next/navigation";
import { Engineer63PreviewClient } from "./client";

// engineer-63 verification harness. Renders DraftActionBar + the markdown-
// embedded draft detection on a single dev route so engineer-side
// screenshots can capture all 4 states (idle / confirm modal / edit
// textarea / sent success) at 1440×900 without depending on the dev
// database or a real LLM draft.
//
// Hard-gated behind NODE_ENV !== "production" — same pattern as
// queue-preview / pre-brief-preview / wave5-preview.

export const dynamic = "force-dynamic";

export default async function Engineer63PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Engineer63PreviewClient />;
}
