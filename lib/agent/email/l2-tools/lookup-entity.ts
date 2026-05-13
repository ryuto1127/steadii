import "server-only";
import {
  findEntitiesByQuery,
  getLinksForEntity,
  resolveLinkLabels,
} from "@/lib/agent/entity-graph/lookup";
import type { L2ToolExecutor } from "./types";

// engineer-51 — L2 variant of the lookup_entity tool. Identical
// semantics to the chat-side version (lib/agent/tools/lookup-entity.ts)
// but routed through the L2 tool registry so the agentic L2 reasoning
// loop can pull cross-source context BEFORE drafting a reply. Common
// pattern: recruiter email arrives, L2 calls lookup_entity("recruiter
// company name") → finds 4 prior emails + 1 calendar event + 1 chat
// session → drafts with that history in mind.

export type LookupEntityL2Args = {
  query: string;
  kind?: "person" | "project" | "course" | "org" | "event_series";
};

export type LookupEntityL2Result = {
  query: string;
  candidates: Array<{
    entityId: string;
    kind: string;
    displayName: string;
    aliases: string[];
    description: string | null;
    primaryEmail: string | null;
    lastSeenAt: string;
    matchScore: number;
    recentLinks: Array<{
      sourceKind: string;
      label: string;
      occurredAt: string | null;
    }>;
  }>;
  noMatchHint: string | null;
};

const LINKS_PER_ENTITY = 8;

export const lookupEntityL2Tool: L2ToolExecutor<
  LookupEntityL2Args,
  LookupEntityL2Result
> = {
  schema: {
    name: "lookup_entity",
    description:
      "Look up what Steadii knows about a person, project, course, organization, or recurring event from the user's cross-source entity graph. Returns up to 3 candidate entities with descriptions and recent linked records (emails, drafts, calendar events, assignments, chat sessions). Call this near the start of the agentic loop whenever the inbound email mentions a name / company / project / course that might have prior context. Skip for unambiguous transactional senders (newsletters, system noreply). Returns empty when no prior context exists — DON'T fabricate; phrase the draft assuming no prior history in that case.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "Fuzzy name or alias to look up.",
        },
        kind: {
          type: "string",
          enum: ["person", "project", "course", "org", "event_series"],
          description:
            "Optional restriction to a single entity kind. Omit to search across all kinds.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async execute(ctx, args) {
    const query = (args.query ?? "").trim();
    if (!query) {
      return {
        query: "",
        candidates: [],
        noMatchHint: "Empty query — provide a name to look up.",
      };
    }
    const candidates = await findEntitiesByQuery({
      userId: ctx.userId,
      query,
      kind: args.kind,
      topK: 3,
    });
    if (candidates.length === 0) {
      return {
        query,
        candidates: [],
        noMatchHint:
          "Steadii has no prior record of this entity. Don't fabricate context — phrase the draft accordingly.",
      };
    }
    const out: LookupEntityL2Result["candidates"] = [];
    for (const c of candidates) {
      const links = await getLinksForEntity({
        userId: ctx.userId,
        entityId: c.id,
        limit: LINKS_PER_ENTITY,
      });
      const labels = await resolveLinkLabels({ userId: ctx.userId, links });
      const labelByKey = new Map(
        labels.map((l) => [`${l.sourceKind}:${l.sourceId}`, l])
      );
      out.push({
        entityId: c.id,
        kind: c.kind,
        displayName: c.displayName,
        aliases: c.aliases,
        description: c.description,
        primaryEmail: c.primaryEmail,
        lastSeenAt: c.lastSeenAt.toISOString(),
        matchScore: c.matchScore,
        recentLinks: links.map((l) => {
          const lbl = labelByKey.get(`${l.sourceKind}:${l.sourceId}`);
          return {
            sourceKind: l.sourceKind,
            label: lbl?.label ?? "(unknown)",
            occurredAt: lbl?.occurredAt
              ? lbl.occurredAt.toISOString()
              : null,
          };
        }),
      });
    }
    return { query, candidates: out, noMatchHint: null };
  },
};
