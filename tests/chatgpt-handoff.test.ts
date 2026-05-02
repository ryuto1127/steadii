import { describe, expect, it } from "vitest";
import {
  buildHandoffPrompt,
  buildHandoffUrl,
  type HandoffContext,
} from "@/lib/chat/chatgpt-handoff-prompt";

const emptyCtx: HandoffContext = { classes: [], recentMistakes: [] };

const richCtx: HandoffContext = {
  classes: [
    { code: "MAT223", name: "Linear Algebra", professor: "Tanaka" },
    { code: "PHY205", name: "Classical Mechanics", professor: null },
    { code: null, name: "Independent Study", professor: "Singh" },
  ],
  recentMistakes: [
    { title: "Integration by parts" },
    { title: "Eigenvalue decomposition" },
  ],
};

describe("buildHandoffPrompt", () => {
  it("returns just the question when there's no context", () => {
    const out = buildHandoffPrompt("What is a derivative?", emptyCtx);
    expect(out).toContain("My question:");
    expect(out).toContain("What is a derivative?");
    expect(out).not.toContain("Context:");
  });

  it("includes class list and weak-area notes when context exists", () => {
    const out = buildHandoffPrompt(
      "Explain row reduction in plain words",
      richCtx
    );
    expect(out).toContain("Context:");
    expect(out).toContain("MAT223 Linear Algebra — Prof Tanaka");
    expect(out).toContain("PHY205 Classical Mechanics");
    expect(out).toContain("Independent Study — Prof Singh");
    expect(out).toContain("Recent topics I've struggled with");
    expect(out).toContain("Integration by parts");
    expect(out).toContain("Eigenvalue decomposition");
    expect(out).toContain("My question:");
    expect(out).toContain("Explain row reduction in plain words");
    expect(out).toContain("undergraduate-level explanation");
  });

  it("trims the user-supplied question", () => {
    const out = buildHandoffPrompt("   spaced out  \n", emptyCtx);
    expect(out).toContain("My question:\nspaced out");
  });
});

describe("buildHandoffUrl", () => {
  it("produces a chatgpt.com URL with prompt= param", () => {
    const url = buildHandoffUrl("What is a derivative?");
    expect(url.startsWith("https://chatgpt.com/?prompt=")).toBe(true);
  });

  it("URL-encodes the prompt (spaces, quotes, newlines)", () => {
    const url = buildHandoffUrl("hello\nworld \"quoted\"");
    // The encoded payload should not contain raw whitespace or quotes.
    const payload = url.split("?prompt=")[1] ?? "";
    expect(payload).not.toContain(" ");
    expect(payload).not.toContain("\n");
    expect(payload).not.toContain("\"");
    // Decoded round-trip must match the source string.
    expect(decodeURIComponent(payload)).toBe('hello\nworld "quoted"');
  });

  it("keeps the URL under a practical 4KB ceiling even for long prompts", () => {
    // Synthesize a 3KB question + 1KB context. URL-encoded budget per
    // the helper is 1.5KB on the prompt side; resulting URL must stay
    // under common browser caps (~4KB safe).
    const long = "x".repeat(3000);
    const url = buildHandoffUrl(long);
    expect(url.length).toBeLessThan(4096);
  });
});
