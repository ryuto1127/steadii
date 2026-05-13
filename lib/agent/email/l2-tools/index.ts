import "server-only";
import {
  extractCandidateDatesTool,
} from "./extract-candidate-dates";
import { inferSenderTimezoneTool } from "./infer-sender-timezone";
import { checkAvailabilityTool } from "./check-availability";
import { lookupContactPersonaTool } from "./lookup-contact-persona";
import { lookupEntityL2Tool } from "./lookup-entity";
import { queueUserConfirmationTool } from "./queue-user-confirmation";
import { detectAmbiguityTool } from "./detect-ambiguity";
import { writeDraftTool } from "./write-draft";
import {
  l2OpenAIToolDef,
  type L2OpenAIToolDefinition,
  type L2ToolExecutor,
} from "./types";

// engineer-41 — L2 tool registry. Order is the order the system prompt
// will reference them by — keep declarative ones first so the LLM picks
// "I'll lookup context, then I'll act" sequencing naturally.
export const L2_TOOLS: Array<L2ToolExecutor<unknown, unknown>> = [
  lookupContactPersonaTool as unknown as L2ToolExecutor<unknown, unknown>,
  // engineer-51 — cross-source entity graph. Use early in the loop
  // alongside lookup_contact_persona so subsequent reasoning sees both
  // sender-level facts AND entity-level history (projects, orgs, etc.).
  lookupEntityL2Tool as unknown as L2ToolExecutor<unknown, unknown>,
  extractCandidateDatesTool as unknown as L2ToolExecutor<unknown, unknown>,
  inferSenderTimezoneTool as unknown as L2ToolExecutor<unknown, unknown>,
  checkAvailabilityTool as unknown as L2ToolExecutor<unknown, unknown>,
  detectAmbiguityTool as unknown as L2ToolExecutor<unknown, unknown>,
  queueUserConfirmationTool as unknown as L2ToolExecutor<unknown, unknown>,
  writeDraftTool as unknown as L2ToolExecutor<unknown, unknown>,
];

const TOOLS_BY_NAME: Map<string, L2ToolExecutor<unknown, unknown>> = new Map(
  L2_TOOLS.map((t) => [t.schema.name, t])
);

export function getL2ToolByName(
  name: string
): L2ToolExecutor<unknown, unknown> | undefined {
  return TOOLS_BY_NAME.get(name);
}

export function l2OpenAIToolDefs(): L2OpenAIToolDefinition[] {
  return L2_TOOLS.map((t) => l2OpenAIToolDef(t.schema));
}

export {
  extractCandidateDatesTool,
  inferSenderTimezoneTool,
  checkAvailabilityTool,
  lookupContactPersonaTool,
  lookupEntityL2Tool,
  queueUserConfirmationTool,
  detectAmbiguityTool,
  writeDraftTool,
};
