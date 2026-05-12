import { describe, expect, it } from "vitest";
import type {
  ConfirmationOption,
  ConfirmationTopic,
  QueueCardF,
  QueueCard,
} from "@/lib/agent/queue/types";

// engineer-42 — verify the Type F discriminated union threads through
// `QueueCard` without unsafe casts. Mirrors the queue-card-pre-brief
// type-contract test pattern.

describe("QueueCardF type contract", () => {
  it("accepts a valid Type F card", () => {
    const card: QueueCardF = {
      id: "confirmation:00000000-0000-0000-0000-000000000010",
      archetype: "F",
      title: "Prof Tanaka is in JST?",
      body: "Steadii inferred: JST · For: tanaka@u-tokyo.ac.jp",
      confidence: "medium",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: false,
      topic: "timezone",
      senderEmail: "tanaka@u-tokyo.ac.jp",
      inferredValue: "JST",
      options: [
        { key: "confirm", label: "confirm", type: "confirm" },
        { key: "correct", label: "correct", type: "correct" },
        { key: "dismiss", label: "dismiss", type: "dismiss" },
      ],
      originatingDraftId: null,
    };
    expect(card.archetype).toBe("F");
    expect(card.options).toHaveLength(3);
  });

  it("narrows correctly on the union via archetype", () => {
    const cards: QueueCard[] = [
      {
        id: "confirmation:1",
        archetype: "F",
        title: "Q?",
        body: "ctx",
        confidence: "medium",
        createdAt: new Date().toISOString(),
        sources: [],
        reversible: false,
        topic: "primary_language",
        senderEmail: null,
        inferredValue: "en",
        options: [],
        originatingDraftId: null,
      },
    ];
    function topicOf(c: QueueCard): ConfirmationTopic | null {
      if (c.archetype === "F") return c.topic;
      return null;
    }
    expect(topicOf(cards[0]!)).toBe("primary_language");
  });

  it("ConfirmationOption type field constrains to three values", () => {
    const opts: ConfirmationOption[] = [
      { key: "confirm", label: "OK", type: "confirm" },
      { key: "correct", label: "Other", type: "correct" },
      { key: "dismiss", label: "Skip", type: "dismiss" },
    ];
    expect(opts.map((o) => o.type)).toEqual([
      "confirm",
      "correct",
      "dismiss",
    ]);
  });
});
