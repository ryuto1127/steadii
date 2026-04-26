import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  accounts,
  icalSubscriptions,
  notionConnections,
  type IntegrationSourceId,
} from "@/lib/db/schema";

export type IntegrationSource = {
  id: IntegrationSourceId;
  label: string;
  oneLine: string;
  // The href the connect button submits to / links to. iCal renders an
  // inline form instead, so its `href` is null and the surface is
  // expected to know how to render the iCal-add form.
  href: string | null;
};

export const INTEGRATION_SOURCES: ReadonlyArray<IntegrationSource> = [
  {
    id: "microsoft",
    label: "Microsoft 365",
    oneLine:
      "Bring your Outlook calendar and Microsoft To Do into Steadii alongside Google.",
    // Drives signIn("microsoft-entra-id"); routed via a dedicated server
    // action so the surfaces don't import next-auth directly.
    href: "/api/auth/signin/microsoft-entra-id",
  },
  {
    id: "ical",
    label: "iCal subscription",
    oneLine:
      "Paste a school timetable URL (.ics) so deadlines show up in Steadii's planning.",
    href: null,
  },
  {
    id: "notion",
    label: "Notion",
    oneLine:
      "Import your existing classes, mistakes, syllabi, and assignments from Notion.",
    href: "/api/integrations/notion/connect",
  },
];

// Did the user already connect this integration? "Connected" means the
// minimal evidence we'd accept that the user has gotten value from it —
// account row exists for OAuth providers, ≥1 active subscription for iCal.
export async function isSourceConnected(
  userId: string,
  source: IntegrationSourceId
): Promise<boolean> {
  if (source === "microsoft") {
    const [row] = await db
      .select({ id: accounts.providerAccountId })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.provider, "microsoft-entra-id")
        )
      )
      .limit(1);
    return !!row;
  }
  if (source === "notion") {
    const [row] = await db
      .select({ id: notionConnections.id })
      .from(notionConnections)
      .where(eq(notionConnections.userId, userId))
      .limit(1);
    return !!row;
  }
  if (source === "ical") {
    const [row] = await db
      .select({ id: icalSubscriptions.id })
      .from(icalSubscriptions)
      .where(
        and(
          eq(icalSubscriptions.userId, userId),
          eq(icalSubscriptions.active, true)
        )
      )
      .limit(1);
    return !!row;
  }
  return false;
}
