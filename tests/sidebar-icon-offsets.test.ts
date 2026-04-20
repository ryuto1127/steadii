import { describe, expect, it } from "vitest";
import { __testing } from "@/components/layout/sidebar";

describe("sidebar icon offsets", () => {
  const { ICON_OFFSET_PX } = __testing;

  it("nudges FolderOpen (Resources) right by 1px to compensate for its x=2 body", () => {
    expect(ICON_OFFSET_PX.resources).toBe(1);
  });

  it("nudges Settings right by 1px to compensate for its x=2 left spoke", () => {
    expect(ICON_OFFSET_PX.settings).toBe(1);
  });

  it("does not nudge icons whose body is at x=3 (Calendar, BookOpen, CheckSquare)", () => {
    expect(ICON_OFFSET_PX.calendar).toBeUndefined();
    expect(ICON_OFFSET_PX.mistakes).toBeUndefined();
    expect(ICON_OFFSET_PX.assignments).toBeUndefined();
  });
});
