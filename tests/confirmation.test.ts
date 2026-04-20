import { describe, expect, it } from "vitest";
import { requiresConfirmation } from "@/lib/agent/confirmation";

describe("requiresConfirmation matrix", () => {
  it("mode=none never asks", () => {
    expect(requiresConfirmation("none", "read")).toBe(false);
    expect(requiresConfirmation("none", "write")).toBe(false);
    expect(requiresConfirmation("none", "destructive")).toBe(false);
  });

  it("mode=all asks on anything that writes", () => {
    expect(requiresConfirmation("all", "read")).toBe(false);
    expect(requiresConfirmation("all", "write")).toBe(true);
    expect(requiresConfirmation("all", "destructive")).toBe(true);
  });

  it("mode=destructive_only is the default and only asks on destructive", () => {
    expect(requiresConfirmation("destructive_only", "read")).toBe(false);
    expect(requiresConfirmation("destructive_only", "write")).toBe(false);
    expect(requiresConfirmation("destructive_only", "destructive")).toBe(true);
  });
});
