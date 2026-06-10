[🇬🇧 Read in English](./README.md)

# Steadii

> **学業に、あなただけの AI 秘書を。**
> あなたの代わりに読み、書き、思い出す。

[![α invite-only](https://img.shields.io/badge/status-α%20invite--only-F59E0B?style=flat-square)](https://mysteadii.com)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue?style=flat-square)](./LICENSE)

[**mysteadii.com**](https://mysteadii.com)

---

## Steadii とは

Steadii は、大学生のための静かで先回り型の AI エージェントです。受信メール・カレンダー・シラバス・過去の間違いを横断して読み取り、本当に手を動かすべきことだけを浮かび上がらせます。ボタン探しもメニュー操作も不要。話しかけるだけで、Steadii が動きます。

差別化の核は、学生コンテキスト統合の深さ ─ Gmail + カレンダー + タスク + 間違いノート + シラバス + クラス + 大学発信フィードを、一つのエージェントが横断して推論します。汎用 AI アシスタントが持っていない取り込み面積を、Steadii は最初から前提に設計されています。

## できること

- **受信箱を分類して、必要な返信は下書きまで。** Steadii が全メールをリスク階層 (低 / 中 / 高) で分類し、返信が必要なものは下書きを用意します。返信不要だが大事なものには「重要 — 返信不要」のマーク、それ以外は静かにアーカイブ。送信は必ず 10 秒の取り消し窓 (変更可能) + 明示的な承認を経由します。
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
   ユーザー承認 (10 秒の取り消し・変更可能)  →  Gmail / Calendar / Tasks API
        ↓
   L3-lite フィードバック信号  →  次回 L2 分類で per-user sender bias
```

先回りスキャナーは per-user debounce 付きのジョブとして、書き込みイベント駆動 + 日次 cron で、統合コンテキスト (カレンダーイベント、シラバススケジュール、試験 / 講義ウィンドウ、課題、エンティティグラフ) を横断します。ハードコード済みのルール群が、時間衝突・試験衝突・移動中の締切・過負荷スケジュール・Classroom 締切の差し迫り・カレンダーの二重予約・課題締切の接近・静かになったエンティティ (人 / スレッド)・締切が集中したエンティティを検出します。発見された issue は LLM 提案ジェネレーターを通り、限定ツールセットから 2–4 個のアクションボタンメニューに変換されます。

## コントリビュート

Steadii は α 段階のため、現在外部コントリビュートは受け付けていません。リポジトリ公開はプロダクトの透明性のため ─ ユーザーは自分のエージェントが何をしているかを読めます。アカデミックソフトウェアコミュニティへの貢献も意図しています。

セキュリティ問題を発見した場合は、公開 issue ではなく [hello@mysteadii.com](mailto:hello@mysteadii.com) まで非公開でご連絡ください。

## 連絡先

- **Web**: [mysteadii.com](https://mysteadii.com)
- **Email**: [hello@mysteadii.com](mailto:hello@mysteadii.com)
- **α アクセスをリクエスト**: [mysteadii.com/request-access](https://mysteadii.com/request-access)

## ライセンス

[FSL-1.1-MIT](./LICENSE) ─ Functional Source License + 2 年後の MIT future grant。Copyright 2026 ryuto1127。非商用の教育 / 研究 / 内部利用 / プロフェッショナルサービスでの使用、改変、再配布が可能です。競合する商用プロダクトの構築はソースライセンスでは不可ですが、各リリースから 2 年後にコードが完全な MIT ライセンスに自動転換されます。
