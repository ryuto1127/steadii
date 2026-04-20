import { describe, expect, it, vi } from "vitest";
import { runNotionSetup } from "@/lib/integrations/notion/setup";

function fakeClient() {
  const created: Array<{ kind: string; args: unknown }> = [];
  const client = {
    pages: {
      create: vi.fn(async (args: unknown) => {
        created.push({ kind: "page", args });
        return { id: "page-" + created.length };
      }),
    },
    databases: {
      create: vi.fn(async (args: unknown) => {
        created.push({ kind: "database", args });
        return { id: "db-" + created.length };
      }),
    },
    search: vi.fn(async () => ({
      results: [{ id: "workspace-root-page", object: "page" }],
    })),
  };
  return { client, created };
}

describe("runNotionSetup", () => {
  it("creates a parent page and three databases with PRD-specified properties", async () => {
    const { client, created } = fakeClient();
    const result = await runNotionSetup(client as never);

    expect(result.parentPageId).toBeDefined();
    expect(result.mistakesDbId).toBeDefined();
    expect(result.assignmentsDbId).toBeDefined();
    expect(result.syllabiDbId).toBeDefined();

    expect(created.filter((c) => c.kind === "page")).toHaveLength(1);
    expect(created.filter((c) => c.kind === "database")).toHaveLength(3);

    const dbs = created.filter((c) => c.kind === "database").map((c) => c.args as {
      title: Array<{ text: { content: string } }>;
      properties: Record<string, unknown>;
    });
    const titles = dbs.map((d) => d.title[0].text.content);
    expect(titles).toEqual(["Mistake Notes", "Assignments", "Syllabi"]);

    const mistakes = dbs.find((d) => d.title[0].text.content === "Mistake Notes")!;
    expect(mistakes.properties).toHaveProperty("Title");
    expect(mistakes.properties).toHaveProperty("Subject");
    expect(mistakes.properties).toHaveProperty("Difficulty");
    expect(mistakes.properties).toHaveProperty("Tags");
    expect(mistakes.properties).toHaveProperty("Date");
    expect(mistakes.properties).toHaveProperty("Image");

    const assignments = dbs.find((d) => d.title[0].text.content === "Assignments")!;
    expect(assignments.properties).toHaveProperty("Title");
    expect(assignments.properties).toHaveProperty("Due");
    expect(assignments.properties).toHaveProperty("Status");
    expect(assignments.properties).toHaveProperty("Priority");

    const syllabi = dbs.find((d) => d.title[0].text.content === "Syllabi")!;
    expect(syllabi.properties).toHaveProperty("Course");
    expect(syllabi.properties).toHaveProperty("Instructor");
    expect(syllabi.properties).toHaveProperty("Grading");
    expect(syllabi.properties).toHaveProperty("Attendance");
  });

  it("uses an accessible root page when no explicit rootPageId provided", async () => {
    const { client } = fakeClient();
    await runNotionSetup(client as never);
    expect(client.search).toHaveBeenCalled();
    const pageArgs = client.pages.create.mock.calls[0][0] as {
      parent: { page_id: string };
    };
    expect(pageArgs.parent.page_id).toBe("workspace-root-page");
  });

  it("throws when the integration has no accessible page", async () => {
    const { client } = fakeClient();
    client.search = vi.fn(async () => ({ results: [] }));
    await expect(runNotionSetup(client as never)).rejects.toThrow(/no accessible page/);
  });
});
