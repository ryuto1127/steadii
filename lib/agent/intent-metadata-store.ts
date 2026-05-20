// 2026-05-19 — Phase 2a: persistence layer on top of the Phase 1
// intent classifier (lib/agent/intent-classifier.ts).
//
// Responsibilities:
//   1. Load classifier context from the DB (knownEntities + knownClassCodes)
//      so the regex classifier can run its anchored patterns.
//   2. Run classification and persist the result into task_intent_metadata,
//      upserting on the (user_id, source, external_id) unique key.
//   3. Provide a read helper for the UI / Phase 3.
//
// Out of scope for 2a: LLM fallback (Phase 2b) + intent-specific preview
// pre-fetch (Phase 2b). The `preview` column is left null here; the
// matchedEntityId / matchedClassCode tags flow through so Phase 2b's
// pre-fetch can resolve them without re-classifying.

import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  taskIntentMetadata,
  entities,
  classes,
  type TaskIntentSourceValue,
  type TaskIntentValue,
  type TaskIntentPreview,
  type TaskIntentMetadataRow,
} from "@/lib/db/schema";
import {
  classifyTaskIntent,
  type IntentClassification,
  type IntentClassificationContext,
} from "./intent-classifier";
import {
  CLASSIFIER_VERSION,
  hashTitleForClassifier,
} from "./intent-classifier-version";

// Re-export so callers that already import from this module keep working.
export { CLASSIFIER_VERSION, hashTitleForClassifier };

// ---------- Context loader ----------

export async function loadClassifierContext(
  userId: string,
): Promise<IntentClassificationContext> {
  const [entityRows, classRows] = await Promise.all([
    db
      .select({
        id: entities.id,
        displayName: entities.displayName,
        aliases: entities.aliases,
      })
      .from(entities)
      .where(eq(entities.userId, userId)),
    db
      .select({ code: classes.code })
      .from(classes)
      .where(
        and(eq(classes.userId, userId), isNull(classes.deletedAt)),
      ),
  ]);

  const knownEntities = entityRows.map((e) => ({
    id: e.id,
    displayName: e.displayName,
    aliases: e.aliases ?? [],
  }));
  const knownClassCodes = classRows
    .map((r) => r.code)
    .filter((c): c is string => !!c && c.trim().length > 0);

  return { knownEntities, knownClassCodes };
}

// ---------- Classify + persist (upsert) ----------

export type ClassifyAndPersistArgs = {
  userId: string;
  source: TaskIntentSourceValue;
  externalId: string;
  title: string;
};

export type ClassifyAndPersistResult = IntentClassification & {
  // Whether a row already existed and was updated, vs newly inserted.
  upserted: "inserted" | "updated";
};

export async function classifyAndPersistTaskIntent(
  args: ClassifyAndPersistArgs,
): Promise<ClassifyAndPersistResult> {
  const context = await loadClassifierContext(args.userId);
  const result = classifyTaskIntent(args.title, context);
  const titleHash = hashTitleForClassifier(args.title);

  // Drizzle's onConflictDoUpdate doesn't tell us whether the row was
  // an insert or update. We check existence first so the UI / glass-box
  // can show "first classified" vs "re-classified" tags later if it
  // wants. Two queries is fine at α scale.
  const [existing] = await db
    .select({ id: taskIntentMetadata.id })
    .from(taskIntentMetadata)
    .where(
      and(
        eq(taskIntentMetadata.userId, args.userId),
        eq(taskIntentMetadata.source, args.source),
        eq(taskIntentMetadata.externalId, args.externalId),
      ),
    )
    .limit(1);

  await db
    .insert(taskIntentMetadata)
    .values({
      userId: args.userId,
      source: args.source,
      externalId: args.externalId,
      title: args.title,
      intent: result.intent,
      confidence: result.confidence,
      matchedPattern: result.matchedPattern ?? null,
      matchedEntityId: result.matchedEntityId ?? null,
      matchedClassCode: result.matchedClassCode ?? null,
      preview: null,
      titleHash,
      classifierVersion: CLASSIFIER_VERSION,
    })
    .onConflictDoUpdate({
      target: [
        taskIntentMetadata.userId,
        taskIntentMetadata.source,
        taskIntentMetadata.externalId,
      ],
      set: {
        title: args.title,
        intent: result.intent,
        confidence: result.confidence,
        matchedPattern: result.matchedPattern ?? null,
        matchedEntityId: result.matchedEntityId ?? null,
        matchedClassCode: result.matchedClassCode ?? null,
        titleHash,
        classifierVersion: CLASSIFIER_VERSION,
        classifiedAt: new Date(),
      },
    });

  return { ...result, upserted: existing ? "updated" : "inserted" };
}

// ---------- Read ----------

export type IntentMetadataView = {
  intent: TaskIntentValue;
  confidence: number;
  matchedPattern: string | null;
  matchedEntityId: string | null;
  matchedClassCode: string | null;
  preview: TaskIntentPreview | null;
  classifierVersion: string;
  classifiedAt: Date;
};

export async function getIntentMetadata(args: {
  userId: string;
  source: TaskIntentSourceValue;
  externalId: string;
}): Promise<IntentMetadataView | null> {
  const [row] = await db
    .select()
    .from(taskIntentMetadata)
    .where(
      and(
        eq(taskIntentMetadata.userId, args.userId),
        eq(taskIntentMetadata.source, args.source),
        eq(taskIntentMetadata.externalId, args.externalId),
      ),
    )
    .limit(1);

  if (!row) return null;
  return toView(row);
}

export async function getIntentMetadataBatch(args: {
  userId: string;
  refs: ReadonlyArray<{ source: TaskIntentSourceValue; externalId: string }>;
}): Promise<Map<string, IntentMetadataView>> {
  if (args.refs.length === 0) return new Map();
  const rows = await db
    .select()
    .from(taskIntentMetadata)
    .where(eq(taskIntentMetadata.userId, args.userId));

  // Filter client-side. At α scale users have <200 tasks; full-table
  // scan per user is fine and avoids building a complex OR clause.
  const result = new Map<string, IntentMetadataView>();
  const wanted = new Set(args.refs.map((r) => `${r.source}:${r.externalId}`));
  for (const row of rows) {
    const key = `${row.source}:${row.externalId}`;
    if (wanted.has(key)) {
      result.set(key, toView(row));
    }
  }
  return result;
}

function toView(row: TaskIntentMetadataRow): IntentMetadataView {
  return {
    intent: row.intent,
    confidence: row.confidence,
    matchedPattern: row.matchedPattern,
    matchedEntityId: row.matchedEntityId,
    matchedClassCode: row.matchedClassCode,
    preview: row.preview,
    classifierVersion: row.classifierVersion,
    classifiedAt: row.classifiedAt,
  };
}
