import "server-only";
import type { Client } from "@notionhq/client";
import { primeDataSourceCache, resolveDataSourceId } from "./data-source";

export type NotionSetupResult = {
  parentPageId: string;
  classesDbId: string;
  mistakesDbId: string;
  assignmentsDbId: string;
  syllabiDbId: string;
};

export class NotionSetupNoAccessiblePageError extends Error {
  constructor() {
    super(
      "Couldn't create the Steadii page in your Notion workspace. Reconnect Notion at Settings → Connections and grant access to your workspace or a page."
    );
    this.name = "NotionSetupNoAccessiblePageError";
  }
}

export class NotionSetupMultipleCandidatesError extends Error {
  candidates: Array<{ id: string; url: string | null }>;
  constructor(candidates: Array<{ id: string; url: string | null }>) {
    super(
      `Found multiple "Steadii" pages in your Notion workspace. Delete all but one and try again. Candidates: ${candidates
        .map((c) => c.url ?? c.id)
        .join(", ")}`
    );
    this.name = "NotionSetupMultipleCandidatesError";
    this.candidates = candidates;
  }
}

// Notion SDK v5 moved the schema into `initial_data_source.properties` for
// database creation, and into `properties` for subsequent data-source
// updates. We pull the property-map type off the data source since the
// shape is identical.
type DbPropertyMap = NonNullable<
  Parameters<Client["dataSources"]["create"]>[0]["properties"]
>;

const CLASSES_PROPS: DbPropertyMap = {
  Name: { title: {} },
  Code: { rich_text: {} },
  Term: {
    select: {
      options: [
        { name: "Fall 2026", color: "orange" },
        { name: "Winter 2027", color: "blue" },
      ],
    },
  },
  Professor: { rich_text: {} },
  Color: {
    select: {
      options: [
        { name: "blue", color: "blue" },
        { name: "green", color: "green" },
        { name: "orange", color: "orange" },
        { name: "purple", color: "purple" },
        { name: "red", color: "red" },
        { name: "gray", color: "gray" },
        { name: "brown", color: "brown" },
        { name: "pink", color: "pink" },
      ],
    },
  },
  Status: {
    select: {
      options: [
        { name: "active", color: "green" },
        { name: "archived", color: "gray" },
      ],
    },
  },
};

// Relations in SDK v5 target a *data source*, not a database. We accept a
// database ID at the call site (that's what the caller has during setup
// right after creating Classes) and resolve it lazily to the data source.
async function classRelation(
  client: Client,
  classesDbId: string
): Promise<DbPropertyMap[string]> {
  const dsId = await resolveDataSourceId(client, classesDbId);
  return {
    relation: {
      data_source_id: dsId,
      type: "dual_property",
      dual_property: {},
    },
  };
}

async function mistakesProps(
  client: Client,
  classesDbId: string
): Promise<DbPropertyMap> {
  return {
    Title: { title: {} },
    Class: await classRelation(client, classesDbId),
    Unit: { rich_text: {} },
    Difficulty: {
      select: {
        options: [
          { name: "easy", color: "green" },
          { name: "medium", color: "yellow" },
          { name: "hard", color: "red" },
        ],
      },
    },
    Tags: { multi_select: { options: [] } },
    Date: { date: {} },
    Image: { files: {} },
  };
}

async function assignmentsProps(
  client: Client,
  classesDbId: string
): Promise<DbPropertyMap> {
  return {
    Title: { title: {} },
    Class: await classRelation(client, classesDbId),
    Due: { date: {} },
    Status: {
      select: {
        options: [
          { name: "Not started", color: "gray" },
          { name: "In progress", color: "yellow" },
          { name: "Done", color: "green" },
        ],
      },
    },
    Priority: {
      select: {
        options: [
          { name: "Low", color: "gray" },
          { name: "Medium", color: "yellow" },
          { name: "High", color: "red" },
        ],
      },
    },
    Notes: { rich_text: {} },
  };
}

async function syllabiProps(
  client: Client,
  classesDbId: string
): Promise<DbPropertyMap> {
  return {
    Title: { title: {} },
    Class: await classRelation(client, classesDbId),
    Term: { rich_text: {} },
    Grading: { rich_text: {} },
    Attendance: { rich_text: {} },
    Textbooks: { rich_text: {} },
    OfficeHours: { rich_text: {} },
    SourceURL: { url: {} },
  };
}

export type DuplicateCandidate = { id: string; url: string | null };

export type DuplicateResolver = (
  candidates: DuplicateCandidate[]
) => Promise<{ winnerId: string | null }>;

