// Phase 2a helpers that don't touch the DB or env config — extracted
// out of intent-metadata-store.ts so unit tests can import them
// without triggering lib/env.ts's runtime env validation.

import { createHash } from "node:crypto";

// Bumped any time the classifier's pattern surface changes substantially.
// Rows persisted under an older version are eligible for opportunistic
// re-classification on next read.
export const CLASSIFIER_VERSION = "v1";

// 16 hex chars (64-bit prefix of SHA-256) is plenty to detect title
// changes without bloating the row.
export function hashTitleForClassifier(title: string): string {
  return createHash("sha256")
    .update(title.trim())
    .digest("hex")
    .slice(0, 16);
}
