import type { ToolMutability } from "../confirmation";

export type ToolSchema = {
  name: string;
  description: string;
  mutability: ToolMutability;
  parameters: Record<string, unknown>;
};

export type ToolExecutionContext = {
  userId: string;
};

export type ToolExecutor<A = unknown, R = unknown> = {
  schema: ToolSchema;
  execute: (ctx: ToolExecutionContext, args: A) => Promise<R>;
};

export type OpenAIToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function toOpenAIToolDefinition(schema: ToolSchema): OpenAIToolDefinition {
  return {
    type: "function",
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  };
}
