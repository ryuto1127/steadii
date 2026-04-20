import "server-only";
import type { Client } from "@notionhq/client";

export type NotionSetupResult = {
  parentPageId: string;
  mistakesDbId: string;
  assignmentsDbId: string;
  syllabiDbId: string;
};

type DbPropertyMap = Parameters<Client["databases"]["create"]>[0]["properties"];

const MISTAKES_PROPS: DbPropertyMap = {
  Title: { title: {} },
  Subject: {
    select: {
      options: [
        { name: "Math", color: "blue" },
        { name: "Physics", color: "red" },
        { name: "Chemistry", color: "green" },
        { name: "CS", color: "purple" },
        { name: "Other", color: "gray" },
      ],
    },
  },
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

const ASSIGNMENTS_PROPS: DbPropertyMap = {
  Title: { title: {} },
  Subject: { select: { options: [] } },
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

const SYLLABI_PROPS: DbPropertyMap = {
  Title: { title: {} },
  Course: { rich_text: {} },
  Instructor: { rich_text: {} },
  Term: { rich_text: {} },
  Grading: { rich_text: {} },
  Attendance: { rich_text: {} },
  Textbooks: { rich_text: {} },
  OfficeHours: { rich_text: {} },
  SourceURL: { url: {} },
};

export async function runNotionSetup(
  client: Client,
  opts: { rootPageId?: string; title?: string } = {}
): Promise<NotionSetupResult> {
  const title = opts.title ?? "Steadii";

  const parent = opts.rootPageId
    ? await client.pages.create({
        parent: { type: "page_id", page_id: opts.rootPageId },
        properties: {
          title: [{ type: "text", text: { content: title } }],
        },
      })
    : await createPageAtWorkspaceRoot(client, title);

  const parentPageId = parent.id;

  const mistakes = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Mistake Notes" } }],
    properties: MISTAKES_PROPS,
  });

  const assignments = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Assignments" } }],
    properties: ASSIGNMENTS_PROPS,
  });

  const syllabi = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Syllabi" } }],
    properties: SYLLABI_PROPS,
  });

  return {
    parentPageId,
    mistakesDbId: mistakes.id,
    assignmentsDbId: assignments.id,
    syllabiDbId: syllabi.id,
  };
}

async function createPageAtWorkspaceRoot(client: Client, title: string) {
  const search = await client.search({
    filter: { property: "object", value: "page" },
    page_size: 1,
  });
  const first = search.results[0];
  if (!first || !("id" in first)) {
    throw new Error(
      "Notion integration has no accessible page to nest Steadii under — pick a page in the Notion connect dialog."
    );
  }
  return await client.pages.create({
    parent: { type: "page_id", page_id: first.id },
    properties: {
      title: [{ type: "text", text: { content: title } }],
    },
  });
}
