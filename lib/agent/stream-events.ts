// Pure parser for the Server-Sent-Events payload line the chat view emits.
// Kept separate so the client's event handling can be unit-tested.

export type StreamPayload =
  | { type: "message_start"; assistantMessageId: string }
  | { type: "text_delta"; delta: string }
  | {
      type: "tool_call_started";
      toolName: string;
      toolCallId: string;
      args: unknown;
    }
  | {
      type: "tool_call_result";
      toolName: string;
      toolCallId: string;
      result: unknown;
      ok: boolean;
    }
  | {
      type: "tool_call_pending";
      toolName: string;
      toolCallId: string;
      pendingId: string;
      args: unknown;
    }
  | { type: "error"; code: string; message: string }
  | { type: "title"; title: string }
  | { type: "done" }
  | { type: "message_end"; assistantMessageId: string; text: string };

export function parseSsePayloads(chunk: string): StreamPayload[] {
  const parts = chunk.split("\n\n");
  const out: StreamPayload[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("data:")) continue;
    try {
      const payload = JSON.parse(trimmed.slice(5).trim()) as StreamPayload;
      out.push(payload);
    } catch {
      // non-JSON / partial chunk — skip
    }
  }
  return out;
}

// Minimal reducer used in tests to verify that error events reach visible
// UI state. The real component does more (tool events, etc.) but errors
// have the tightest correctness requirement.
export type ReducedState = {
  assistantContent: string;
  streamError: string | null;
};

export function reduceForTest(
  events: StreamPayload[]
): ReducedState {
  let assistantContent = "";
  let streamError: string | null = null;
  for (const e of events) {
    if (e.type === "text_delta") assistantContent += e.delta;
    else if (e.type === "error") {
      streamError = e.message;
      if (!assistantContent) {
        assistantContent = `⚠ ${e.message}`;
      }
    }
  }
  return { assistantContent, streamError };
}
