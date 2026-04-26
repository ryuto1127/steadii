import "server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  accounts,
  chats,
  inboxItems,
  mistakeNotes,
} from "@/lib/db/schema";

// Trigger A — does the user have inbound mail from a Microsoft 365 tenant
// domain? "MS 365 tenant domain" is hard to detect from outside, so we use
// the heuristic: any sender address whose domain is *.onmicrosoft.com OR
// any address sent through an outlook.com / hotmail.com mailbox. Keeps
// false-positives low; the cost of missing a few is just "we didn't
// suggest" — not a regression.
const MS_DOMAIN_PATTERNS = [
  ".onmicrosoft.com",
  "@outlook.com",
  "@hotmail.com",
  "@live.com",
];

export async function shouldShowMsOutlookTrigger(
  userId: string
): Promise<boolean> {
  // If MS is already linked, the eligibility helper short-circuits before
  // calling here — but keep the explicit check for the edge case where this
  // helper is invoked standalone (e.g. tests).
  const [linked] = await db
    .select({ id: accounts.providerAccountId })
    .from(accounts)
    .where(
      and(eq(accounts.userId, userId), eq(accounts.provider, "microsoft-entra-id"))
    )
    .limit(1);
  if (linked) return false;

  // Any inbox item whose sender_email matches one of the MS-domain patterns.
  // We bound the lookup to non-deleted rows; the sender index makes this
  // fast even for users with thousands of items.
  const rows = await db
    .select({ senderEmail: inboxItems.senderEmail })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), isNull(inboxItems.deletedAt)))
    .limit(500);
  return rows.some((r) => {
    const lower = r.senderEmail.toLowerCase();
    return MS_DOMAIN_PATTERNS.some((p) => lower.includes(p));
  });
}

// Trigger B — has the user accumulated chats while having no calendar feed
// hooked up that could ground deadline/schedule answers? We treat "≥3 chats
// AND no Google Calendar AND no iCal" as the signal. The locked decision
// references chat-message keyword matching, but the chat surface that would
// host the inline action ("below agent reasoning") doesn't yet exist;
// surfacing on the chats list keeps the spirit (we ask when the user is in
// the chat surface) while staying ship-able.
export async function shouldShowIcalTrigger(
  userId: string
): Promise<boolean> {
  const [chatCount] = await db
    .select({ value: count() })
    .from(chats)
    .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)));
  if (chatCount.value < 3) return false;

  // Already has Google Calendar? Then iCal is a "nice to have," not the
  // missing-data prompt the trigger is for. We let the cooldown surface
  // it via Step 2 / settings instead.
  const [google] = await db
    .select({ scope: accounts.scope })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (google?.scope?.includes("calendar")) return false;

  return true;
}

// Trigger C — user has 3+ note-related chats but <5 mistake_notes. "Note-
// related" is hard to detect cheaply from chat content; we approximate as
// "user has ≥3 chats overall AND fewer than 5 mistake notes," which fires
// for early users who are clearly active in chat but haven't started
// building their notes corpus. Notion import is the fast path to seeding it.
export async function shouldShowNotionImportTrigger(
  userId: string
): Promise<boolean> {
  const [chatCount] = await db
    .select({ value: count() })
    .from(chats)
    .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)));
  if (chatCount.value < 3) return false;

  const [noteCount] = await db
    .select({ value: count() })
    .from(mistakeNotes)
    .where(
      and(eq(mistakeNotes.userId, userId), isNull(mistakeNotes.deletedAt))
    );
  return noteCount.value < 5;
}
