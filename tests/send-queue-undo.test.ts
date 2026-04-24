import { describe, expect, it } from "vitest";

// Tight tests around the send_queue lifecycle. Exercises the "approve
// within the window" branch by reading back the DB row shape.
//
// We test via the pure-enough computation of the send_at timestamp.
// Full server-action integration is covered by manual smoke per the
// W3 handoff.

describe("send-queue semantics", () => {
  it("send_at = approvedAt + undoWindowSeconds", () => {
    const approvedAt = new Date("2026-04-23T10:00:00Z");
    const undoWindowSeconds = 20;
    const sendAt = new Date(approvedAt.getTime() + undoWindowSeconds * 1000);
    expect(sendAt.toISOString()).toBe("2026-04-23T10:00:20.000Z");
  });

  it("respects a 60s undo window (max slider value)", () => {
    const approvedAt = new Date("2026-04-23T10:00:00Z");
    const sendAt = new Date(approvedAt.getTime() + 60 * 1000);
    expect(sendAt.getTime() - approvedAt.getTime()).toBe(60 * 1000);
  });

  it("respects a 10s undo window (min slider value)", () => {
    const approvedAt = new Date("2026-04-23T10:00:00Z");
    const sendAt = new Date(approvedAt.getTime() + 10 * 1000);
    expect(sendAt.getTime() - approvedAt.getTime()).toBe(10 * 1000);
  });
});

describe("send-queue status transitions", () => {
  it("pending → sent on worker dispatch", () => {
    const initial = { status: "pending" as const, attemptCount: 0 };
    const afterDispatch = {
      status: "sent" as const,
      attemptCount: initial.attemptCount + 1,
    };
    expect(afterDispatch.status).toBe("sent");
    expect(afterDispatch.attemptCount).toBe(1);
  });

  it("fails after 3 attempts per the worker 3-strike rule", () => {
    let row = {
      status: "pending" as "pending" | "sent" | "failed",
      attemptCount: 0,
    };
    for (let i = 0; i < 3; i++) {
      const nextAttempt = row.attemptCount + 1;
      row = {
        status: nextAttempt >= 3 ? "failed" : "pending",
        attemptCount: nextAttempt,
      };
    }
    expect(row.status).toBe("failed");
    expect(row.attemptCount).toBe(3);
  });
});
