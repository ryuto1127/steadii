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

  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalized}
      </ReactMarkdown>
      {draftContext && drafts.length > 0 ? (
        <div className="space-y-2">
          {drafts.map((d, i) => (
            <DraftActionBar
              key={`${draftContext.messageId}-draft-${i}`}
              chatId={draftContext.chatId}
              messageId={draftContext.messageId}
              blockIndex={i}
              body={d.body}
              confidence={d.confidence}
              replyTarget={draftContext.replyTarget}
              onEditSaved={(newBody) => {
                // Reconstruct content by replacing this block's body. We
                // re-run detection on the unmodified content so offsets are
                // accurate even if other blocks above mutated.
                const fresh = detectDraftBlocks(effectiveContent);
                const target = fresh[i];
                if (!target) return;
                setOverrideContent(
                  effectiveContent.slice(0, target.bodyStart) +
                    newBody +
                    effectiveContent.slice(target.bodyEnd)
                );
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Exposed for unit tests.
export const __testing = { normalizeMathDelimiters };
