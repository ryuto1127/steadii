import "server-only";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolExecutor = (args: unknown) => Promise<unknown>;

export const STUB_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "notion_search_pages",
      description: "(Stub — not implemented yet) Search the user's registered Notion pages.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
];

export async function executeStubTool(_name: string, _args: unknown): Promise<unknown> {
  return { error: "not implemented yet", phase: "Phase 3 will wire tool execution" };
}
