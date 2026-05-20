[🇯🇵 Read in Japanese](./README.ja.md)

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
- **Chat-based actions, no UI hunting.** Type "Meeting with Prof. Tanaka, Friday 2pm" and the calendar event appears. Type "I might not make it to class tomorrow" and Steadii drafts emails to today's professors and offers a calendar absence-mark. The chat input is the entire app.
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

