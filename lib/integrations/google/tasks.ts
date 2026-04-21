import "server-only";
import { google, type tasks_v1 } from "googleapis";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";

export class TasksNotConnectedError extends Error {
  code = "TASKS_NOT_CONNECTED" as const;
  constructor() {
    super("Google Tasks is not connected for this user.");
  }
}

export async function getTasksForUser(
  userId: string
): Promise<tasks_v1.Tasks> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!row) throw new TasksNotConnectedError();
  if (!row.scope?.includes("tasks")) throw new TasksNotConnectedError();

  const e = env();
  const oauth2 = new google.auth.OAuth2(e.AUTH_GOOGLE_ID, e.AUTH_GOOGLE_SECRET);
  oauth2.setCredentials({
    access_token: row.access_token ?? undefined,
    refresh_token: row.refresh_token ?? undefined,
    expiry_date: row.expires_at ? row.expires_at * 1000 : undefined,
    scope: row.scope ?? undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await db
        .update(accounts)
        .set({
          access_token: tokens.access_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : row.expires_at,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accounts.provider, "google"),
            eq(accounts.providerAccountId, row.providerAccountId)
          )
        );
    }
  });

  return google.tasks({ version: "v1", auth: oauth2 });
}

// Strip bogus time from `due`: Google returns YYYY-MM-DDT00:00:00.000Z but the
// time is meaningless — treat the leading YYYY-MM-DD as a local-date-only value.
export function dueDateOnly(due: string | null | undefined): string | null {
  if (!due) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(due);
  return m ? m[1] : null;
}

// Inverse: build the `due` wire format Google expects for a local date.
export function dueFromDateOnly(date: string): string {
  return `${date}T00:00:00.000Z`;
}
