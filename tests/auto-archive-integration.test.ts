import { beforeEach, describe, expect, it, vi } from "vitest";

// Wave 5 — auto-archive integration test. End-to-end at the
// applyTriageResult layer:
//   - email arrives → classifier labels auto_low + 0.96 confidence
//   - user has auto_archive_enabled=true and no learned opt-out
//   - applyTriageResult → maybeAutoArchive flips status='archived',
//     auto_archived=true, and writes an audit_log row

vi.mock("server-only", () => ({}));

// Track DB calls so we can assert on the auto-archive UPDATE + audit
// log INSERT without spinning up Postgres. The mock layer mimics
// Drizzle's chainable shape just enough for the helper.
type Op = { kind: string; payload: unknown };
const ops: Op[] = [];

const insertedRows: Array<Record<string, unknown>> = [];
const userPrefRow = { autoArchiveEnabled: true };
const learnedRulesByUser = new Map<string, Array<Record<string, unknown>>>();

const mockDb = {
  insert(table: { _name?: string }) {
    return {
      values(value: Record<string, unknown>) {
        ops.push({ kind: "insert", payload: { table, value } });
        insertedRows.push(value);
        return {
          onConflictDoNothing(_args: unknown) {
            void _args;
            return {
              returning: async () => [{ ...value, id: "inbox-w5-1" }],
            };
          },
          // Bare insert (audit_log)
          then: undefined as never,
        };
      },
    };
  },
  update(_table: unknown) {
    return {
      set(value: Record<string, unknown>) {
        ops.push({ kind: "update", payload: { value } });
        return {
          where: async () => undefined,
        };
      },
    };
  },
  select(shape?: Record<string, unknown>) {
    void shape;
    return {
      from(table: { _name?: string }) {
        return {
          where: () => ({
            limit: async () => {
              if ((table as { _name?: string })._name === "users") {
                return [userPrefRow];
              }
              return [];
            },
          }),
        };
      },
    };
  },
};

vi.mock("@/lib/db/client", () => ({ db: mockDb }));

// Tag schema tables with _name so the mock select knows which to
// satisfy. Drizzle gives table objects opaque internals, but the
// helper just compares references. We override here.
vi.mock("@/lib/db/schema", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const tag = (name: string, base: unknown) => {
    if (typeof base === "object" && base !== null) {
      return Object.assign(base, { _name: name });
    }
    return base;
  };
  return {
    ...actual,
    users: tag("users", actual.users),
    inboxItems: tag("inbox_items", actual.inboxItems),
    auditLog: tag("audit_log", actual.auditLog),
    agentRules: tag("agent_rules", actual.agentRules),
    emailEmbeddings: tag("email_embeddings", actual.emailEmbeddings),
  };
});

vi.mock("@/lib/agent/email/embeddings", () => ({
  embedAndStoreInboxItem: async () => undefined,
}));

vi.mock("@/lib/agent/email/class-binding", () => ({
  bindEmailToClass: async () => ({
    classId: null,
    method: "none",
    confidence: 0,
    alternates: [],
  }),
  persistBinding: async () => undefined,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: () => {},
}));

beforeEach(() => {
  ops.length = 0;
  insertedRows.length = 0;
  learnedRulesByUser.clear();
});

describe("applyTriageResult → maybeAutoArchive", () => {
  it("auto-archives auto_low items above the confidence threshold", async () => {
    const { applyTriageResult } = await import(
      "@/lib/agent/email/triage"
    );
    const input = {
      externalId: "m-w5-int",
      threadExternalId: null,
      fromEmail: "newsletter@example.com",
      fromName: "Newsletter",
      fromDomain: "example.com",
      toEmails: ["student@example.com"],
      ccEmails: [],
      subject: "Weekly digest",
      snippet: "Today's roundup",
      bodySnippet: "Today's roundup",
      receivedAt: new Date("2026-05-02T10:00:00Z"),
      gmailLabelIds: ["INBOX"],
      listUnsubscribe: null,
      inReplyTo: null,
      headerFromRaw: null,
    };
    const result = {
      bucket: "auto_low" as const,
      senderRole: null,
      ruleProvenance: [],
      firstTimeSender: false,
      confidence: 0.96,
      learnedOptOut: false,
      urgencyExpiresAt: null,
    };
    await applyTriageResult("user-w5-int", "google-acct", input, result);

    // The inbox row insert went in with triage_confidence populated.
    expect(insertedRows[0]?.triageConfidence).toBe(0.96);

    // We expect at least one update with status='archived' and
    // autoArchived=true (the auto-archive helper flip). Audit logs
    // also fire as separate INSERTs.
    const updates = ops.filter((o) => o.kind === "update");
    const archiveUpdate = updates.find((u) => {
      const v = (u.payload as { value: Record<string, unknown> }).value;
      return v.status === "archived" && v.autoArchived === true;
    });
    expect(archiveUpdate).toBeTruthy();
  });

  it("leaves the row visible when toggle is off", async () => {
    userPrefRow.autoArchiveEnabled = false;
    const { applyTriageResult } = await import(
      "@/lib/agent/email/triage"
    );
    const input = {
      externalId: "m-w5-int-off",
      threadExternalId: null,
      fromEmail: "newsletter@example.com",
      fromName: "Newsletter",
      fromDomain: "example.com",
      toEmails: ["student@example.com"],
      ccEmails: [],
      subject: "Weekly digest",
      snippet: "Today's roundup",
      bodySnippet: "Today's roundup",
      receivedAt: new Date("2026-05-02T10:00:00Z"),
      gmailLabelIds: ["INBOX"],
      listUnsubscribe: null,
      inReplyTo: null,
      headerFromRaw: null,
    };
    const result = {
      bucket: "auto_low" as const,
      senderRole: null,
      ruleProvenance: [],
      firstTimeSender: false,
      confidence: 0.96,
      learnedOptOut: false,
      urgencyExpiresAt: null,
    };
    await applyTriageResult("user-w5-toggle-off", "google-acct", input, result);

    const updates = ops.filter((o) => o.kind === "update");
    const archiveUpdate = updates.find((u) => {
      const v = (u.payload as { value: Record<string, unknown> }).value;
      return v.status === "archived";
    });
    expect(archiveUpdate).toBeFalsy();

    // Reset for next test.
    userPrefRow.autoArchiveEnabled = true;
  });

  it("leaves the row visible when learnedOptOut is set", async () => {
    const { applyTriageResult } = await import(
      "@/lib/agent/email/triage"
    );
    const input = {
      externalId: "m-w5-int-optout",
      threadExternalId: null,
      fromEmail: "school@known.edu",
      fromName: "School",
      fromDomain: "known.edu",
      toEmails: ["student@example.com"],
      ccEmails: [],
      subject: "Confirmed",
      snippet: "ok thanks",
      bodySnippet: "ok thanks",
      receivedAt: new Date("2026-05-02T10:00:00Z"),
      gmailLabelIds: ["INBOX"],
      listUnsubscribe: null,
      inReplyTo: null,
      headerFromRaw: null,
    };
    const result = {
      bucket: "auto_low" as const,
      senderRole: null,
      ruleProvenance: [],
      firstTimeSender: false,
      confidence: 0.96,
      learnedOptOut: true,
      urgencyExpiresAt: null,
    };
    await applyTriageResult("user-w5-optout", "google-acct", input, result);

    const updates = ops.filter((o) => o.kind === "update");
    const archiveUpdate = updates.find((u) => {
      const v = (u.payload as { value: Record<string, unknown> }).value;
      return v.status === "archived";
    });
    expect(archiveUpdate).toBeFalsy();
  });
});
