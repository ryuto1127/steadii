import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-06-09 — fetchFullBodyForInbox is the shared full-body fetch that
// backs BOTH the L2 pipeline and the pre-send fact-checker, so the
// checker grounds against the same body slice the draft was generated
// from (not the ~120-char snippet). These tests cover the branches the
// pre-send-check + auto-send grounding depend on:
//   - gmail source + non-empty body → returns the extracted body (capped)
//   - body longer than FULL_BODY_CHAR_CAP → truncated to the cap
//   - non-gmail source → null (caller falls back to snippet)
//   - empty extracted body → null (caller falls back to snippet)
//   - fetch throws → null, logged (caller falls back to snippet)

vi.mock("server-only", () => ({}));

const getMessageFullMock = vi.fn();
vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  getMessageFull: (userId: string, messageId: string) =>
    getMessageFullMock(userId, messageId),
}));

const extractEmailBodyMock = vi.fn();
vi.mock("@/lib/agent/email/body-extract", () => ({
  extractEmailBody: (message: unknown) => extractEmailBodyMock(message),
}));

const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import {
  fetchFullBodyForInbox,
  FULL_BODY_CHAR_CAP,
} from "@/lib/agent/email/full-body";

const baseItem = {
  userId: "u1",
  inboxItemId: "ibx-1",
  sourceType: "gmail",
  externalId: "gmail-msg-1",
};

beforeEach(() => {
  getMessageFullMock.mockReset();
  extractEmailBodyMock.mockReset();
  captureExceptionMock.mockReset();
});

describe("fetchFullBodyForInbox", () => {
  it("returns the extracted full body for a gmail item", async () => {
    getMessageFullMock.mockResolvedValue({ id: "gmail-msg-1" });
    extractEmailBodyMock.mockReturnValue({
      text: "Full body with the scheduling details past the snippet.",
      format: "text/plain",
    });

    const result = await fetchFullBodyForInbox(baseItem);
    expect(result).toBe(
      "Full body with the scheduling details past the snippet."
    );
    expect(getMessageFullMock).toHaveBeenCalledWith("u1", "gmail-msg-1");
  });

  it("caps the body at FULL_BODY_CHAR_CAP", async () => {
    const long = "x".repeat(FULL_BODY_CHAR_CAP + 500);
    getMessageFullMock.mockResolvedValue({ id: "gmail-msg-1" });
    extractEmailBodyMock.mockReturnValue({ text: long, format: "text/plain" });

    const result = await fetchFullBodyForInbox(baseItem);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(FULL_BODY_CHAR_CAP);
  });

  it("returns null for a non-gmail source (caller falls back to snippet)", async () => {
    const result = await fetchFullBodyForInbox({
      ...baseItem,
      sourceType: "manual",
    });
    expect(result).toBeNull();
    expect(getMessageFullMock).not.toHaveBeenCalled();
  });

  it("returns null when the extracted body is empty", async () => {
    getMessageFullMock.mockResolvedValue({ id: "gmail-msg-1" });
    extractEmailBodyMock.mockReturnValue({ text: "   ", format: "empty" });

    const result = await fetchFullBodyForInbox(baseItem);
    expect(result).toBeNull();
  });

  it("returns null and logs when the fetch throws (graceful snippet fallback)", async () => {
    getMessageFullMock.mockRejectedValue(new Error("gmail 500"));

    const result = await fetchFullBodyForInbox(baseItem);
    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
