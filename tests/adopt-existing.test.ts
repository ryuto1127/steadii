import { describe, expect, it, vi } from "vitest";
import {
  runNotionSetup,
  NotionSetupMultipleCandidatesError,
} from "@/lib/integrations/notion/setup";

function fakeClient(opts: {
  existingSteadiiPages?: Array<{ id: string; title: string }>;
  childDatabases?: Array<{ id: string; title: string }>;
  workspaceRootAllowed?: boolean;
} = {}) {
  const created: Array<{ kind: "page" | "database"; args: Record<string, unknown> }> = [];
  let pageSeq = 0;
  let dbSeq = 0;
  const existing = opts.existingSteadiiPages ?? [];
  const children = opts.childDatabases ?? [];

  const client = {
    search: vi.fn(async () => ({
      results: existing.map((p) => ({
        id: p.id,
        object: "page" as const,
        url: `https://notion.so/${p.id}`,
        parent: { type: "workspace" },
        properties: {
          title: { title: [{ plain_text: p.title }] },
        },
      })),
    })),
    pages: {
      create: vi.fn(async (args: Record<string, unknown>) => {
        pageSeq += 1;
        created.push({ kind: "page", args });
        return { id: `page-${pageSeq}` };
      }),
    },
    databases: {
      create: vi.fn(async (args: Record<string, unknown>) => {
        dbSeq += 1;
        created.push({ kind: "database", args });
        return { id: `db-${dbSeq}` };
      }),
    },
    blocks: {
      children: {
        list: vi.fn(async () => ({
          results: children.map((c) => ({
            id: c.id,
            type: "child_database" as const,
            child_database: { title: c.title },
          })),
          next_cursor: null,
        })),
      },
    },
  };
  return { client, created };
}

describe("runNotionSetup — adopt-existing", () => {
  it("throws NotionSetupMultipleCandidatesError when two Steadii pages exist", async () => {
    const { client } = fakeClient({
      existingSteadiiPages: [
        { id: "p1", title: "Steadii" },
        { id: "p2", title: "Steadii" },
      ],
    });
    await expect(runNotionSetup(client as never)).rejects.toBeInstanceOf(
      NotionSetupMultipleCandidatesError
    );
  });

  it("adopts the single existing Steadii page + all four child DBs without creating new ones", async () => {
    const { client, created } = fakeClient({
      existingSteadiiPages: [{ id: "p-existing", title: "Steadii" }],
      childDatabases: [
        { id: "db-cl", title: "Classes" },
        { id: "db-mi", title: "Mistake Notes" },
        { id: "db-as", title: "Assignments" },
        { id: "db-sy", title: "Syllabi" },
      ],
    });
    const result = await runNotionSetup(client as never);
    expect(result.parentPageId).toBe("p-existing");
    expect(result.classesDbId).toBe("db-cl");
    expect(result.mistakesDbId).toBe("db-mi");
    expect(result.assignmentsDbId).toBe("db-as");
    expect(result.syllabiDbId).toBe("db-sy");
    // no DB creations should have happened
    expect(created.filter((c) => c.kind === "database")).toHaveLength(0);
    expect(created.filter((c) => c.kind === "page")).toHaveLength(0);
  });

  it("backfills missing child DBs when an existing Steadii page has only some", async () => {
    const { client, created } = fakeClient({
      existingSteadiiPages: [{ id: "p-existing", title: "Steadii" }],
      childDatabases: [
        { id: "db-cl", title: "Classes" },
        { id: "db-mi", title: "Mistake Notes" },
      ],
    });
    const result = await runNotionSetup(client as never);
    expect(result.parentPageId).toBe("p-existing");
    expect(result.classesDbId).toBe("db-cl");
    expect(result.mistakesDbId).toBe("db-mi");
    const dbCreates = created.filter((c) => c.kind === "database");
    expect(dbCreates).toHaveLength(2); // Assignments + Syllabi created
    const titles = dbCreates.map(
      (c) =>
        (c.args.title as Array<{ text: { content: string } }>)[0].text.content
    );
    expect(titles.sort()).toEqual(["Assignments", "Syllabi"]);
  });
});