export async function runNotionSetup(
  client: Client,
  opts: {
    title?: string;
    resolveDuplicates?: DuplicateResolver;
  } = {}
): Promise<NotionSetupResult> {
  const title = opts.title ?? "Steadii";

  // Try to adopt an existing Steadii page before creating a duplicate.
  const existing = await findExistingSteadiiPages(client, title);
  if (existing.length > 1) {
    if (opts.resolveDuplicates) {
      const { winnerId } = await opts.resolveDuplicates(existing);
      if (!winnerId) {
        throw new NotionSetupMultipleCandidatesError(existing);
      }
      const winner = existing.find((e) => e.id === winnerId);
      if (!winner) {
        throw new NotionSetupMultipleCandidatesError(existing);
      }
      const parentPageId = winner.id;
      const existingChildren = await findSteadiiChildDatabases(client, parentPageId);
      return await finishSetupWithChildren(
        client,
        parentPageId,
        existingChildren
      );
    }
    throw new NotionSetupMultipleCandidatesError(existing);
  }

  let parentPageId: string;
  let existingChildren: ExistingChildren | null = null;
  if (existing.length === 1) {
    parentPageId = existing[0].id;
    existingChildren = await findSteadiiChildDatabases(client, parentPageId);
  } else {
    const parent = await createSteadiiParent(client, title);
    parentPageId = parent.id;
  }

  return await finishSetupWithChildren(client, parentPageId, existingChildren);
}

async function finishSetupWithChildren(
  client: Client,
  parentPageId: string,
  existingChildren: ExistingChildren | null
): Promise<NotionSetupResult> {
  const classesDbId =
    existingChildren?.classes ??
    (await createDb(client, parentPageId, "Classes", CLASSES_PROPS));

  const mistakesDbId =
    existingChildren?.mistakes ??
    (await createDb(
      client,
      parentPageId,
      "Mistake Notes",
      await mistakesProps(client, classesDbId)
    ));

  const assignmentsDbId =
    existingChildren?.assignments ??
    (await createDb(
      client,
      parentPageId,
      "Assignments",
      await assignmentsProps(client, classesDbId)
    ));

  const syllabiDbId =
    existingChildren?.syllabi ??
    (await createDb(
      client,
      parentPageId,
      "Syllabi",
      await syllabiProps(client, classesDbId)
    ));

  return {
    parentPageId,
    classesDbId,
    mistakesDbId,
    assignmentsDbId,
    syllabiDbId,
  };
}

async function createDb(
  client: Client,
  parentPageId: string,
  title: string,
  properties: DbPropertyMap
): Promise<string> {
  const created = (await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    initial_data_source: { properties },
  })) as unknown as { id: string; data_sources?: Array<{ id: string }> };

  // Prime the data-source cache so the first query on this DB doesn't
  // need an extra retrieve round-trip.
  const dsId = created.data_sources?.[0]?.id;
  if (dsId) primeDataSourceCache(created.id, dsId);
  return created.id;
}

type ExistingChildren = {
  classes?: string;
  mistakes?: string;
  assignments?: string;
  syllabi?: string;
};

async function findExistingSteadiiPages(
  client: Client,
  title: string
): Promise<Array<{ id: string; url: string | null }>> {
  try {
    const resp = await client.search({
      query: title,
      filter: { property: "object", value: "page" },
      page_size: 25,
    });
    const out: Array<{ id: string; url: string | null }> = [];
    for (const r of resp.results) {
      const obj = r as unknown as {
        id: string;
        object: string;
        url?: string;
        archived?: boolean;
        parent?: { type?: string };
        properties?: { title?: { title?: Array<{ plain_text?: string }> } };
      };
      if (obj.archived) continue;
      // Only consider pages owned by the workspace or parented on another
      // page — never a database row that happens to be titled "Steadii".
      if (obj.parent?.type === "database_id") continue;
      const titleText = (
        obj.properties?.title?.title?.map((t) => t.plain_text ?? "").join("") ??
        ""
      ).trim();
      if (titleText === title) out.push({ id: obj.id, url: obj.url ?? null });
    }
    return out;
  } catch {
    return [];
  }
}

