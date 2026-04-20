import { describe, expect, it } from "vitest";
import { isActive } from "@/components/layout/sidebar-nav";

describe("Sidebar isActive", () => {
  it("marks an exact match as active", () => {
    expect(isActive("/app/chats", "/app/chats")).toBe(true);
    expect(isActive("/app/settings", "/app/settings")).toBe(true);
  });

  it("marks home only on exact /app", () => {
    expect(isActive("/app", "/app")).toBe(true);
    // /app is not a prefix match for sub-routes — otherwise every nested
    // route would also mark Home as active.
    expect(isActive("/app/chats", "/app")).toBe(false);
    expect(isActive("/app/classes", "/app")).toBe(false);
  });

  it("marks a nested route as active for its parent nav item", () => {
    expect(isActive("/app/chat/abc-123", "/app/chat")).toBe(true);
    expect(isActive("/app/settings/connections", "/app/settings")).toBe(true);
    expect(isActive("/app/classes/xyz", "/app/classes")).toBe(true);
  });

  it("does not match partial-prefix routes", () => {
    expect(isActive("/app/chatbot", "/app/chats")).toBe(false);
    expect(isActive("/app/classesx", "/app/classes")).toBe(false);
  });

  it("returns false for mismatched branches", () => {
    expect(isActive("/app/chats", "/app/calendar")).toBe(false);
    expect(isActive("/app/settings", "/app/classes")).toBe(false);
  });

  it("returns false when pathname is null", () => {
    expect(isActive(null, "/app/chats")).toBe(false);
  });
});
