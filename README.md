# Steadii

> **AI secretary for your studies.**
> Reads, writes, and remembers — for you.

[![α invite-only](https://img.shields.io/badge/status-α%20invite--only-F59E0B?style=flat-square)](https://mysteadii.com)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue?style=flat-square)](./LICENSE)

[**mysteadii.com**](https://mysteadii.com)

---

## What is Steadii

Steadii is a calm, proactive AI agent for university students. It reads your inbox, calendar, syllabi, and past mistakes, then helps you act on what matters — without you having to find buttons or remember workflows. Just chat. Steadii does the rest.

It's the depth of student-context integration — Gmail + Calendar + Tasks + Mistakes + Syllabi + Classes + LMS-adjacent feeds — woven into a single agent that reasons across all of it. General-purpose assistants don't have that ingestion surface. Steadii is built around it.

## What it does

- **Inbox triage with drafts you confirm.** Steadii classifies every incoming email by risk tier (low / medium / high), drafts replies for the ones that need them, and surfaces the rest as "important — no reply needed" or quietly archives. Every send rides a 20-second undo and your explicit approval.
- **Chat-base actions, no UI hunting.** Type "金曜 14 時に田中先生と meeting" and the calendar event appears. Type "明日大学行けないかも" and Steadii drafts emails to today's professors and offers a calendar absence-mark. The chat input is the entire app.
- **Proactive conflict detection.** When your calendar, syllabus, and recent mistakes don't agree (a trip overlapping a midterm, a deadline during travel, an exam under-prepared), Steadii notices first and surfaces a multi-action proposal — email the professor, reschedule, dismiss — before you would have noticed yourself.
- **Glass-box reasoning.** Every decision is traceable. The reasoning panel under any draft or proposal shows what the agent read, what it weighed, and which sources it cited. Your verbatim notes, syllabi, and assignments are yours to read, search, and export — never locked in.

## Demo

Live at [mysteadii.com](https://mysteadii.com). The landing-page hero video walks through three flows: email triage, chat → calendar, and proactive conflict detection.

## Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript 6
- **Database**: Neon Postgres + Drizzle ORM (Postgres-canonical for all academic entities)
- **Auth**: NextAuth (Google OAuth, Microsoft Graph)
- **AI**: OpenAI (GPT-5.4 family — Mini for chat / classify, full for draft / extract, Nano for titles / tags)
- **Payments**: Stripe (Checkout + Customer Portal + Promotion Codes)
- **Email**: Resend
- **Storage**: Vercel Blob (for syllabus PDFs and handwritten-note OCR sources)
- **Scheduling**: Upstash QStash (cron + send-queue)
- **Integrations**: Gmail, Google Calendar, Google Tasks, Microsoft Outlook + To Do, iCal subscriptions, Notion (one-way import)
- **Observability**: Sentry
- **i18n**: next-intl (EN / JA, full parity at α)
- **UI**: Tailwind CSS v4 + Radix primitives + Geist font pair, Raycast-/Arc-inspired density

## Status

**α invite-only.** First cohort: 10 Japanese university students, late April 2026 (peak openness window after JP academic year start).

Phase state:
- Phases 0–5 — auth, billing, core data model, integrations baseline (shipped)
- Phase 6 — Agent core: L1 rules + L2 LLM classify/draft, glass-box landing, dogfood metrics, staged-autonomy auto-send (shipped)
- Phase 7 — Multi-source retrieval fanout, handwritten-note OCR, Microsoft 365 + iCal integrations, public waitlist + admin approval (shipped)
- Phase 8 — Proactive cross-source scanner, multi-action proposals, syllabus auto-import, chat-aware suggestions (shipped)

**NA public launch**: Aug–Sept 2026, aligned with North American semester start. Same codebase, dual-locale and dual-pricing already in place.

## Architecture

Steadii is **Postgres-canonical**: every academic entity (Classes, Mistake Notes, Assignments, Syllabi) lives in Neon Postgres with Drizzle schema and row-level security. Notion is an optional one-way import surface for users who already keep notes there; it is not on the critical path for any agent operation.

The agent runs in a layered triage pipeline:

```
inbound event (Gmail / Calendar / Syllabus / Calendar conflict)
        ↓
   L1 rules (cheap, ~80% obvious cases routed here)
        ↓
   L2 LLM classify  →  risk tier + action
        ↓
   L2 LLM draft     →  reply body (if action = draft_reply)
        ↓
   user confirms (20s undo)  →  Gmail / Calendar / Tasks API
        ↓
   L3-lite feedback signal  →  per-user sender bias on next L2 classify
```

The proactive scanner runs as a per-user debounced job (event-driven on writes, plus a daily cron) over the unified context: calendar events, syllabus schedule items, exam/lecture windows, assignments, recent mistake activity. Five hardcoded rules detect time conflicts, exam-during-travel, deadline-during-travel, exam-under-prepared, and workload-over-capacity. Detected issues route through an LLM proposal generator that emits a 2–4 button action menu drawn from a closed tool set.

## Contributing

Steadii is in α and not currently accepting external contributions. The repository is public to make the product transparent — both for users (you can read what your agent does) and for the academic-software community.

If you find a security issue, please report it privately to [hello@mysteadii.com](mailto:hello@mysteadii.com) instead of opening a public issue.

## Contact

- **Web**: [mysteadii.com](https://mysteadii.com)
- **Email**: [hello@mysteadii.com](mailto:hello@mysteadii.com)
- **Request α access**: [mysteadii.com/request-access](https://mysteadii.com/request-access)

## License

[FSL-1.1-MIT](./LICENSE) — Functional Source License with a 2-year MIT future grant. Copyright 2026 ryuto1127. You may use, modify, and redistribute this code for non-commercial education, research, internal use, and professional services. Building a competing commercial product is not permitted under the source license, but the code becomes fully MIT-licensed two years after each release.

---

<details>
<summary><b>日本語版 (Read in Japanese)</b></summary>

# Steadii

> **学業に、あなただけの AI 秘書を。**
> あなたの代わりに読み、書き、思い出す。

[**mysteadii.com →**](https://mysteadii.com)

---

## Steadii とは

Steadii は、大学生のための静かで先回り型の AI エージェントです。受信メール・カレンダー・シラバス・過去の間違いを横断して読み取り、本当に手を動かすべきことだけを浮かび上がらせます。ボタン探しもメニュー操作も不要。話しかけるだけで、Steadii が動きます。

差別化の核は、学生コンテキスト統合の深さ ─ Gmail + カレンダー + タスク + 間違いノート + シラバス + クラス + 大学発信フィードを、一つのエージェントが横断して推論します。汎用 AI アシスタントが持っていない取り込み面積を、Steadii は最初から前提に設計されています。

## できること

- **受信箱を分類して、必要な返信は下書きまで。** Steadii が全メールをリスク階層 (低 / 中 / 高) で分類し、返信が必要なものは下書きを用意します。返信不要だが大事なものには「重要 — 返信不要」のマーク、それ以外は静かにアーカイブ。送信は必ず 20 秒の取り消し窓 + 明示的な承認を経由します。
- **チャットだけで動く、UI を探す必要なし。** "金曜 14 時に田中先生と meeting" と入力すれば予定が追加され、"明日大学行けないかも" と入力すれば今日の教授たちへの欠席連絡 draft とカレンダー欠席マークが提案されます。チャット入力欄が、そのまま操作画面です。
- **先回り型の衝突検知。** カレンダー・シラバス・過去の間違いを Steadii が横断的に監視し、旅行と中間試験の重なり、移動中の締切、対策不足の試験、過負荷スケジュールなどを、あなたが気づく前に発見します。発見した問題は「教授に連絡 / 予定変更 / 無視」など複数アクションの提案として届きます。
- **ガラス箱の推論。** 全ての判断が辿れます。下書きや提案の下にある推論パネルを開けば、エージェントが何を読み、何を重視し、どのソースを引用したかが見えます。verbatim 保存された間違いノート・シラバス・課題は、いつでも読めて、検索できて、エクスポートできて ─ どこにも閉じ込められません。

## デモ

[mysteadii.com](https://mysteadii.com) にて公開中。トップページの動画で、3 つのフロー (受信箱分類・チャット → カレンダー・先回り衝突検知) を 30 秒で見られます。

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router) + React 19 + TypeScript 6
- **データベース**: Neon Postgres + Drizzle ORM (アカデミックエンティティはすべて Postgres-canonical)
- **認証**: NextAuth (Google OAuth, Microsoft Graph)
- **AI**: OpenAI (GPT-5.4 ファミリー ─ Mini で chat / classify、本体で draft / extract、Nano で title / tag)
- **決済**: Stripe (Checkout + Customer Portal + Promotion Codes)
- **メール**: Resend
- **ストレージ**: Vercel Blob (シラバス PDF + 手書きノート OCR ソース用)
- **スケジューリング**: Upstash QStash (cron + 送信キュー)
- **連携**: Gmail, Google Calendar, Google Tasks, Microsoft Outlook + To Do, iCal 購読, Notion (一方向 import)
- **可観測性**: Sentry
- **i18n**: next-intl (EN / JA、α 時点でフルパリティ)
- **UI**: Tailwind CSS v4 + Radix primitives + Geist フォントペア、Raycast / Arc 寄りの密度

## 状況

**α は招待制。** 第一波: 日本の大学生 10 名、2026 年 4 月下旬 (新学期スタート直後の peak openness ウィンドウ)。

フェーズ状態:
- Phases 0–5 ─ 認証 / 課金 / コアデータモデル / 連携基盤 (出荷済)
- Phase 6 ─ エージェント基盤: L1 ルール + L2 LLM 分類 / 下書き、ガラス箱ランディング、dogfood 計測、staged-autonomy 自動送信 (出荷済)
- Phase 7 ─ マルチソース検索 fanout、手書きノート OCR、Microsoft 365 + iCal 連携、公開ウェイトリスト + 管理者承認 (出荷済)
- Phase 8 ─ 先回り型クロスソーススキャナー、複数アクション提案、シラバス自動 import、チャット連動サジェスト (出荷済)

**北米一般公開**: 2026 年 8–9 月、北米学期開始に合わせて。同一コードベース、デュアルロケール / デュアル料金体系は既に組み込み済。

## アーキテクチャ

Steadii は **Postgres-canonical** です。あらゆる学術エンティティ (Classes, Mistake Notes, Assignments, Syllabi) は Neon Postgres + Drizzle スキーマ + row-level security に格納されます。Notion は既に Notion でノートを取っているユーザー向けの一方向 import 面に過ぎず、エージェントの critical path には乗っていません。

エージェントは階層型 triage パイプラインで動きます:

```
inbound event (Gmail / Calendar / Syllabus / カレンダー衝突)
        ↓
   L1 ルール (低コスト、~80% の明確なケースをここで分岐)
        ↓
   L2 LLM 分類  →  リスク階層 + アクション
        ↓
   L2 LLM 下書き  →  返信本文 (アクション = draft_reply のとき)
        ↓
   ユーザー承認 (20 秒の取り消し)  →  Gmail / Calendar / Tasks API
        ↓
   L3-lite フィードバック信号  →  次回 L2 分類で per-user sender bias
```

先回りスキャナーは per-user debounce 付きのジョブとして、書き込みイベント駆動 + 日次 cron で、統合コンテキスト (カレンダーイベント、シラバススケジュール、試験 / 講義ウィンドウ、課題、最近の間違い活動) を横断します。5 つのハードコード済みルールが、時間衝突 / 旅行中の試験 / 移動中の締切 / 対策不足の試験 / 過負荷スケジュールを検出します。発見された issue は LLM 提案ジェネレーターを通り、限定ツールセットから 2–4 個のアクションボタンメニューに変換されます。

## コントリビュート

Steadii は α 段階のため、現在外部コントリビュートは受け付けていません。リポジトリ公開はプロダクトの透明性のため ─ ユーザーは自分のエージェントが何をしているかを読めます。アカデミックソフトウェアコミュニティへの貢献も意図しています。

セキュリティ問題を発見した場合は、公開 issue ではなく [hello@mysteadii.com](mailto:hello@mysteadii.com) まで非公開でご連絡ください。

## 連絡先

- **Web**: [mysteadii.com](https://mysteadii.com)
- **Email**: [hello@mysteadii.com](mailto:hello@mysteadii.com)
- **α アクセスをリクエスト**: [mysteadii.com/request-access](https://mysteadii.com/request-access)

## ライセンス

[FSL-1.1-MIT](./LICENSE) ─ Functional Source License + 2 年後の MIT future grant。Copyright 2026 ryuto1127。非商用の教育 / 研究 / 内部利用 / プロフェッショナルサービスでの使用、改変、再配布が可能です。競合する商用プロダクトの構築はソースライセンスでは不可ですが、各リリースから 2 年後にコードが完全な MIT ライセンスに自動転換されます。

</details>
