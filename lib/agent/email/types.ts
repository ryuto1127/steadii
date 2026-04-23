import type {
  InboxBucket,
  RuleProvenance,
  SenderRole,
} from "@/lib/db/schema";

// The minimum shape of a Gmail message that L1 classification needs. We
// keep this narrow so the rule engine is testable without depending on
// the full `gmail_v1.Schema$Message`.
export type ClassifyInput = {
  externalId: string;
  threadExternalId: string | null;
  fromEmail: string;
  fromName: string | null;
  fromDomain: string;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  snippet: string | null;
  bodySnippet: string | null;
  receivedAt: Date;
  gmailLabelIds: string[];
  listUnsubscribe: string | null;
  inReplyTo: string | null;
  headerFromRaw: string | null;
};

// What L1 knows about the user's prior triage state. The classifier is
// pure, so the caller assembles this from DB reads before invoking.
export type UserContext = {
  userId: string;
  userEmail: string;
  // Per-user learned rules resolved to a quick-lookup shape.
  learnedDomains: Map<
    string,
    { riskTier?: "low" | "medium" | "high" | null; senderRole?: SenderRole | null }
  >;
  learnedSenders: Map<
    string,
    { riskTier?: "low" | "medium" | "high" | null; senderRole?: SenderRole | null }
  >;
  // Whether we've ever triaged an email from this sender_domain before.
  // Set of already-known domains.
  seenDomains: Set<string>;
};

export type TriageResult = {
  bucket: InboxBucket;
  senderRole: SenderRole | null;
  ruleProvenance: RuleProvenance[];
  firstTimeSender: boolean;
};
