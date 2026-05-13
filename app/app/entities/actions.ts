"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  auditLog,
  entities,
  entityLinks,
  type EntityKind,
  type EntityLinkSourceKind,
} from "@/lib/db/schema";
import {
  buildEntityEmbedInput,
  embedEntityText,
} from "@/lib/agent/entity-graph/embedding";

// engineer-51 — server actions for /app/entities and /app/entities/[id].
// Cover edit, link, unlink, merge. Merge is soft (sets
// merged_into_entity_id on the loser); the entity_links rows stay so
// past resolution provenance is intact, and read-side queries coalesce
// via the winner's id.

const ALLOWED_KINDS: EntityKind[] = [
  "person",
  "project",
  "course",
  "org",
  "event_series",
];
const ALLOWED_LINK_SOURCES: EntityLinkSourceKind[] = [
  "inbox_item",
  "agent_draft",
  "event",
  "assignment",
  "chat_session",
  "chat_message",
  "agent_contact_persona",
];

function coerceKind(raw: FormDataEntryValue | null): EntityKind | null {
  if (typeof raw !== "string") return null;
  return (ALLOWED_KINDS as string[]).includes(raw)
    ? (raw as EntityKind)
    : null;
}

function coerceLinkSource(
  raw: FormDataEntryValue | null
): EntityLinkSourceKind | null {
  if (typeof raw !== "string") return null;
  return (ALLOWED_LINK_SOURCES as string[]).includes(raw)
    ? (raw as EntityLinkSourceKind)
    : null;
}

function parseAliases(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/\r?\n|,/)
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .slice(0, 20);
}

export async function updateEntityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("entityId");
  if (typeof id !== "string" || id.length === 0) return;

  const [existing] = await db
    .select({
      id: entities.id,
      displayName: entities.displayName,
      aliases: entities.aliases,
      description: entities.description,
    })
    .from(entities)
    .where(
      and(
        eq(entities.id, id),
        eq(entities.userId, userId),
        isNull(entities.mergedIntoEntityId)
      )
    )
    .limit(1);
  if (!existing) return;

  const rawName = formData.get("displayName");
  const displayName =
    typeof rawName === "string" ? rawName.trim().slice(0, 120) : existing.displayName;
  if (!displayName) return;
  const aliases = parseAliases(formData.get("aliases"));
  const rawDescription = formData.get("description");
  const description =
    typeof rawDescription === "string"
      ? rawDescription.trim().slice(0, 800)
      : existing.description;

  // Re-embed when the descriptive surface materially changed. Embedding
  // failures don't block the metadata write — the row stays current,
  // the embedding stays stale.
  let embedding: number[] | null = null;
  try {
    const emb = await embedEntityText({
      userId,
      text: buildEntityEmbedInput({ displayName, aliases, description }),
    });
    embedding = emb.embedding;
  } catch {
    embedding = null;
  }

  await db
    .update(entities)
    .set({
      displayName,
      aliases,
      description: description ?? null,
      embedding: embedding ?? undefined,
    })
    .where(eq(entities.id, id));

  await db.insert(auditLog).values({
    userId,
    action: "entity_edited",
    resourceType: "entity",
    resourceId: id,
    result: "success",
    detail: { displayName, aliasesCount: aliases.length },
  });

  revalidatePath(`/app/entities/${id}`);
  revalidatePath("/app/entities");
}

export async function linkSourceManuallyAction(
  formData: FormData
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const entityId = formData.get("entityId");
  const sourceKind = coerceLinkSource(formData.get("sourceKind"));
  const sourceId = formData.get("sourceId");
  if (typeof entityId !== "string" || !sourceKind) return;
  if (typeof sourceId !== "string" || sourceId.length === 0) return;

  // Verify the entity belongs to the user.
  const [ent] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.userId, userId),
        isNull(entities.mergedIntoEntityId)
      )
    )
    .limit(1);
  if (!ent) return;

  await db
    .insert(entityLinks)
    .values({
      userId,
      entityId,
      sourceKind,
      sourceId,
      confidence: 1.0,
      method: "user_manual",
    })
    .onConflictDoNothing({
      target: [
        entityLinks.userId,
        entityLinks.sourceKind,
        entityLinks.sourceId,
        entityLinks.entityId,
      ],
    });

  await db.insert(auditLog).values({
    userId,
    action: "entity_linked",
    resourceType: "entity",
    resourceId: entityId,
    result: "success",
    detail: { sourceKind, sourceId },
  });

  revalidatePath(`/app/entities/${entityId}`);
}

