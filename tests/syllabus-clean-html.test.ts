import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: () => ({ OPENAI_API_KEY: "x" }) }));
vi.mock("@/lib/integrations/openai/client", () => ({ openai: () => ({}) }));
vi.mock("@/lib/agent/usage", () => ({ recordUsage: async () => {} }));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import { cleanHtml } from "@/lib/syllabus/extract";

describe("cleanHtml", () => {
  it("strips script/style and collapses whitespace", () => {
    const html =
      "<html><head><style>x{}</style></head><body><script>evil()</script><p>Hello     world</p></body></html>";
    expect(cleanHtml(html)).toBe("Hello world");
  });

  it("returns body text from nested elements", () => {
    const html = "<html><body><div><p>Course</p><p>Info</p></div></body></html>";
    expect(cleanHtml(html)).toBe("CourseInfo");
  });
});
