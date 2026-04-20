import { describe, expect, it, vi } from "vitest";
import {
  decideSteadiiWinner,
  scoreSteadiiCandidates,
  type DuplicateScore,
} from "@/lib/integrations/notion/setup";

describe("decideSteadiiWinner", () => {
  const mk = (
    id: string,
    childCount: number,
    rowTotal: number
  ): DuplicateScore => ({ id, url: null, childCount, rowTotal });

  it("prefers the stored parent_page_id when it's in the candidate set", () => {
    const d = decideSteadiiWinner([mk("a", 4, 10), mk("b", 4, 20)], "a");
    expect(d.kind).toBe("adopt");
    if (d.kind === "adopt") {
      expect(d.winnerId).toBe("a");
      expect(d.loserIds).toEqual(["b"]);
      expect(d.reason).toBe("matches_stored_parent_page_id");
    }
  });

  it("picks the candidate with the most child DBs when stored hint doesn't help", () => {
    const d = decideSteadiiWinner([mk("a", 2, 50), mk("b", 4, 0)], null);
    expect(d.kind).toBe("adopt");
    if (d.kind === "adopt") {
      expect(d.winnerId).toBe("b");
      expect(d.reason).toBe("most_child_databases");
    }
  });

  it("tiebreaks by row count when child-DB counts are tied", () => {
    const d = decideSteadiiWinner([mk("a", 4, 3), mk("b", 4, 20)], null);
    expect(d.kind).toBe("adopt");
    if (d.kind === "adopt") {
      expect(d.winnerId).toBe("b");
      expect(d.reason).toBe("most_rows_in_children");
    }
  });

  it("adopts the first candidate when all ties have zero rows", () => {
    const d = decideSteadiiWinner([mk("a", 4, 0), mk("b", 4, 0)], null);
    expect(d.kind).toBe("adopt");
    if (d.kind === "adopt") {
      expect(d.winnerId).toBe("a");
      expect(d.reason).toBe("empty_tie_picked_first");
    }
  });

  it("refuses to auto-dedup when multiple candidates have live data", () => {
    const d = decideSteadiiWinner([mk("a", 4, 5), mk("b", 4, 5)], null);
    expect(d.kind).toBe("ambiguous");
    if (d.kind === "ambiguous") {
      expect(d.reason).toBe("multiple_candidates_with_live_data");
    }
  });

  it("ignores a stored hint that isn't in the candidate set", () => {
    const d = decideSteadiiWinner([mk("a", 2, 10), mk("b", 4, 0)], "zzz");
    expect(d.kind).toBe("adopt");
    if (d.kind === "adopt") expect(d.winnerId).toBe("b");
  });
});

describe("scoreSteadiiCandidates", () => {
  function fakeClient(state: {
    children: Record<string, Array<{ title: string; id: string }>>;
    rows: Record<string, number>; // dbId -> row count
  }) {
    return {
      blocks: {
        children: {
          list: vi.fn(async ({ block_id }: { block_id: string }) => ({
            results: (state.children[block_id] ?? []).map((c) => ({
              id: c.id,
              type: "child_database" as const,
              child_database: { title: c.title },
            })),
            next_cursor: null,
          })),
        },
      },
      databases: {
        query: vi.fn(async ({ database_id }: { database_id: string }) => {
          const n = state.rows[database_id] ?? 0;
          return {
            results: n > 0 ? [{ id: "row" }] : [],
            has_more: n > 1,
          };
        }),
      },
    };
  }

  it("counts the four known child DBs and rows per candidate", async () => {
    const client = fakeClient({
      children: {
        "p1": [
          { title: "Classes", id: "p1-cl" },
          { title: "Mistake Notes", id: "p1-mi" },
          { title: "Assignments", id: "p1-as" },
          { title: "Syllabi", id: "p1-sy" },
          { title: "Random extra", id: "p1-extra" },
        ],
        "p2": [{ title: "Classes", id: "p2-cl" }],
      },
      rows: { "p1-cl": 10, "p1-sy": 1, "p2-cl": 0 },
    });
    const scores = await scoreSteadiiCandidates(client as never, [
      { id: "p1", url: null },
      { id: "p2", url: null },
    ]);
    const byId = Object.fromEntries(scores.map((s) => [s.id, s]));
    expect(byId["p1"].childCount).toBe(4);
    expect(byId["p2"].childCount).toBe(1);
    // p1: p1-cl has >1 rows → results.length(1) + has_more(1) = 2; p1-sy = 1
    // p1-mi / p1-as have 0 → 0
    expect(byId["p1"].rowTotal).toBe(3);
    expect(byId["p2"].rowTotal).toBe(0);
  });
});
