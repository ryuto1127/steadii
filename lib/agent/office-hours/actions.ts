import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classes,
  officeHoursRequests,
  users,
  type OfficeHoursCandidateSlot,
  type OfficeHoursCompiledQuestion,
  type OfficeHoursRequestRow,
} from "@/lib/db/schema";
import {
  CalendarNotConnectedError,
  getCalendarForUser,
} from "@/lib/integrations/google/calendar";
import {
  createGmailDraft,
  sendGmailDraft,
} from "@/lib/agent/tools/gmail";
import { generateOfficeHoursDraft } from "./draft";

// Wave 3.3 — slot-pick + send orchestration.
//
// pickOfficeHoursSlot:
//   - Records the picked slot index on the request row.
//   - LLM-drafts the email body via generateOfficeHoursDraft.
//   - Transitions status pending → confirmed so the queue surfaces a
//     Type B card.
//
// sendOfficeHoursDraft:
//   - Creates a Gmail draft via the existing helper (so it shows up in
//     the user's Gmail UI immediately).
//   - Sends the draft via existing helper.
//   - Creates a provisional Google Calendar event matching the slot
//     with the question list in the description.
//   - Transitions status confirmed → sent.

export async function pickOfficeHoursSlot(args: {
  userId: string;
  requestId: string;
  slotIndex: number;
}): Promise<{ status: "confirmed" }> {
  const { userId, requestId, slotIndex } = args;

  const [row] = await db
    .select()
    .from(officeHoursRequests)
    .where(
      and(
        eq(officeHoursRequests.id, requestId),
        eq(officeHoursRequests.userId, userId)
      )
    )
    .limit(1);
  if (!row) throw new Error("Office hours request not found");
  if (row.status !== "pending") throw new Error("Slot already picked");

  const slot = (row.candidateSlots ?? [])[slotIndex];
  if (!slot) throw new Error("Invalid slot index");

  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [cls] = row.classId
    ? await db
        .select()
        .from(classes)
        .where(eq(classes.id, row.classId))
        .limit(1)
    : [];

  const draft = await generateOfficeHoursDraft({
    userId,
    userName: user?.name ?? null,
    professorName: row.professorName,
    professorEmail: row.professorEmail,
    classCode: cls?.code ?? null,
    className: cls?.name ?? null,
    topic: row.topic,
    slot,
    questions: row.compiledQuestions ?? [],
  });

  await db
    .update(officeHoursRequests)
    .set({
      pickedSlotIndex: slotIndex,
      draftSubject: draft.subject,
      draftBody: draft.body,
      draftTo: row.professorEmail ?? draft.to,
      status: "confirmed",
      updatedAt: new Date(),
    })
    .where(eq(officeHoursRequests.id, requestId));

  return { status: "confirmed" };
}

export async function sendOfficeHoursDraft(args: {
  userId: string;
  requestId: string;
}): Promise<{ status: "sent"; calendarEventCreated: boolean }> {
  const { userId, requestId } = args;
  const [row] = await db
    .select()
    .from(officeHoursRequests)
    .where(
      and(
        eq(officeHoursRequests.id, requestId),
        eq(officeHoursRequests.userId, userId)
      )
    )
    .limit(1);
  if (!row) throw new Error("Request not found");
  if (row.status !== "confirmed") throw new Error("Draft not ready");
  if (!row.draftTo) throw new Error("Recipient missing");
  if (!row.draftSubject || !row.draftBody) throw new Error("Draft missing");

  const created = await createGmailDraft(userId, {
    to: [row.draftTo],
    subject: row.draftSubject,
    body: row.draftBody,
  });
  const sent = await sendGmailDraft(userId, created.gmailDraftId);

  let calendarEventCreated = false;
  const slot = row.pickedSlotIndex !== null
    ? (row.candidateSlots ?? [])[row.pickedSlotIndex]
    : undefined;
  if (slot) {
    calendarEventCreated = await tryCreateCalendarEvent(userId, {
      slot,
      title: row.draftSubject,
      description: composeEventDescription(
        row.draftBody,
        row.compiledQuestions ?? []
      ),
      attendeeEmail: row.draftTo,
    });
  }

  await db
    .update(officeHoursRequests)
    .set({
      status: "sent",
      sentMessageId: sent.gmailMessageId,
      updatedAt: new Date(),
    })
    .where(eq(officeHoursRequests.id, requestId));

  return { status: "sent", calendarEventCreated };
}

async function tryCreateCalendarEvent(
  userId: string,
  args: {
    slot: OfficeHoursCandidateSlot;
    title: string;
    description: string;
    attendeeEmail: string;
  }
): Promise<boolean> {
  try {
    const cal = await getCalendarForUser(userId);
    await cal.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: args.title,
        description: args.description,
        start: { dateTime: args.slot.startsAt },
        end: { dateTime: args.slot.endsAt },
        location: args.slot.location,
        // Provisional — the prof hasn't confirmed yet. We mark it as
        // tentative so it visually distinguishes from confirmed events.
        status: "tentative",
        attendees: [{ email: args.attendeeEmail }],
      },
    });
    return true;
  } catch (err) {
    if (err instanceof CalendarNotConnectedError) return false;
    // Don't fail the send if calendar create fails — log and move on.
    return false;
  }
}

function composeEventDescription(
  draftBody: string,
  questions: OfficeHoursCompiledQuestion[]
): string {
  const lines: string[] = [];
  lines.push("Provisional — proposed by Steadii via email.");
  lines.push("");
  lines.push("Question list:");
  for (const q of questions) {
    lines.push(`- ${q.label}`);
  }
  lines.push("");
  lines.push("Draft:");
  lines.push(draftBody);
  return lines.join("\n");
}

// Re-export the row type so callers don't need to reach into schema.
export type { OfficeHoursRequestRow };
