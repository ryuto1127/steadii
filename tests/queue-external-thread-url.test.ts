import { describe, expect, it } from "vitest";

import { buildExternalThreadUrl } from "@/lib/agent/queue/external-url";

// Unit coverage for the helper that turns (sourceType, threadExternalId)
// into the deep-link URL surfaced as the queue card's "Open thread"
// footer button.

describe("buildExternalThreadUrl — gmail", () => {
  it("returns the Gmail web URL when sourceType=gmail and a threadExternalId is present", () => {
    expect(buildExternalThreadUrl("gmail", "thread_abc123")).toBe(
      "https://mail.google.com/mail/u/0/#inbox/thread_abc123"
    );
  });

  it("preserves an arbitrary opaque thread id (no encoding mangling)", () => {
    expect(buildExternalThreadUrl("gmail", "abcdef_0123456789")).toBe(
      "https://mail.google.com/mail/u/0/#inbox/abcdef_0123456789"
    );
  });
});

describe("buildExternalThreadUrl — outlook", () => {
  it("returns null for outlook (Mail.Read scope deferred at α)", () => {
    expect(buildExternalThreadUrl("outlook", "thread_xyz")).toBeNull();
  });
});

describe("buildExternalThreadUrl — null / empty / unknown", () => {
  it("returns null when sourceType is null or undefined", () => {
    expect(buildExternalThreadUrl(null, "thread_abc")).toBeNull();
    expect(buildExternalThreadUrl(undefined, "thread_abc")).toBeNull();
  });

  it("returns null when threadExternalId is null or undefined", () => {
    expect(buildExternalThreadUrl("gmail", null)).toBeNull();
    expect(buildExternalThreadUrl("gmail", undefined)).toBeNull();
  });

  it("returns null when sourceType is empty string", () => {
    expect(buildExternalThreadUrl("", "thread_abc")).toBeNull();
  });

  it("returns null when threadExternalId is empty string", () => {
    expect(buildExternalThreadUrl("gmail", "")).toBeNull();
  });

  it("returns null for unknown sourceType (e.g. future provider)", () => {
    expect(buildExternalThreadUrl("slack", "thread_abc")).toBeNull();
    expect(buildExternalThreadUrl("ical_subscription", "thread_abc")).toBeNull();
  });
});
