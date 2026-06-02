import { describe, expect, it } from "vitest";
import {
  isSteadiiSelfSender,
  isSteadiiSelfSenderName,
  scrubSelfSenderEmailSourcesFromProvenance,
} from "@/lib/agent/email/self-sender";
import type { RetrievalProvenance } from "@/lib/db/schema";

// Pure-helper coverage. No DB / no server-only — these are leaf functions.
// Steadii's own identity (@mysteadii.com / .xyz / "Steadii Agent") is the
// ONLY non-synthetic value allowed here; every other sample is synthetic.

describe("isSteadiiSelfSender", () => {
  it("matches Steadii's own outbound domains (any local-part / case / pad)", () => {
    expect(isSteadiiSelfSender("agent@mysteadii.com")).toBe(true);
    expect(isSteadiiSelfSender("digest@mysteadii.xyz")).toBe(true);
    expect(isSteadiiSelfSender("  Agent@MySteadii.Com ")).toBe(true);
  });

  it("returns false for third-party senders and empty input", () => {
    expect(isSteadiiSelfSender("prof@example.edu")).toBe(false);
    expect(isSteadiiSelfSender("staff@example.com")).toBe(false);
    expect(isSteadiiSelfSender(null)).toBe(false);
    expect(isSteadiiSelfSender("")).toBe(false);
  });
});

describe("isSteadiiSelfSenderName", () => {
  it("matches the Steadii Agent digest from-name (any case / pad / suffix)", () => {
    expect(isSteadiiSelfSenderName("Steadii Agent")).toBe(true);
    expect(isSteadiiSelfSenderName("  STEADII AGENT ")).toBe(true);
    // Suffixed digest from-name (the morning/weekly digest carries a tail).
    expect(isSteadiiSelfSenderName("Steadii Agent — Morning Digest")).toBe(true);
  });

  it("returns false for real-ish names and empty input", () => {
    expect(isSteadiiSelfSenderName("Course Staff")).toBe(false);
    // Prefix is "steadii agent" — a different "Steadii X" name must not hit.
    expect(isSteadiiSelfSenderName("Steadii Helper")).toBe(false);
    expect(isSteadiiSelfSenderName(null)).toBe(false);
    expect(isSteadiiSelfSenderName("")).toBe(false);
  });
});

describe("scrubSelfSenderEmailSourcesFromProvenance", () => {
  function buildProvenance(): RetrievalProvenance {
    return {
      sources: [
        {
          type: "email",
          id: "inbox-self",
          similarity: 0.9,
          snippet: "morning digest",
        },
        {
          type: "email",
          id: "inbox-real",
          similarity: 0.7,
          snippet: "a real inbound email",
        },
        {
          type: "syllabus",
          id: "chunk-1",
          syllabusId: "syl-1",
          classId: "class-1",
          similarity: 0.6,
          snippet: "syllabus chunk",
        },
        {
          type: "calendar",
          id: "event:2026-06-02:lab",
          kind: "event",
          title: "Lab session",
          start: "2026-06-02T10:00:00Z",
          end: null,
        },
      ],
      total_candidates: 42,
      returned: 2,
      classBinding: null,
      fanoutCounts: null,
      fanoutTimings: null,
    };
  }

  it("removes only the in-set email source and decrements returned", () => {
    const prov = buildProvenance();
    const { provenance, removed } = scrubSelfSenderEmailSourcesFromProvenance(
      prov,
      new Set(["inbox-self"])
    );
    expect(removed).toBe(1);
    expect(provenance).not.toBeNull();
    const ids = provenance!.sources.map((s) => s.id);
    expect(ids).not.toContain("inbox-self");
    // The other email + the syllabus + calendar sources are untouched.
    expect(ids).toContain("inbox-real");
    expect(ids).toContain("chunk-1");
    expect(ids).toContain("event:2026-06-02:lab");
    // returned recomputed from the remaining email sources (was 2 → 1).
    expect(provenance!.returned).toBe(1);
    // Untouched scalar fields pass through.
    expect(provenance!.total_candidates).toBe(42);
  });

  it("is idempotent — re-running on the scrubbed blob removes nothing", () => {
    const prov = buildProvenance();
    const first = scrubSelfSenderEmailSourcesFromProvenance(
      prov,
      new Set(["inbox-self"])
    );
    const second = scrubSelfSenderEmailSourcesFromProvenance(
      first.provenance,
      new Set(["inbox-self"])
    );
    expect(second.removed).toBe(0);
    expect(second.provenance!.sources.map((s) => s.id)).toEqual(
      first.provenance!.sources.map((s) => s.id)
    );
  });

  it("returns {provenance:null, removed:0} for null input", () => {
    expect(
      scrubSelfSenderEmailSourcesFromProvenance(null, new Set(["inbox-self"]))
    ).toEqual({ provenance: null, removed: 0 });
  });
});
