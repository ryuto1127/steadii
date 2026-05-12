// engineer-42 — pure helpers used by the Type F confirm/correct server
// actions in `app/app/queue-actions.ts`. Kept out of the "use server"
// file so Next.js doesn't treat the helpers as RPCs and so tests can
// exercise the merge contract without a DB mock.

import type {
  ContactStructuredFacts,
  StructuredFactEntry,
} from "@/lib/db/schema";

// Read existing structured_facts blob, set the targeted key at confidence
// 1.0, return the merged blob. Critical: do not clobber sibling keys —
// users may have separately-confirmed timezone + language facts on the
// same persona row.
export function applyUserConfirmedFact(
  existing: ContactStructuredFacts,
  key: keyof ContactStructuredFacts,
  value: string,
  nowIso: string = new Date().toISOString()
): ContactStructuredFacts {
  const entry: StructuredFactEntry<string> = {
    value,
    confidence: 1.0,
    source: "user_confirmed",
    samples: 0,
    confirmedAt: nowIso,
  };
  return {
    ...existing,
    [key]: entry,
  } as ContactStructuredFacts;
}

// Topic strings come from the L2 tool's free-form `topic` field. Only the
// three typed structured_facts entries (timezone, primary_language,
// response_window_hours) map to a structured persona write; everything
// else returns null so the confirm path flips status without touching
// persona — preserves the engineer-41 schema contract.
export function normalizeStructuredFactKey(
  topic: string
): keyof ContactStructuredFacts | null {
  switch (topic) {
    case "timezone":
      return "timezone";
    case "primary_language":
    case "language_preference":
      return "primary_language";
    case "response_window_hours":
      return "response_window_hours";
    default:
      return null;
  }
}
