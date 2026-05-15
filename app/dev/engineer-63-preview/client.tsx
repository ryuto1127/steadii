"use client";

import { NextIntlClientProvider } from "next-intl";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { DraftActionBar } from "@/components/chat/draft-action-bar";
import { en } from "@/lib/i18n/translations/en";

const SAMPLE_ASSISTANT_CONTENT = [
  "下書きをご確認ください。送信前に内容を編集することもできます。",
  "",
  "```",
  "田中先生",
  "",
  "お世話になっております。CSC108 履修の山田です。",
  "明日の授業について、出席が難しいため一度ご相談させていただきたく存じます。",
  "ご都合のよろしいお時間を教えていただけますでしょうか。",
  "",
  "何卒よろしくお願いいたします。",
  "山田",
  "```",
  "",
  "送信先: 田中先生 / 件名: Re: 明日の授業について",
].join("\n");

const REPLY_TARGET = {
  inboxItemId: "preview-inbox-1",
  to: "tanaka@example.ac.jp",
  subject: "Re: 明日の授業について",
};

export function Engineer63PreviewClient() {
  return (
    <NextIntlClientProvider locale="ja" messages={en as unknown as Record<string, unknown>}>
      <main className="min-h-screen bg-[hsl(var(--background))] p-8 text-[hsl(var(--foreground))]">
        <h1 className="text-h2 mb-4 font-medium">engineer-63 preview</h1>
        <p className="mb-6 max-w-2xl text-small text-[hsl(var(--muted-foreground))]">
          Four states of the chat draft action bar. Captured for visual
          verification per AGENTS.md §13 (1440×900). Dev-only — gated by
          NODE_ENV check on the parent server component.
        </p>

        <div className="space-y-10">
          <section className="max-w-2xl">
            <h2 className="mb-3 text-h3 font-medium">
              1 — Idle: confident draft with Send / Edit
            </h2>
            <MarkdownMessage
              content={SAMPLE_ASSISTANT_CONTENT}
              draftContext={{
                chatId: "preview-chat-1",
                messageId: "preview-msg-1",
                replyTarget: REPLY_TARGET,
              }}
            />
          </section>

          <section className="max-w-2xl">
            <h2 className="mb-3 text-h3 font-medium">
              2 — Standalone action bar (idle)
            </h2>
            <DraftActionBar
              chatId="preview-chat-2"
              messageId="preview-msg-2"
              blockIndex={0}
              body="田中先生\n\nお世話になっております。山田です。…"
              confidence="confident"
              replyTarget={REPLY_TARGET}
            />
          </section>

          <section className="max-w-2xl">
            <h2 className="mb-3 text-h3 font-medium">
              3 — Maybe-draft (smaller affordance)
            </h2>
            <DraftActionBar
              chatId="preview-chat-3"
              messageId="preview-msg-3"
              blockIndex={0}
              body="本題に入ります。明日 14:00 から 16:00 までで予定を組み直しました。詳細は別途お送りします。長文になり恐縮ですが、ご一読いただけますと幸いです。よろしくお願いいたします。山田"
              confidence="maybe"
              replyTarget={REPLY_TARGET}
            />
          </section>

          <section className="max-w-2xl">
            <h2 className="mb-3 text-h3 font-medium">
              4 — Missing reply target (Send disabled)
            </h2>
            <DraftActionBar
              chatId="preview-chat-4"
              messageId="preview-msg-4"
              blockIndex={0}
              body="田中先生\n\nお世話になっております。山田です。…"
              confidence="confident"
              replyTarget={{ inboxItemId: null, to: null, subject: null }}
            />
          </section>
        </div>
      </main>
    </NextIntlClientProvider>
  );
}
