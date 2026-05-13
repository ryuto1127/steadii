import "server-only";
import { z } from "zod";
import {
  findEntitiesByQuery,
  getLinksForEntity,
  resolveLinkLabels,
  type EntityCandidateSummary,
} from "@/lib/agent/entity-graph/lookup";
import type { ToolExecutor } from "./types";

// engineer-51 — chat tool that lets the agent (and agentic L2) pull
// cross-source context about a named entity in one hop. The resolver
// has already done the heavy lifting at ingest time; this tool just
// fans out from the entity → linked rows and returns a compact summary.

const args = z.object({
  query: z.string().min(1).max(120),
  kind: z
    .enum(["person", "project", "course", "org", "event_series"])
    .optional(),
});

// Cap per-entity link return so the tool result stays well under the
// model's effective context budget. 10 links per entity × 3 entities =
// up to 30 rows, plenty for the model to reason over.
const LINKS_PER_ENTITY = 10;

export type LookupEntityCandidate = {
  entityId: string;
  kind: EntityCandidateSummary["kind"];
  displayName: string;
  aliases: string[];
  description: string | null;
  primaryEmail: string | null;
  lastSeenAt: string;
  matchScore: number;
  matchMethod: EntityCandidateSummary["matchMethod"];
  recentLinks: Array<{
    sourceKind: string;
    sourceId: string;
    label: string;
    href: string | null;
    occurredAt: string | null;
    confidence: number;
  }>;
};

export type LookupEntityResult = {
  query: string;
  candidates: LookupEntityCandidate[];
  // When zero candidates returned, the tool always returns an empty
  // array — but we surface a hint so the model can phrase the answer
  // ("Steadii has no prior record of this entity") instead of
  // hallucinating context.
  noMatchHint: string | null;
};

export const lookupEntity: ToolExecutor<
  z.infer<typeof args>,
  LookupEntityResult
> = {
  schema: {
    name: "lookup_entity",
    description:
      "Look up everything Steadii knows about a person, project, course, organization, or recurring event from the user's cross-source entity graph. Returns up to 3 candidate entities ranked by name + alias + embedding similarity, each with their description and up to 10 recent linked records (emails, drafts, calendar events, assignments, chat sessions). Call this whenever the user mentions a name / project / course / org you might have prior context on — it's the most efficient way to pull cohesive context across email + calendar + tasks + chat in one hop. `query` is a fuzzy name match. `kind` optionally restricts to one kind. Returns empty when there's no prior record — phrase the answer accordingly instead of guessing.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Fuzzy name or alias to look up. E.g. '令和トラベル', 'Prof. Tanaka', 'MAT223', 'TA hours'.",
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
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const candidates = await findEntitiesByQuery({
      userId: ctx.userId,
      query: parsed.query,
      kind: parsed.kind,
      topK: 3,
    });

    if (candidates.length === 0) {
      return {
        query: parsed.query,
        candidates: [],
        noMatchHint:
          "Steadii has no prior record of an entity matching this query. Don't guess details — say so to the user.",
      };
    }

    const out: LookupEntityCandidate[] = [];
    for (const c of candidates) {
      const links = await getLinksForEntity({
        userId: ctx.userId,
        entityId: c.id,
        limit: LINKS_PER_ENTITY,
      });
      const labels = await resolveLinkLabels({
        userId: ctx.userId,
        links,
      });
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
        matchMethod: c.matchMethod,
        recentLinks: links.map((l) => {
          const lbl = labelByKey.get(`${l.sourceKind}:${l.sourceId}`);
          return {
            sourceKind: l.sourceKind,
            sourceId: l.sourceId,
            label: lbl?.label ?? "(unknown)",
            href: lbl?.href ?? null,
            occurredAt: lbl?.occurredAt ? lbl.occurredAt.toISOString() : null,
            confidence: l.confidence,
          };
        }),
      });
    }

    return {
      query: parsed.query,
      candidates: out,
      noMatchHint: null,
    };
  },
};

export const LOOKUP_ENTITY_TOOLS = [lookupEntity];
