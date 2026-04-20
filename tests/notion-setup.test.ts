import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runNotionSetup,
  NotionSetupNoAccessiblePageError,
} from "@/lib/integrations/notion/setup";
import { __resetDataSourceCacheForTests } from "@/lib/integrations/notion/data-source";

type CreatedCall = { kind: "page" | "database"; args: Record<string, unknown> };

function fakeClient(opts: {
  workspaceRootAllowed?: boolean;
  searchResults?: Array<{ id: string; object: "page" }>;
} = {}) {
  const { workspaceRootAllowed = true, searchResults } = opts;
  const created: CreatedCall[] = [];
  let pageSeq = 0;
  let dbSeq = 0;

  const client = {
    pages: {
      create: vi.fn(async (args: Record<string, unknown>) => {
        const parent = args.parent as { type: string } | undefined;
        if (parent?.type === "workspace" && !workspaceRootAllowed) {
          throw new Error("integration_capability workspace not granted");
        }
        pageSeq += 1;
        created.push({ kind: "page", args });
        return { id: `page-${pageSeq}` };
      }),
    },
    databases: {
      // v5 returns a container; the setup code uses `data_sources[0].id` to
      // prime the DS cache so later relation targets resolve without an
      // explicit retrieve.
      create: vi.fn(async (args: Record<string, unknown>) => {
        dbSeq += 1;
        created.push({ kind: "database", args });
        return {
          id: `db-${dbSeq}`,
          data_sources: [{ id: `ds-${dbSeq}` }],
        };
      }),
      retrieve: vi.fn(async (args: { database_id: string }) => ({
        id: args.database_id,
        data_sources: [{ id: `ds-for-${args.database_id}` }],
      })),
    },
    dataSources: {
      query: vi.fn(async () => ({ results: [], has_more: false })),
    },
    search: vi.fn(async () => ({
      results:
        searchResults ?? [{ id: "workspace-root-page", object: "page" as const }],
    })),
  };
  return { client, created };
}

beforeEach(() => {
  __resetDataSourceCacheForTests();
});

describe("runNotionSetup — 4-DB class-centric structure", () => {
  it("creates Classes first, then Mistake Notes, Assignments, Syllabi", async () => {
    const { client, created } = fakeClient();
    const result = await runNotionSetup(client as never);

    expect(result.parentPageId).toBeDefined();
    expect(result.classesDbId).toBeDefined();
    expect(result.mistakesDbId).toBeDefined();
    expect(result.assignmentsDbId).toBeDefined();
    expect(result.syllabiDbId).toBeDefined();

    const dbs = created.filter((c) => c.kind === "database");
    expect(dbs).toHaveLength(4);

    const titles = dbs.map(
      (d) =>
        ((d.args.title as Array<{ text: { content: string } }>)[0].text.content)
    );
    expect(titles).toEqual(["Classes", "Mistake Notes", "Assignments", "Syllabi"]);
  });

  it("Classes DB has Name, Code, Term, Professor, Color, Status with select options", async () => {
    const { client, created } = fakeClient();
    await runNotionSetup(client as never);
    const classes = created.find(
      (c) =>
        c.kind === "database" &&
        (c.args.title as Array<{ text: { content: string } }>)[0].text.content ===
          "Classes"
    )!;
    // v5 moved schema into initial_data_source.properties.
    const ids = classes.args.initial_data_source as {
      properties: Record<string, Record<string, unknown>>;
    };
    const props = ids.properties;
    expect(props.Name).toHaveProperty("title");
    expect(props.Code).toHaveProperty("rich_text");
    expect(props.Term).toHaveProperty("select");
    expect(props.Professor).toHaveProperty("rich_text");
    expect(props.Color).toHaveProperty("select");
    expect(props.Status).toHaveProperty("select");

    const statusOptions = (
      props.Status.select as { options: Array<{ name: string }> }
    ).options.map((o) => o.name);
    expect(statusOptions).toEqual(["active", "archived"]);

    const colorOptions = (
      props.Color.select as { options: Array<{ name: string }> }
    ).options.map((o) => o.name);
    expect(colorOptions.sort()).toEqual(
      ["blue", "brown", "gray", "green", "orange", "pink", "purple", "red"].sort()
    );
  });

  it("Mistake Notes / Assignments / Syllabi have Class relation → Classes with dual_property", async () => {
    const { client, created } = fakeClient();
    const result = await runNotionSetup(client as never);
    const expected = ["Mistake Notes", "Assignments", "Syllabi"] as const;

    for (const name of expected) {
      const db = created.find(
        (c) =>
          c.kind === "database" &&
          (c.args.title as Array<{ text: { content: string } }>)[0].text
            .content === name
      )!;
      const ids = db.args.initial_data_source as {
        properties: Record<string, Record<string, unknown>>;
      };
      const props = ids.properties;
      expect(props.Class).toBeDefined();
      // v5 relations target a data source, not a database.
      const relation = props.Class.relation as {
        data_source_id: string;
        type: string;
        dual_property: unknown;
      };
      // classesDbId is "db-1"; setup primes the cache with "ds-1".
      expect(relation.data_source_id).toBe("ds-1");
      expect(result.classesDbId).toBe("db-1");
      expect(relation.type).toBe("dual_property");
      expect(relation.dual_property).toBeDefined();
    }
  });

  it("tries workspace-root parent first and uses it when allowed", async () => {
    const { client, created } = fakeClient({ workspaceRootAllowed: true });
    await runNotionSetup(client as never);
    // search() is called once to check for an existing Steadii page (adopt-existing);
    // with no match, setup proceeds to create the workspace-root parent.
    const firstPage = created.find((c) => c.kind === "page")!;
    expect(
      (firstPage.args.parent as { type: string; workspace?: boolean }).type
    ).toBe("workspace");
  });

  it("falls back to first-accessible page when workspace-root is rejected", async () => {
    const { client, created } = fakeClient({ workspaceRootAllowed: false });
    await runNotionSetup(client as never);
    expect(client.search).toHaveBeenCalled();
    // two page creates: one failed workspace attempt (not recorded — thrown), one fallback
    const pageCreates = created.filter((c) => c.kind === "page");
    expect(pageCreates).toHaveLength(1);
    expect(
      (pageCreates[0].args.parent as { page_id: string }).page_id
    ).toBe("workspace-root-page");
  });

  it("throws NotionSetupNoAccessiblePageError when no fallback page exists", async () => {
    const { client } = fakeClient({
      workspaceRootAllowed: false,
      searchResults: [],
    });
    await expect(runNotionSetup(client as never)).rejects.toBeInstanceOf(
      NotionSetupNoAccessiblePageError
    );
  });
});
