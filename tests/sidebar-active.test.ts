import { describe, expect, it } from "vitest";
import { isActive } from "@/components/layout/sidebar-nav";

describe("Sidebar isActive", () => {
  it("marks an exact match as active", () => {
    expect(isActive("/app/chat", "/app/chat")).toBe(true);
    expect(isActive("/app/settings", "/app/settings")).toBe(true);
  });

  it("marks a nested route as active for its parent nav item", () => {
    expect(isActive("/app/chat/abc-123", "/app/chat")).toBe(true);
    expect(isActive("/app/settings/connections", "/app/settings")).toBe(true);
    expect(isActive("/app/syllabus/new", "/app/syllabus")).toBe(true);
  });

  it("does not match partial-prefix routes", () => {
    // /app/chatbot should not activate /app/chat
    expect(isActive("/app/chatbot", "/app/chat")).toBe(false);
    expect(isActive("/app/assignmentsx", "/app/assignments")).toBe(false);
  });

  it("returns false for mismatched branches", () => {
    expect(isActive("/app/chat", "/app/calendar")).toBe(false);
    expect(isActive("/app/settings", "/app/resources")).toBe(false);
  });

  it("returns false when pathname is null", () => {
    expect(isActive(null, "/app/chat")).toBe(false);
  });
});
