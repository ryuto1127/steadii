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
import {
  classifyWithLLMIfNeeded,
  type IntentLLMRunner,
} from "./intent-classifier-llm";
import { prefetchDraftEmailReplyPreview } from "./intent-prefetch";

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
  // Test seam — when present, replaces the OpenAI client call inside
  // the LLM fallback. Production code never passes this.
  llmRunnerOverride?: IntentLLMRunner;
};

export type ClassifyAndPersistResult = IntentClassification & {
  // Whether a row already existed and was updated, vs newly inserted.
  upserted: "inserted" | "updated";
  // True when the LLM fallback was invoked. Glass-box UI (Phase 3) uses
  // this to disclose "Steadii used LLM-fallback intent classification".
  llmFallbackUsed: boolean;
  // True when a non-null preview was attached. Phase 3 keys the smart-
  // action button render on this flag.
  previewAttached: boolean;
};

export async function classifyAndPersistTaskIntent(
  args: ClassifyAndPersistArgs,
): Promise<ClassifyAndPersistResult> {
  const context = await loadClassifierContext(args.userId);
  const regexResult = classifyTaskIntent(args.title, context);

  // Phase 2b — LLM fallback when regex confidence is below the trust
  // threshold (0.6). Falls back to the regex result if the LLM call
  // fails or yields a less-confident verdict. Tests inject the runner.
  const result = await classifyWithLLMIfNeeded({
    regexResult,
    title: args.title,
    context,
    runner: args.llmRunnerOverride,
  });
  const llmFallbackUsed = result !== regexResult;

  // Phase 2b — per-intent context pre-fetch. Only DRAFT_EMAIL_REPLY
  // populates a preview today (the canonical use case from
  // 「<会社名>への返信」 tasks). Other intents land as preview=null.
  let preview: TaskIntentPreview | null = null;
  if (
    result.intent === "DRAFT_EMAIL_REPLY" &&
    result.matchedEntityId &&
    typeof result.matchedEntityId === "string"
  ) {
    try {
      preview = await prefetchDraftEmailReplyPreview({
        userId: args.userId,
        entityId: result.matchedEntityId,
      });
    } catch (err) {
      // Pre-fetch failure is non-fatal — the smart-action button
      // simply doesn't include the snippet preview line on this turn.
      // eslint-disable-next-line no-console
      console.warn("[intent-metadata-store] prefetch failed:", err);
    }
  }

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
      preview,
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
        preview,
        titleHash,
        classifierVersion: CLASSIFIER_VERSION,
        classifiedAt: new Date(),
      },
    });

  return {
    ...result,
    upserted: existing ? "updated" : "inserted",
    llmFallbackUsed,
    previewAttached: preview !== null,
  };
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
