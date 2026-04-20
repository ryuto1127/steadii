import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runNotionSetup,
  NotionSetupMultipleCandidatesError,
} from "@/lib/integrations/notion/setup";
import { __resetDataSourceCacheForTests } from "@/lib/integrations/notion/data-source";

beforeEach(() => {
  __resetDataSourceCacheForTests();
});

function fakeClient(candidates: Array<{ id: string; title: string }>) {
  const archived: string[] = [];
  let pageSeq = 0;
  let dbSeq = 0;

  const client = {
    search: vi.fn(async () => ({
      results: candidates.map((c) => ({
        id: c.id,
        object: "page" as const,
        url: `https://notion.so/${c.id}`,
        parent: { type: "workspace" },
        properties: {
          title: { title: [{ plain_text: c.title }] },
        },
      })),
    })),
    pages: {
      create: vi.fn(async () => {
        pageSeq += 1;
        return { id: `new-page-${pageSeq}` };
      }),
      update: vi.fn(
        async ({ page_id, archived: arc }: { page_id: string; archived?: boolean }) => {
          if (arc) archived.push(page_id);
          return { id: page_id };
        }
      ),
    },
    databases: {
      create: vi.fn(async () => {
        dbSeq += 1;
        return {
          id: `db-${dbSeq}`,
          data_sources: [{ id: `ds-${dbSeq}` }],
        };
      }),
      retrieve: vi.fn(async ({ database_id }: { database_id: string }) => ({
        id: database_id,
        data_sources: [{ id: `ds-for-${database_id}` }],
      })),
    },
    dataSources: {
      query: vi.fn(async () => ({ results: [], has_more: false })),
    },
    blocks: {
      children: {
        list: vi.fn(async () => ({ results: [], next_cursor: null })),
      },
    },
  };

  return { client, archived };
}

describe("runNotionSetup + resolveDuplicates", () => {
  it("uses the winner returned by the resolver (tests pipeline, not scoring logic)", async () => {
    const { client } = fakeClient([
      { id: "p-winner", title: "Steadii" },
      { id: "p-loser", title: "Steadii" },
    ]);
    const result = await runNotionSetup(client as never, {
      resolveDuplicates: async () => ({ winnerId: "p-winner" }),
    });
    expect(result.parentPageId).toBe("p-winner");
    // four child DBs created because existing children are empty
    expect(client.databases.create).toHaveBeenCalledTimes(4);
  });

  it("throws NotionSetupMultipleCandidatesError when resolver returns null", async () => {
    const { client } = fakeClient([
      { id: "a", title: "Steadii" },
      { id: "b", title: "Steadii" },
    ]);
    await expect(
      runNotionSetup(client as never, {
        resolveDuplicates: async () => ({ winnerId: null }),
      })
    ).rejects.toBeInstanceOf(NotionSetupMultipleCandidatesError);
  });

  it("throws NotionSetupMultipleCandidatesError when no resolver is provided", async () => {
    const { client } = fakeClient([
      { id: "a", title: "Steadii" },
      { id: "b", title: "Steadii" },
    ]);
    await expect(runNotionSetup(client as never)).rejects.toBeInstanceOf(
      NotionSetupMultipleCandidatesError
    );
  });
});
