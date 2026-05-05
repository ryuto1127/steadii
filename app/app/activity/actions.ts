"use server";

import { z } from "zod";
import { auth } from "@/lib/auth/config";
import {
  loadActivityRows,
  type ActivityCursor,
  type ActivityKind,
} from "@/lib/activity/load";

// Pagination — the client load-more button hits this with the cursor of
// the last row currently rendered, gets the next page back, and appends.
// Returns rows already serialized for the wire (Date → ISO) so the
// timeline component can rehydrate without extra plumbing.

const cursorSchema = z.object({
  occurredAt: z.string(),
  id: z.string(),
});

const argsSchema = z.object({
  cursor: cursorSchema.nullable(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type SerializedRow = {
  id: string;
  occurredAt: string;
  kind: ActivityKind;
  primary: string;
  secondary?: string;
  detailHref?: string;
};

export async function loadActivityPage(args: {
  cursor: ActivityCursor | null;
  limit?: number;
}): Promise<{ rows: SerializedRow[]; nextCursor: ActivityCursor | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const parsed = argsSchema.parse(args);
  const { rows, nextCursor } = await loadActivityRows({
    userId: session.user.id,
    cursor: parsed.cursor,
    limit: parsed.limit ?? 30,
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      kind: r.kind,
      primary: r.primary,
      secondary: r.secondary,
      detailHref: r.detailHref,
    })),
    nextCursor,
  };
}
