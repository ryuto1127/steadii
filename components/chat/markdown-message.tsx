"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

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

export function MarkdownMessage({ content }: { content: string }) {
  const normalized = normalizeMathDelimiters(content);
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

// Exposed for unit tests.
export const __testing = { normalizeMathDelimiters };