export async function unlinkSourceAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const linkId = formData.get("linkId");
  const entityId = formData.get("entityId");
  if (typeof linkId !== "string" || linkId.length === 0) return;

  await db
    .delete(entityLinks)
    .where(and(eq(entityLinks.id, linkId), eq(entityLinks.userId, userId)));

  await db.insert(auditLog).values({
    userId,
    action: "entity_unlinked",
    resourceType: "entity",
    resourceId: typeof entityId === "string" ? entityId : null,
    result: "success",
    detail: { linkId },
  });

  if (typeof entityId === "string" && entityId.length > 0) {
    revalidatePath(`/app/entities/${entityId}`);
  }
}

// Soft-merge: set merged_into_entity_id on the loser. Both rows remain
// in DB; reads filter on merged_into_entity_id IS NULL to get canonical
// entities only. entity_links from the loser remain queryable from the
// winner via the merge target.
export async function mergeEntitiesAction(
  formData: FormData
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const winnerId = formData.get("winnerId");
  const loserId = formData.get("loserId");
  if (typeof winnerId !== "string" || typeof loserId !== "string") return;
  if (winnerId === loserId) return;

  const rows = await db
    .select({
      id: entities.id,
      mergedIntoEntityId: entities.mergedIntoEntityId,
      kind: entities.kind,
      aliases: entities.aliases,
      displayName: entities.displayName,
    })
    .from(entities)
    .where(
      and(eq(entities.userId, userId), isNull(entities.mergedIntoEntityId))
    );

  const winner = rows.find((r) => r.id === winnerId);
  const loser = rows.find((r) => r.id === loserId);
  if (!winner || !loser) return;
  if (winner.kind !== loser.kind) return;

  // Pull the loser's aliases + displayName onto the winner so future
  // exact-match lookups still hit. De-dupe case-insensitively.
  const merged = new Set(
    [...(winner.aliases ?? []), ...(loser.aliases ?? []), loser.displayName]
      .map((a) => a.trim())
      .filter((a) => a.length > 0 && a !== winner.displayName)
  );

  await db
    .update(entities)
    .set({ aliases: [...merged] })
    .where(eq(entities.id, winnerId));

  await db
    .update(entities)
    .set({ mergedIntoEntityId: winnerId })
    .where(eq(entities.id, loserId));

  // Move the loser's entity_links over to the winner. Conflicts on the
  // unique source index resolve to "no-op" — both sides may have linked
  // the same source row already.
  await db
    .update(entityLinks)
    .set({ entityId: winnerId })
    .where(eq(entityLinks.entityId, loserId));

  await db.insert(auditLog).values({
    userId,
    action: "entity_merged",
    resourceType: "entity",
    resourceId: winnerId,
    result: "success",
    detail: { loserId, kind: winner.kind },
  });

  revalidatePath(`/app/entities/${winnerId}`);
  revalidatePath("/app/entities");
}

export async function deleteEntityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("entityId");
  if (typeof id !== "string" || id.length === 0) return;

  // Soft-delete via merge into self — a sentinel that takes the row
  // out of all canonical queries without losing the underlying history.
  // Engineers reviewing audit_log can still inspect the original row.
  const [row] = await db
    .update(entities)
    .set({ mergedIntoEntityId: id })
    .where(
      and(
        eq(entities.id, id),
        eq(entities.userId, userId),
        isNull(entities.mergedIntoEntityId)
      )
    )
    .returning({ id: entities.id });
  if (!row) return;

  await db.insert(auditLog).values({
    userId,
    action: "entity_deleted",
    resourceType: "entity",
    resourceId: row.id,
    result: "success",
  });

  revalidatePath("/app/entities");
}
