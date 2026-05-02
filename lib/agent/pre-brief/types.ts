// Wave 3.1 — meeting pre-brief types.
// The brief is a per-event summary surfaced 15 min before the event with
// attendees. The LLM produces a short bulleted summary covering recent
// interactions, open threads, pending decisions, deadlines, and recent
// mistake notes for the relevant class. The cron caches the result so a
// single brief is generated at most once per (user, event) and reused
// from the queue read path.

import type { PreBriefBullet } from "@/lib/db/schema";

export type PreBriefAttendee = {
  email: string;
  name: string | null;
};

// Inputs the generator collects for a single brief. Stays loose so the
// caller can stub it from tests without touching Drizzle.
export type PreBriefInput = {
  userId: string;
  event: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date | null;
    location: string | null;
    description: string | null;
  };
  attendees: PreBriefAttendee[];
  // Optional class context — when the event maps to a known class via
  // attendee matching or title heuristic.
  classContext: {
    classId: string;
    name: string;
    code: string | null;
  } | null;
  // Recent emails with attendees over the last 60 days, capped to ~10.
  recentEmails: Array<{
    id: string;
    senderEmail: string;
    senderName: string | null;
    subject: string | null;
    snippet: string | null;
    receivedAt: Date;
  }>;
  // Upcoming deadlines for the matching class, next 7 days.
  upcomingDeadlines: Array<{
    title: string;
    due: Date;
  }>;
  // Recent mistake notes for the matching class, last 30 days.
  recentMistakes: Array<{
    title: string;
    unit: string | null;
    bodySnippet: string;
  }>;
};

export type PreBriefResult = {
  bullets: PreBriefBullet[];
  detailMarkdown: string;
  usageId: string | null;
};

export type { PreBriefBullet };
