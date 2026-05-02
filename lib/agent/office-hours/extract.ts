import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { OfficeHoursSlot } from "@/lib/db/schema";

// Wave 3.3 — office hours LLM extraction.
// Wave 1 syllabus ingestion already pulled the office_hours TEXT field
// verbatim. This pass runs only when scheduling is requested (or as
// part of a one-shot backfill script) and converts the freeform string
// into structured weekly slots.
//
// We also surface optional fields the parser commonly catches:
//   - Booking URL (Calendly, scheduling links from email signatures)
//   - Professor email (for the To: when we draft the request)

const SYSTEM_PROMPT = `You parse a university professor's office-hours statement into structured slots.

Input is a short string from a syllabus or email — examples:
  "Tuesdays 2-4pm in MP203, Thursdays 10am-12pm by Zoom"
  "By appointment only — book at calendly.com/profx"
  "Fri 13:00-15:00 (本郷キャンパス S101)"

Output JSON:
{
  "slots": [{ "weekday": 0-6, "startTime": "HH:MM", "endTime": "HH:MM", "location": "..."?, "notes": "..."? }],
  "rawNote": null | "...",     // Anything that didn't parse (e.g. "by appointment only")
  "bookingUrl": null | "https://...",
  "professorEmail": null | "..."
}

Rules:
- weekday: 0=Sunday, 1=Monday, ..., 6=Saturday. Match JS Date.getDay().
- startTime / endTime: 24-hour HH:MM in the prof's local time. Convert AM/PM to 24h.
- If the same prof has multiple weekdays, emit one slot per day.
- If no structured slot is parseable (e.g. "by appointment only"), return slots: [] and put the original text in rawNote.
- bookingUrl: only if a clear scheduling URL is present. Don't fabricate.
- professorEmail: only if the input includes one. Don't infer from name.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    slots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          weekday: { type: "integer", minimum: 0, maximum: 6 },
          startTime: { type: "string" },
          endTime: { type: "string" },
          location: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
        required: ["weekday", "startTime", "endTime", "location", "notes"],
      },
    },
    rawNote: { type: ["string", "null"] },
    bookingUrl: { type: ["string", "null"] },
    professorEmail: { type: ["string", "null"] },
  },
  required: ["slots", "rawNote", "bookingUrl", "professorEmail"],
} as const;

export type OfficeHoursExtraction = {
  slots: OfficeHoursSlot[];
  rawNote: string | null;
  bookingUrl: string | null;
  professorEmail: string | null;
};

export async function extractOfficeHours(args: {
  userId: string;
  // The freeform string — usually `syllabi.officeHours` or a syllabus
  // chunk containing office-hours mention.
  text: string;
}): Promise<OfficeHoursExtraction> {
  return Sentry.startSpan(
    {
      name: "office_hours.extract",
      op: "gen_ai.generate",
      attributes: { "steadii.user_id": args.userId },
    },
    async () => {
      const model = selectModel("proactive_proposal");
      const resp = await openai().chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: args.text.slice(0, 4000) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "office_hours",
            strict: true,
            schema: SCHEMA,
          },
        },
      });

      await recordUsage({
        userId: args.userId,
        model,
        taskType: "proactive_proposal",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as {
            prompt_tokens_details?: { cached_tokens?: number };
          })?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      return parseExtraction(resp.choices[0]?.message?.content ?? "{}");
    }
  );
}

export function parseExtraction(raw: string): OfficeHoursExtraction {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const slots = Array.isArray(o.slots)
    ? (o.slots as Array<Record<string, unknown>>)
        .map((s) => normalizeSlot(s))
        .filter((s): s is OfficeHoursSlot => s !== null)
    : [];
  return {
    slots,
    rawNote: typeof o.rawNote === "string" ? o.rawNote : null,
    bookingUrl: typeof o.bookingUrl === "string" ? o.bookingUrl : null,
    professorEmail: typeof o.professorEmail === "string" ? o.professorEmail : null,
  };
}

function normalizeSlot(raw: Record<string, unknown>): OfficeHoursSlot | null {
  const weekday =
    typeof raw.weekday === "number" && raw.weekday >= 0 && raw.weekday <= 6
      ? Math.floor(raw.weekday)
      : null;
  if (weekday === null) return null;
  const startTime = normalizeTime(raw.startTime);
  const endTime = normalizeTime(raw.endTime);
  if (!startTime || !endTime) return null;
  const location =
    typeof raw.location === "string" && raw.location.trim().length > 0
      ? raw.location
      : undefined;
  const notes =
    typeof raw.notes === "string" && raw.notes.trim().length > 0
      ? raw.notes
      : undefined;
  return { weekday, startTime, endTime, location, notes };
}

function normalizeTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mins = Number(m[2]);
  if (h > 23 || mins > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// Generate the next N candidate dates for a given recurring slot, starting
// from `fromDate`. Pure helper — doesn't read the DB.
export function expandSlotToDates(
  slot: OfficeHoursSlot,
  fromDate: Date,
  count: number = 3
): Array<{ startsAt: Date; endsAt: Date; location?: string }> {
  const out: Array<{ startsAt: Date; endsAt: Date; location?: string }> = [];
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  while (out.length < count) {
    if (cursor.getDay() === slot.weekday) {
      const [sh, sm] = slot.startTime.split(":").map(Number);
      const [eh, em] = slot.endTime.split(":").map(Number);
      const startsAt = new Date(cursor);
      startsAt.setHours(sh, sm, 0, 0);
      const endsAt = new Date(cursor);
      endsAt.setHours(eh, em, 0, 0);
      // Skip slots already in the past.
      if (startsAt > fromDate) {
        out.push({ startsAt, endsAt, location: slot.location });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    // Safety bail — never scan more than 60 days ahead.
    if (cursor.getTime() - fromDate.getTime() > 60 * 24 * 60 * 60 * 1000) break;
  }
  return out;
}
