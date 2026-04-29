import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";

export type ConnectedProvider = "google" | "microsoft-entra-id";

// Detect which write-capable integrations the user has connected, gated by
// the scope string actually granted. A row in `accounts` exists once the
// user signs in with the provider, but write tools only fire if the
// re-consented scope includes the relevant *.ReadWrite suffix.
export async function getConnectedCalendarProviders(
  userId: string
): Promise<ConnectedProvider[]> {
  const rows = await db
    .select({ provider: accounts.provider, scope: accounts.scope })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const out: ConnectedProvider[] = [];
  for (const r of rows) {
    if (r.provider === "google" && r.scope?.includes("calendar")) {
      out.push("google");
    }
    if (
      r.provider === "microsoft-entra-id" &&
      r.scope?.toLowerCase().includes("calendars.readwrite")
    ) {
      out.push("microsoft-entra-id");
    }
  }
  return out;
}

export async function getConnectedTasksProviders(
  userId: string
): Promise<ConnectedProvider[]> {
  const rows = await db
    .select({ provider: accounts.provider, scope: accounts.scope })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const out: ConnectedProvider[] = [];
  for (const r of rows) {
    if (r.provider === "google" && r.scope?.includes("tasks")) {
      out.push("google");
    }
    if (
      r.provider === "microsoft-entra-id" &&
      r.scope?.toLowerCase().includes("tasks.readwrite")
    ) {
      out.push("microsoft-entra-id");
    }
  }
  return out;
}

// Look up the source type for a given event externalId so update/delete
// dispatches can route to the right provider. Returns null when the event
// isn't in the local mirror — caller should default to Google for legacy
// agents that haven't read the event via list_events first.
export async function lookupEventSource(args: {
  userId: string;
  externalId: string;
}): Promise<string | null> {
  const { events } = await import("@/lib/db/schema");
  const [row] = await db
    .select({ sourceType: events.sourceType })
    .from(events)
    .where(
      and(
        eq(events.userId, args.userId),
        eq(events.externalId, args.externalId)
      )
    )
    .limit(1);
  return row?.sourceType ?? null;
}