async function findSteadiiChildDatabases(
  client: Client,
  parentPageId: string
): Promise<ExistingChildren> {
  const out: ExistingChildren = {};
  let cursor: string | undefined;
  do {
    const resp = await client.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of resp.results) {
      if (!("type" in block)) continue;
      if (block.type !== "child_database") continue;
      const title = block.child_database.title.trim();
      if (title === "Classes") out.classes = block.id;
      else if (title === "Mistake Notes") out.mistakes = block.id;
      else if (title === "Assignments") out.assignments = block.id;
      else if (title === "Syllabi") out.syllabi = block.id;
    }
    cursor = resp.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

export type DuplicateScore = {
  id: string;
  url: string | null;
  childCount: number;
  rowTotal: number;
};

// Pure-ish: takes a client to probe, returns a score per candidate. Used by
// resolveDuplicateSteadiiPages. Broken out for testability.
export async function scoreSteadiiCandidates(
  client: Client,
  candidates: DuplicateCandidate[]
): Promise<DuplicateScore[]> {
  const out: DuplicateScore[] = [];
  for (const c of candidates) {
    const children = await findSteadiiChildDatabases(client, c.id);
    const childIds = [
      children.classes,
      children.mistakes,
      children.assignments,
      children.syllabi,
    ].filter(Boolean) as string[];
    const childCount = childIds.length;
    let rowTotal = 0;
    for (const dbId of childIds) {
      try {
        const dsId = await resolveDataSourceId(client, dbId);
        const resp = await client.dataSources.query({
          data_source_id: dsId,
          page_size: 1,
        });
        rowTotal += resp.results.length + (resp.has_more ? 1 : 0);
      } catch {
        // probe failure shouldn't block the dedup decision
      }
    }
    out.push({ id: c.id, url: c.url, childCount, rowTotal });
  }
  return out;
}

export type DedupDecision =
  | { kind: "adopt"; winnerId: string; loserIds: string[]; reason: string }
  | { kind: "ambiguous"; reason: string };

// Decide which candidate wins based on the scoring table + the stored
// parent_page_id hint. Pure; no client calls. Easy to unit-test.
export function decideSteadiiWinner(
  scores: DuplicateScore[],
  storedParentPageId: string | null
): DedupDecision {
  if (scores.length < 2) {
    return {
      kind: "ambiguous",
      reason: "unexpected: decideSteadiiWinner called with <2 candidates",
    };
  }

  // Step 1: stored parent page id wins if it's in the candidate set.
  if (storedParentPageId) {
    const match = scores.find((s) => s.id === storedParentPageId);
    if (match) {
      return {
        kind: "adopt",
        winnerId: match.id,
        loserIds: scores.filter((s) => s.id !== match.id).map((s) => s.id),
        reason: "matches_stored_parent_page_id",
      };
    }
  }

  // Step 2: most child DBs wins (Classes / Mistake Notes / Assignments / Syllabi).
  const maxChild = Math.max(...scores.map((s) => s.childCount));
  const childLeaders = scores.filter((s) => s.childCount === maxChild);
  if (childLeaders.length === 1) {
    return {
      kind: "adopt",
      winnerId: childLeaders[0].id,
      loserIds: scores.filter((s) => s.id !== childLeaders[0].id).map((s) => s.id),
      reason: "most_child_databases",
    };
  }

  // Step 3: tiebreak by row count across children.
  const maxRows = Math.max(...childLeaders.map((s) => s.rowTotal));
  const rowLeaders = childLeaders.filter((s) => s.rowTotal === maxRows);
  if (rowLeaders.length === 1) {
    return {
      kind: "adopt",
      winnerId: rowLeaders[0].id,
      loserIds: scores.filter((s) => s.id !== rowLeaders[0].id).map((s) => s.id),
      reason: "most_rows_in_children",
    };
  }

  // If we're still tied AND some of the tied candidates have real data,
  // refuse to auto-dedup. Empty-tie (all zero rows) picks the first.
  if (maxRows === 0) {
    return {
      kind: "adopt",
      winnerId: rowLeaders[0].id,
      loserIds: scores.filter((s) => s.id !== rowLeaders[0].id).map((s) => s.id),
      reason: "empty_tie_picked_first",
    };
  }

  return {
    kind: "ambiguous",
    reason: "multiple_candidates_with_live_data",
  };
}

async function createSteadiiParent(client: Client, title: string) {
  try {
    return await client.pages.create({
      parent: { type: "workspace", workspace: true },
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
    } as unknown as Parameters<Client["pages"]["create"]>[0]);
  } catch {
    // fall through
  }

  const search = await client.search({
    filter: { property: "object", value: "page" },
    page_size: 1,
  });
  const first = search.results[0];
  if (!first || !("id" in first)) {
    throw new NotionSetupNoAccessiblePageError();
  }

  try {
    return await client.pages.create({
      parent: { type: "page_id", page_id: first.id },
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
    });
  } catch {
    throw new NotionSetupNoAccessiblePageError();
  }
}
