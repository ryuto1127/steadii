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
  const parent = await createSteadiiParent(client, title);
  const parentPageId = parent.id;

  const classes = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Classes" } }],
    properties: CLASSES_PROPS,
  });
  const classesDbId = classes.id;

  const mistakes = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Mistake Notes" } }],
    properties: mistakesProps(classesDbId),
  });

  const assignments = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Assignments" } }],
    properties: assignmentsProps(classesDbId),
  });

  const syllabi = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Syllabi" } }],
    properties: syllabiProps(classesDbId),
  });

  return {
    parentPageId,
    classesDbId,
    mistakesDbId: mistakes.id,
    assignmentsDbId: assignments.id,
    syllabiDbId: syllabi.id,
  };
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
