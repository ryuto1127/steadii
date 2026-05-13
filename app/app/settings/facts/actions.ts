"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  auditLog,
  userFacts,
  type UserFactCategory,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";

// engineer-47 — settings server actions for /app/settings/facts.
//
// Upsert: same shape as the save_user_fact tool's onConflict path, so a
// user editing a fact in Settings and the LLM re-saving the same fact
// converge on one row. Soft-delete only; the row stays in DB for audit
// even after the user clicks "Forget".

const ALLOWED_CATEGORIES: UserFactCategory[] = [
  "schedule",
  "communication_style",
  "location_timezone",
  "academic",
  "personal_pref",
  "other",
];

function coerceCategory(raw: FormDataEntryValue | null): UserFactCategory {
  if (typeof raw !== "string") return "other";
  return (ALLOWED_CATEGORIES as string[]).includes(raw)
    ? (raw as UserFactCategory)
    : "other";
}

// Upsert path for the "Add new fact" form + the inline edit form. Both
// hand us (id?, fact, category). When id is present and the fact text is
// unchanged we PATCH the existing row; when the fact text changed we
// soft-delete the old row and insert a new one (so the soft-unique
// index keeps the (user_id, fact) pair sane). Empty fact is a no-op.
export async function userFactUpsertAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const id = formData.get("id");
  const idStr = typeof id === "string" && id.length > 0 ? id : null;
  const factRaw = formData.get("fact");
  const factText = typeof factRaw === "string" ? factRaw.trim() : "";
  if (factText.length === 0 || factText.length > 500) return;
  const category = coerceCategory(formData.get("category"));
  const now = new Date();

  if (idStr) {
    // Edit path — only the owner can update their row. Soft-deleted rows
    // are filtered out so a stale id from a re-submitted form can't
    // resurrect a fact the user deleted.
    const [existing] = await db
      .select({ id: userFacts.id, fact: userFacts.fact })
      .from(userFacts)
      .where(
        and(
          eq(userFacts.id, idStr),
          eq(userFacts.userId, userId),
          isNull(userFacts.deletedAt)
        )
      )
      .limit(1);
    if (!existing) {
      // Either the id is wrong or it doesn't belong to this user — 403
      // implicitly. Bail without surfacing a distinguishing error so we
      // don't leak existence.
      return;
    }
    if (existing.fact === factText) {
      // Category-only edit; no soft-unique churn needed.
      await db
        .update(userFacts)
        .set({ category })
        .where(eq(userFacts.id, idStr));
    } else {
      // Fact text changed — upsert via the same onConflict path the chat
      // tool uses, then soft-delete the old row if the new sentence
      // landed on a different id. The (userId, fact) unique index
      // already enforces dedup on the live set.
      const [upserted] = await db
        .insert(userFacts)
        .values({
          userId,
          fact: factText,
          category,
          source: "user_explicit",
          confidence: null,
          lastUsedAt: now,
        })
        .onConflictDoUpdate({
          target: [userFacts.userId, userFacts.fact],
          set: {
            category,
            source: "user_explicit",
            confidence: null,
            lastUsedAt: now,
            deletedAt: null,
          },
        })
        .returning({ id: userFacts.id });
      if (upserted.id !== idStr) {
        await db
          .update(userFacts)
          .set({ deletedAt: now })
          .where(
            and(
              eq(userFacts.id, idStr),
              eq(userFacts.userId, userId)
            )
          );
      }
    }
    await db.insert(auditLog).values({
      userId,
      action: "user_fact_edited",
      resourceType: "user_fact",
      resourceId: idStr,
      result: "success",
      detail: { fact: factText, category },
    });
  } else {
    // Add-new path — same onConflict semantics so re-adding a previously
    // soft-deleted fact restores it instead of conflict-erroring.
    const [row] = await db
      .insert(userFacts)
      .values({
        userId,
        fact: factText,
        category,
        source: "user_explicit",
        confidence: null,
        lastUsedAt: now,
      })
      .onConflictDoUpdate({
        target: [userFacts.userId, userFacts.fact],
        set: {
          category,
          source: "user_explicit",
          confidence: null,
          lastUsedAt: now,
          deletedAt: null,
        },
      })
      .returning({ id: userFacts.id });
    await db.insert(auditLog).values({
      userId,
      action: "user_fact_saved",
      resourceType: "user_fact",
      resourceId: row.id,
      result: "success",
      detail: { fact: factText, category, source: "user_explicit" },
    });
  }
  revalidatePath("/app/settings/facts");
}

export async function userFactDeleteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) return;

  const [row] = await db
    .update(userFacts)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(userFacts.id, id),
        eq(userFacts.userId, userId),
        isNull(userFacts.deletedAt)
      )
    )
    .returning({ id: userFacts.id });
  if (!row) return;
  await db.insert(auditLog).values({
    userId,
    action: "user_fact_deleted",
    resourceType: "user_fact",
    resourceId: row.id,
    result: "success",
  });
  revalidatePath("/app/settings/facts");
}
