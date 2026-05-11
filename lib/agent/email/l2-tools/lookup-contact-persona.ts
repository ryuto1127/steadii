import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentContactPersonas,
  type ContactStructuredFacts,
} from "@/lib/db/schema";
import type { L2ToolExecutor } from "./types";

// engineer-41 — read-only lookup of an agent_contact_personas row by
// contact email. The agentic L2 loop calls this near the start of each
// reasoning chain so the rest of the loop sees what Steadii already knows
// about the contact (relationship, free-form facts, structured facts).

export type LookupContactPersonaArgs = {
  contactEmail: string;
};

export type LookupContactPersonaResult = {
  found: boolean;
  relationship: string | null;
  facts: string[];
  structuredFacts: ContactStructuredFacts;
  lastExtractedAt: string | null;
};

export const lookupContactPersonaTool: L2ToolExecutor<
  LookupContactPersonaArgs,
  LookupContactPersonaResult
> = {
  schema: {
    name: "lookup_contact_persona",
    description:
      "Look up what Steadii has already learned about this contact: relationship label (e.g. 'MAT223 instructor'), free-form facts (e.g. 'replies same day Mon-Fri'), and structured facts (timezone, response window, primary language). Returns found=false when no persona row exists yet. ALWAYS call this near the start of the agentic loop so subsequent reasoning sees prior context.",
    parameters: {
      type: "object",
      properties: {
        contactEmail: { type: "string", minLength: 3 },
      },
      required: ["contactEmail"],
      additionalProperties: false,
    },
  },
  async execute(ctx, args) {
    const email = (args.contactEmail ?? "").trim().toLowerCase();
    if (!email) {
      return {
        found: false,
        relationship: null,
        facts: [],
        structuredFacts: {},
        lastExtractedAt: null,
      };
    }
    const [row] = await db
      .select({
        relationship: agentContactPersonas.relationship,
        facts: agentContactPersonas.facts,
        structuredFacts: agentContactPersonas.structuredFacts,
        lastExtractedAt: agentContactPersonas.lastExtractedAt,
      })
      .from(agentContactPersonas)
      .where(
        and(
          eq(agentContactPersonas.userId, ctx.userId),
          eq(agentContactPersonas.contactEmail, email)
        )
      )
      .limit(1);
    if (!row) {
      return {
        found: false,
        relationship: null,
        facts: [],
        structuredFacts: {},
        lastExtractedAt: null,
      };
    }
    return {
      found: true,
      relationship: row.relationship,
      facts: row.facts ?? [],
      structuredFacts: row.structuredFacts ?? {},
      lastExtractedAt: row.lastExtractedAt
        ? row.lastExtractedAt.toISOString()
        : null,
    };
  },
};
