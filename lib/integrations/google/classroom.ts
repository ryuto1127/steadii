import "server-only";
import { google, type classroom_v1 } from "googleapis";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { decryptOAuthToken } from "@/lib/auth/oauth-tokens";
import { persistRefreshedOAuthToken } from "@/lib/auth/oauth-refresh-persist";

export class ClassroomNotConnectedError extends Error {
  code = "CLASSROOM_NOT_CONNECTED" as const;
  constructor() {
    super("Google Classroom is not connected for this user.");
  }
}

export async function getClassroomForUser(
  userId: string
): Promise<classroom_v1.Classroom> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!row) throw new ClassroomNotConnectedError();
  if (!row.scope?.includes("classroom.courses.readonly")) {
    throw new ClassroomNotConnectedError();
  }

  const e = env();
  const oauth2 = new google.auth.OAuth2(e.AUTH_GOOGLE_ID, e.AUTH_GOOGLE_SECRET);
  oauth2.setCredentials({
    access_token: decryptOAuthToken(row.access_token) ?? undefined,
    refresh_token: decryptOAuthToken(row.refresh_token) ?? undefined,
    expiry_date: row.expires_at ? row.expires_at * 1000 : undefined,
    scope: row.scope ?? undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await persistRefreshedOAuthToken({
        provider: "google",
        providerAccountId: row.providerAccountId,
        accessTokenPlain: tokens.access_token,
        expiresAtSeconds: tokens.expiry_date
          ? Math.floor(tokens.expiry_date / 1000)
          : row.expires_at,
      });
    }
  });

  return google.classroom({ version: "v1", auth: oauth2 });
}

export function classroomDateToString(
  d: classroom_v1.Schema$Date | undefined | null
): string | null {
  if (!d || !d.year || !d.month || !d.day) return null;
  const m = String(d.month).padStart(2, "0");
  const day = String(d.day).padStart(2, "0");
  return `${d.year}-${m}-${day}`;
}

export function classroomTimeToString(
  t: classroom_v1.Schema$TimeOfDay | undefined | null
): string | null {
  if (!t) return null;
  const h = t.hours ?? 0;
  const m = t.minutes ?? 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
