import { describe, expect, it } from "vitest";
import { parseSsePayloads, reduceForTest } from "@/lib/agent/stream-events";

function sse(...payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("");
}

describe("parseSsePayloads", () => {
  it("extracts JSON payloads from SSE chunks", () => {
    const chunk = sse(
      { type: "message_start", assistantMessageId: "a1" },
      { type: "text_delta", delta: "Hello " },
      { type: "text_delta", delta: "world" }
    );
    const payloads = parseSsePayloads(chunk);
    expect(payloads).toHaveLength(3);
    expect(payloads[0].type).toBe("message_start");
  });

  it("skips partial / non-JSON fragments without throwing", () => {
    const chunk = `data: {not-json\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`;
    const payloads = parseSsePayloads(chunk);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].type).toBe("done");
  });
});

describe("reduceForTest — error events are surfaced", () => {
  it("BILLING_QUOTA_EXCEEDED sets streamError and fills the empty assistant bubble", () => {
    const events = parseSsePayloads(
      sse(
        { type: "message_start", assistantMessageId: "a1" },
        {
          type: "error",
          code: "BILLING_QUOTA_EXCEEDED",
          message: "You've used 250 of 250 credits this month on the free plan.",
        }
      )
    );
    const s = reduceForTest(events);
    expect(s.streamError).toMatch(/250 credits/);
    expect(s.assistantContent).toMatch(/⚠/);
  });

  it("OPENAI_FAILED surfaces through as a user-visible error", () => {
    const events = parseSsePayloads(
      sse({
        type: "error",
        code: "OPENAI_FAILED",
        message: "Model gpt-5.4-mini is not available on this account.",
      })
    );
    const s = reduceForTest(events);
    expect(s.streamError).toMatch(/gpt-5\.4-mini/);
  });

  it("leaves existing text in place when an error fires mid-stream", () => {
    const events = parseSsePayloads(
      sse(
        { type: "text_delta", delta: "Partial " },
        { type: "text_delta", delta: "answer..." },
        { type: "error", code: "OPENAI_FAILED", message: "boom" }
      )
    );
    const s = reduceForTest(events);
    expect(s.assistantContent).toBe("Partial answer...");
    expect(s.streamError).toBe("boom");
  });
});
