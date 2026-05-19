"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { detectDraftBlocks } from "@/lib/chat/draft-detect";
import {
  DraftActionBar,
  type DraftReplyTarget,
} from "./draft-action-bar";

// The model returns TeX using AMS-LaTeX delimiters (\(...\), \[...\])
// but remark-math only recognises $...$ and $$...$$ by default. Convert
// before handing the string off so inline and block math both render.
// Non-greedy match up to the closing pair; works for single-line inline
// and multi-line display expressions alike.
function normalizeMathDelimiters(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expr) => `\n\n$$${expr.trim()}$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expr) => `$${expr.trim()}$`);
}

export type DraftActionContext = {
  chatId: string;
  messageId: string;
  replyTarget: DraftReplyTarget;
};

export function MarkdownMessage({
  content,
  draftContext,
}: {
  content: string;
  // engineer-63 — when supplied, the markdown renderer scans for draft-shaped
  // fenced code blocks and renders Send/Edit affordances. Omitted on
  // surfaces where send/edit doesn't apply (e.g. voice agent transcripts,
  // landing-page previews).
  draftContext?: DraftActionContext;
}) {
  // Local override so Edit-then-Save updates the rendered body without
  // waiting for a router.refresh(). The server has already persisted the
  // new content; this just keeps the UI consistent until the next render.
  const [overrideContent, setOverrideContent] = useState<string | null>(null);
  const effectiveContent = overrideContent ?? content;
  const normalized = normalizeMathDelimiters(effectiveContent);
  const drafts = useMemo(
    () => (draftContext ? detectDraftBlocks(effectiveContent) : []),
    [draftContext, effectiveContent]
  );

  // 2026-05-18 — split the rendered content into alternating prose / draft
  // segments so the DraftActionBar (Send / Edit) can render INLINE
  // immediately below its corresponding code block, instead of being
  // pushed to the end of the message in a separate container. Pre-2026-
  // 05-18 layout was `[draft1][draft2]…[buttons1][buttons2]`; the user
  // expects `[draft1][buttons1][draft2][buttons2]` so the affordance is
  // visually anchored to the draft it acts on.
  const segments = useMemo(() => {
    type Segment =
      | { kind: "prose"; content: string }
      | { kind: "draft"; content: string; draftIndex: number };
    if (!draftContext || drafts.length === 0) {
      return [{ kind: "prose" as const, content: normalized }] as Segment[];
    }
    // For each draft, find its full fence boundaries (opening ``` … closing ```).
    // detectDraftBlocks returns `bodyStart` / `bodyEnd` which sit INSIDE the
    // fences; we walk outward to capture the ``` markers themselves.
    const fenceRanges: Array<{ blockStart: number; blockEnd: number; draftIndex: number }> = [];
    drafts.forEach((d, idx) => {
      const before = normalized.slice(0, d.bodyStart);
      const openMatch = before.match(/```[a-z]*\n$/);
      if (!openMatch) return;
      const blockStart = before.length - openMatch[0].length;
      const after = normalized.slice(d.bodyEnd);
      const closeMatch = after.match(/^\s*```/);
      if (!closeMatch) return;
      const blockEnd = d.bodyEnd + closeMatch[0].length;
      fenceRanges.push({ blockStart, blockEnd, draftIndex: idx });
    });
    if (fenceRanges.length === 0) {
      return [{ kind: "prose" as const, content: normalized }] as Segment[];
    }
    const out: Segment[] = [];
    let cursor = 0;
    for (const fr of fenceRanges) {
      if (fr.blockStart > cursor) {
        out.push({ kind: "prose", content: normalized.slice(cursor, fr.blockStart) });
      }
      out.push({
        kind: "draft",
        content: normalized.slice(fr.blockStart, fr.blockEnd),
        draftIndex: fr.draftIndex,
      });
      cursor = fr.blockEnd;
    }
    if (cursor < normalized.length) {
      out.push({ kind: "prose", content: normalized.slice(cursor) });
    }
    return out;
  }, [normalized, drafts, draftContext]);

  return (
    <div className="prose-chat">
      {segments.map((seg, i) =>
        seg.kind === "prose" ? (
          <ReactMarkdown
            key={`seg-${i}`}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {seg.content}
          </ReactMarkdown>
        ) : (
          <div key={`seg-${i}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {seg.content}
            </ReactMarkdown>
            {draftContext ? (
              <DraftActionBar
                key={`${draftContext.messageId}-draft-${seg.draftIndex}`}
                chatId={draftContext.chatId}
                messageId={draftContext.messageId}
                blockIndex={seg.draftIndex}
                body={drafts[seg.draftIndex].body}
                confidence={drafts[seg.draftIndex].confidence}
                replyTarget={draftContext.replyTarget}
                onEditSaved={(newBody) => {
                  // Reconstruct content by replacing this block's body. We
                  // re-run detection on the unmodified content so offsets
                  // are accurate even if other blocks above mutated.
                  const fresh = detectDraftBlocks(effectiveContent);
                  const target = fresh[seg.draftIndex];
                  if (!target) return;
                  setOverrideContent(
                    effectiveContent.slice(0, target.bodyStart) +
                      newBody +
                      effectiveContent.slice(target.bodyEnd)
                  );
                }}
              />
            ) : null}
          </div>
        )
      )}
    </div>
  );
}

// Exposed for unit tests.
export const __testing = { normalizeMathDelimiters };
