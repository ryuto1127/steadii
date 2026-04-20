import "server-only";
import type { Client } from "@notionhq/client";

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

type DbPropertyMap = Parameters<Client["databases"]["create"]>[0]["properties"];

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

function classRelation(classesDbId: string): DbPropertyMap[string] {
  return {
    relation: {
      database_id: classesDbId,
      type: "dual_property",
      dual_property: {},
    },
  };
}

function mistakesProps(classesDbId: string): DbPropertyMap {
  return {
    Title: { title: {} },
    Class: classRelation(classesDbId),
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

function assignmentsProps(classesDbId: string): DbPropertyMap {
  return {
    Title: { title: {} },
    Class: classRelation(classesDbId),
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

function syllabiProps(classesDbId: string): DbPropertyMap {
  return {
    Title: { title: {} },
    Class: classRelation(classesDbId),
    Term: { rich_text: {} },
    Grading: { rich_text: {} },
    Attendance: { rich_text: {} },
    Textbooks: { rich_text: {} },
    OfficeHours: { rich_text: {} },
    SourceURL: { url: {} },
  };
}

export async function runNotionSetup(
  client: Client,
  opts: { title?: string } = {}
): Promise<NotionSetupResult> {
  const title = opts.title ?? "Steadii";

  // Try to adopt an existing Steadii page before creating a duplicate.
  const existing = await findExistingSteadiiPages(client, title);
  if (existing.length > 1) {
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

  const classesDbId =
    existingChildren?.classes ??
    (await createDb(client, parentPageId, "Classes", CLASSES_PROPS));

  const mistakesDbId =
    existingChildren?.mistakes ??
    (await createDb(client, parentPageId, "Mistake Notes", mistakesProps(classesDbId)));

  const assignmentsDbId =
    existingChildren?.assignments ??
    (await createDb(
      client,
      parentPageId,
      "Assignments",
      assignmentsProps(classesDbId)
    ));

  const syllabiDbId =
    existingChildren?.syllabi ??
    (await createDb(client, parentPageId, "Syllabi", syllabiProps(classesDbId)));

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
  const created = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    properties,
  });
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

async function createSteadiiParent(client: Client, title: string) {
  try {
    return await client.pages.create({
      parent: { type: "workspace", workspace: true },
      properties: {
        title: [{ type: "text", text: { content: title } }],
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
        title: [{ type: "text", text: { content: title } }],
      },
    });
  } catch {
    throw new NotionSetupNoAccessiblePageError();
  }
}
