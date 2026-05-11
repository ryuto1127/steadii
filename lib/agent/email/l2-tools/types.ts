import "server-only";

// engineer-41 — L2 tool registry types. Mirrors lib/agent/tools/types.ts but
// trimmed: the agentic L2 loop runs in trusted server context (no user-
// confirmation gates, no audit_log writes inside the tool body), so the
// schema only needs the name + description + JSON Schema for OpenAI plus
// a callable `execute`.

export type L2ToolContext = {
  userId: string;
  inboxItemId: string;
};

export type L2ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type L2ToolExecutor<A = unknown, R = unknown> = {
  schema: L2ToolSchema;
  execute: (ctx: L2ToolContext, args: A) => Promise<R>;
};

export type L2OpenAIToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function l2OpenAIToolDef(
  schema: L2ToolSchema
): L2OpenAIToolDefinition {
  return {
    type: "function",
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  };
}
