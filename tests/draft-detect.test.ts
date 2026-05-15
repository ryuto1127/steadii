// engineer-63 — covers lib/chat/draft-detect.ts. The heuristic decides
// whether to render the Send/Edit action bar on a fenced code block; the
// reply-target extractor turns the assistant turn's tool_calls into the
// inboxItemId the Send button hits. Both are pure functions feeding the
// chat UI's most destructive surface, so the tests are concrete.

import { describe, expect, it } from "vitest";
import {
  buildReplySubject,
  detectDraftBlocks,
  extractReplyTargetInboxItemId,
} from "@/lib/chat/draft-detect";

const JP_DRAFT_BODY = [
  "田中先生",
  "",
  "お世話になっております。CSC108 履修の山田です。",
  "明日の授業について、出席が難しいため一度ご相談させていただきたく存じます。",
  "ご都合のよろしいお時間を教えていただけますでしょうか。",
  "",
  "何卒よろしくお願いいたします。",
  "山田",
].join("\n");

const EN_DRAFT_BODY = [
  "Hi Professor Smith,",
  "",
  "Thanks for the quick reply. I'd like to confirm office hours for tomorrow afternoon — the timing you suggested works.",
  "I'll bring the problem set we discussed last week.",
  "",
  "Best,",
  "Yamada",
].join("\n");

describe("detectDraftBlocks", () => {
  it("detects a confident JP draft inside a fenced block", () => {
    const content = [
      "下書きを用意しました:",
      "```",
      JP_DRAFT_BODY,
      "```",
      "送信前に内容をご確認ください。",
    ].join("\n");
    const blocks = detectDraftBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].confidence).toBe("confident");
    expect(blocks[0].body).toContain("お世話になっております");
    expect(blocks[0].body).toContain("よろしくお願いいたします");
  });

  it("detects a confident EN draft with Hi / Best, markers", () => {
    const content = ["```email", EN_DRAFT_BODY, "```"].join("\n");
    const blocks = detectDraftBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].confidence).toBe("confident");
  });

  it("returns 'maybe' confidence when only one marker is present", () => {
    // Body is well above MIN_BODY_LENGTH (100) so length isn't what gates
    // this test — the assertion is purely about marker pairing.
    const onlyClosing = [
      "```",
      "本題に入ります。明日 14:00 から 16:00 までの間で予定を組み直しました。",
      "場所は前回と同じ建物の 3 階会議室を押さえております。詳細は別途お送りします。",
      "長文になり恐縮ですが、ご一読いただけますと幸いです。何卒ご確認のほど、",
      "よろしくお願いいたします。",
      "山田",
      "```",
    ].join("\n");
    const blocks = detectDraftBlocks(onlyClosing);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].confidence).toBe("maybe");
  });

  it("skips blocks shorter than the minimum length", () => {
    const tiny = "```\npnpm typecheck\n```";
    expect(detectDraftBlocks(tiny)).toHaveLength(0);
  });

  it("skips blocks with no greeting or closing markers", () => {
    const codeBlock = [
      "```ts",
      "function add(a: number, b: number) {",
      "  return a + b;",
      "}",
      "// this snippet is the kind of fenced block we should never tag as a draft.",
      "// it has no greeting or closing whatsoever — just code.",
      "```",
    ].join("\n");
    expect(detectDraftBlocks(codeBlock)).toHaveLength(0);
  });

  it("detects multiple drafts in one message (primary + より丁寧版)", () => {
    const content = [
      "短いバージョン:",
      "```",
      JP_DRAFT_BODY,
      "```",
      "より丁寧なバージョン:",
      "```",
      JP_DRAFT_BODY.replace("田中先生", "田中先生 様"),
      "```",
    ].join("\n");
    const blocks = detectDraftBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.confidence === "confident")).toBe(true);
  });

  it("offsets point at the body so replaceDraftBody can splice cleanly", () => {
    const content = "Intro\n```\n" + JP_DRAFT_BODY + "\n```\nOutro";
    const [block] = detectDraftBlocks(content);
    const sliced = content.slice(block.bodyStart, block.bodyEnd);
    expect(sliced.startsWith("田中先生")).toBe(true);
    expect(sliced).toContain("よろしくお願いいたします");
  });
});

describe("extractReplyTargetInboxItemId", () => {
  it("returns the inboxItemId from the most recent email_get_body call", () => {
    const toolCalls = [
      {
        id: "c1",
        type: "function",
        function: { name: "lookup_entity", arguments: '{"q":"X"}' },
      },
      {
        id: "c2",
        type: "function",
        function: {
          name: "email_get_body",
          arguments: '{"inboxItemId":"first-id"}',
        },
      },
      {
        id: "c3",
        type: "function",
        function: {
          name: "email_get_new_content_only",
          arguments: '{"inboxItemId":"second-id"}',
        },
      },
      {
        id: "c4",
        type: "function",
        function: { name: "convert_timezone", arguments: "{}" },
      },
    ];
    expect(extractReplyTargetInboxItemId(toolCalls)).toBe("second-id");
  });

  it("returns null when no email body fetch is in the history", () => {
    const toolCalls = [
      {
        id: "c1",
        type: "function",
        function: { name: "lookup_entity", arguments: "{}" },
      },
      {
        id: "c2",
        type: "function",
        function: { name: "convert_timezone", arguments: "{}" },
      },
    ];
    expect(extractReplyTargetInboxItemId(toolCalls)).toBeNull();
  });

  it("returns null on malformed input rather than throwing", () => {
    expect(extractReplyTargetInboxItemId(null)).toBeNull();
    expect(extractReplyTargetInboxItemId(undefined)).toBeNull();
    expect(extractReplyTargetInboxItemId("not-an-array")).toBeNull();
  });
});

describe("buildReplySubject", () => {
  it("prefixes 'Re: ' when not already prefixed", () => {
    expect(buildReplySubject("Office hours")).toBe("Re: Office hours");
  });

  it("does not double-prefix existing Re: subjects (case-insensitive)", () => {
    expect(buildReplySubject("Re: Office hours")).toBe("Re: Office hours");
    expect(buildReplySubject("RE: メーター異常")).toBe("RE: メーター異常");
    expect(buildReplySubject("re:  spacing")).toBe("re:  spacing");
  });

  it("returns just 'Re:' for an empty / null subject", () => {
    expect(buildReplySubject(null)).toBe("Re:");
    expect(buildReplySubject("")).toBe("Re:");
    expect(buildReplySubject("   ")).toBe("Re:");
  });
});
