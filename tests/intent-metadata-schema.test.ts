import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";

import { taskIntentMetadata } from "@/lib/db/schema";
// Helpers come from the no-DB-deps version module so the test doesn't
// trip env validation in lib/db/client.ts.
import {
  CLASSIFIER_VERSION,
  hashTitleForClassifier,
} from "@/lib/agent/intent-classifier-version";

// 2026-05-19 — Phase 2a schema-level checks. Verifies the new
// task_intent_metadata table matches the migration shape and the
// metadata-store helpers behave as documented.

describe("task_intent_metadata schema", () => {
  it("exposes the columns the store + migration both write", () => {
    const cols = getTableColumns(taskIntentMetadata);
    const expected = [
      "id",
      "userId",
      "source",
      "externalId",
      "title",
      "intent",
      "confidence",
      "matchedPattern",
      "matchedEntityId",
      "matchedClassCode",
      "preview",
      "titleHash",
      "classifierVersion",
      "classifiedAt",
    ];
    for (const name of expected) {
      expect(cols).toHaveProperty(name);
    }
  });

  it("requires userId / source / externalId / title / intent / confidence / titleHash / classifierVersion", () => {
    const cols = getTableColumns(taskIntentMetadata);
    expect(cols.userId.notNull).toBe(true);
    expect(cols.source.notNull).toBe(true);
    expect(cols.externalId.notNull).toBe(true);
    expect(cols.title.notNull).toBe(true);
    expect(cols.intent.notNull).toBe(true);
    expect(cols.confidence.notNull).toBe(true);
    expect(cols.titleHash.notNull).toBe(true);
    expect(cols.classifierVersion.notNull).toBe(true);
  });

  it("allows null on optional tagging columns (preview, matched_*)", () => {
    const cols = getTableColumns(taskIntentMetadata);
    expect(cols.preview.notNull).toBe(false);
    expect(cols.matchedPattern.notNull).toBe(false);
    expect(cols.matchedEntityId.notNull).toBe(false);
    expect(cols.matchedClassCode.notNull).toBe(false);
  });
});

describe("hashTitleForClassifier", () => {
  it("returns a 16-character hex hash", () => {
    const h = hashTitleForClassifier("Reply to Sample Corp");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same title → same hash", () => {
    const a = hashTitleForClassifier("Reply to Sample Corp");
    const b = hashTitleForClassifier("Reply to Sample Corp");
    expect(a).toBe(b);
  });

  it("ignores leading / trailing whitespace", () => {
    const a = hashTitleForClassifier("Reply to Sample Corp");
    const b = hashTitleForClassifier("   Reply to Sample Corp\n");
    expect(a).toBe(b);
  });

  it("differs for different titles", () => {
    const a = hashTitleForClassifier("Reply to Sample Corp");
    const b = hashTitleForClassifier("Reply to Acme Travel");
    expect(a).not.toBe(b);
  });
});

describe("CLASSIFIER_VERSION", () => {
  it("is a non-empty version string", () => {
    expect(typeof CLASSIFIER_VERSION).toBe("string");
    expect(CLASSIFIER_VERSION.length).toBeGreaterThan(0);
  });

  it("starts with 'v' so re-classification gates can compare lex", () => {
    expect(CLASSIFIER_VERSION).toMatch(/^v\d/);
  });
});
