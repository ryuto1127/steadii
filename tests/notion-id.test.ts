import { describe, expect, it } from "vitest";
import { parseNotionId } from "@/lib/integrations/notion/id";

describe("parseNotionId", () => {
  it("extracts unhyphenated id from URL", () => {
    const url = "https://www.notion.so/MyPage-1234567890abcdef1234567890abcdef";
    expect(parseNotionId(url)).toBe("12345678-90ab-cdef-1234-567890abcdef");
  });

  it("extracts hyphenated id as-is", () => {
    const url =
      "https://www.notion.so/workspace/Page-12345678-90ab-cdef-1234-567890abcdef";
    expect(parseNotionId(url)).toBe("12345678-90ab-cdef-1234-567890abcdef");
  });

  it("returns null for a url with no id", () => {
    expect(parseNotionId("https://example.com/page")).toBeNull();
  });
});
