import { describe, expect, it } from "vitest";

import { buildSeededMessage } from "@/lib/agent/from-task-seed";

// 2026-05-19 — post-#292 dogfood: the agent received only the task
// title as the seeded message and re-did discovery via lookup_entity,
// which returned an ambiguous link (GitHub/Vercel notification email
// instead of the recruiter). The fix appends a Steadii-hint block
// when intent === DRAFT_EMAIL_REPLY and a preview exists, pinning
// inbox_item.id + subject so the agent skips discovery and calls
// email_get_body directly.

describe("buildSeededMessage", () => {
  it("returns the title alone when no preview is provided", () => {
    const r = buildSeededMessage({
      intent: "DRAFT_EMAIL_REPLY",
      title: "Reply to Sample Corp",
      preview: null,
    });
    expect(r).toBe("Reply to Sample Corp");
  });

  it("returns the title alone for OTHER intent (no preview hint shape defined)", () => {
    const r = buildSeededMessage({
      intent: "OTHER",
      title: "Buy groceries",
      preview: null,
    });
    expect(r).toBe("Buy groceries");
  });

  it("appends a preview hint when intent === DRAFT_EMAIL_REPLY and preview matches", () => {
    const r = buildSeededMessage({
      intent: "DRAFT_EMAIL_REPLY",
      title: "アクメトラベルへの返信",
      preview: {
        kind: "draft_email_reply",
        inboxItemId: "b1d633b2-ef2d-4c2d-8fe8-4b62e0d2bf37",
        subject: "次回面接のご連絡",
        snippet: "下記の候補からお選びください",
        receivedAt: "2026-05-19T01:30:00Z",
      },
    });
    expect(r).toContain("アクメトラベルへの返信");
    expect(r).toContain("Steadii からのヒント");
    expect(r).toContain("b1d633b2-ef2d-4c2d-8fe8-4b62e0d2bf37");
    expect(r).toContain("次回面接のご連絡");
    expect(r).toContain("email_get_body");
  });

  it("includes receivedAt timestamp when provided", () => {
    const r = buildSeededMessage({
      intent: "DRAFT_EMAIL_REPLY",
      title: "Reply",
      preview: {
        kind: "draft_email_reply",
        inboxItemId: "id-x",
        subject: "Subject A",
        snippet: "snippet",
        receivedAt: "2026-05-19T10:00:00Z",
      },
    });
    expect(r).toContain("2026-05-19T10:00:00Z");
  });

  it("skips the hint when preview.kind doesn't match the intent", () => {
    const r = buildSeededMessage({
      intent: "DRAFT_EMAIL_REPLY",
      title: "Reply",
      // Wrong kind tag — defensive check.
      preview: {
        kind: "calendar_event",
        suggestedStart: null,
        suggestedEnd: null,
        conflicts: [],
      } as unknown,
    });
    expect(r).toBe("Reply");
  });

  it("skips the hint when preview.inboxItemId is missing", () => {
    const r = buildSeededMessage({
      intent: "DRAFT_EMAIL_REPLY",
      title: "Reply",
      preview: {
        kind: "draft_email_reply",
        // inboxItemId missing
        subject: "Subject",
        snippet: "snippet",
        receivedAt: "2026-05-19T10:00:00Z",
      } as unknown,
    });
    expect(r).toBe("Reply");
  });

  it("handles empty subject defensively (renders placeholder)", () => {
    const r = buildSeededMessage({
      intent: "DRAFT_EMAIL_REPLY",
      title: "Reply",
      preview: {
        kind: "draft_email_reply",
        inboxItemId: "id-y",
        subject: "",
        snippet: "snippet",
        receivedAt: "2026-05-19T10:00:00Z",
      },
    });
    expect(r).toContain("id-y");
    // Should not contain literal `「」` empty quotes — fallback rendering.
    expect(r).toContain("(no subject)");
  });
});
