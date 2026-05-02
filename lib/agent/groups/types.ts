// Wave 3.2 — group project coordinator types.

export type GroupDetectionSignal =
  | { kind: "email_thread"; threadId: string; participants: string[]; messageCount: number; firstAt: Date; lastAt: Date }
  | { kind: "calendar_event"; eventId: string; attendeeEmails: string[]; title: string; startsAt: Date }
  | { kind: "syllabus_chunk"; syllabusId: string; classId: string | null; snippet: string };

export type GroupCandidate = {
  // The class the candidate maps to, if we could resolve one.
  classId: string | null;
  className: string | null;
  classCode: string | null;
  // Suggested project title (e.g. "PSY100 group project — chapter 4 case study").
  suggestedTitle: string;
  // Distinct member emails that triggered the detection.
  memberEmails: string[];
  // The signals that fired together for this candidate.
  signals: GroupDetectionSignal[];
  // Stable hash so the same candidate doesn't get suggested twice.
  detectionKey: string;
};

export type GroupSilenceCandidate = {
  groupProjectId: string;
  memberEmail: string;
  memberName: string | null;
  daysSilent: number;
};
