# Wave 3 — secretary deepening (single mega-handoff)

**Read `project_wave_3_design.md` (in user memory) FIRST.** That file is the locked design spec — everything in this handoff implements it. If anything in the handoff conflicts with the spec, the spec wins.

This is a **single PR** bundling 3 features. Per `feedback_handoff_sizing.md` the 4 split criteria don't fire (locked designs, no decision gates, independent failure modes, no context bust risk). Don't split into 3.1/3.2/3.3 sub-handoffs — implement as one cohesive ship.

The 3 features all live on the Wave 2 queue surface (uses existing `QueueCard` archetypes A/B/C/E and the new informational variant of B). Internal build order suggested below; ship as one PR.

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Most recent expected: PR #120 (post-Wave-2 hotfix). If main isn't there, **STOP**.

Branch: `wave-3-secretary-deepening`. Don't push without Ryuto's explicit authorization.

---

## Strategic context (read before any code)

- `project_secretary_pivot.md` — pivot vision (no tutor, secretary-only)
- `project_wave_3_design.md` — Wave 3 locked spec (THIS WAVE)
- `project_wave_2_home_design.md` — queue archetype reference (you'll be reusing these)
- `feedback_self_capture_verification_screenshots.md` — engineers self-capture, never ask Ryuto
- AGENTS.md §12 (final report shape) and §13 (verification protocol)

---

## Feature 1 — Meeting pre-brief (build first, smallest surface)

15 minutes before any calendar event with attendees, Steadii surfaces a context-loaded brief: last interaction, open threads, pending decisions, relevant deadlines, recent mistake notes for that prof's class.

### Trigger

- Cron tick at 5-minute granularity (or schedule precisely 15 min before each upcoming event with attendees — engineer's call). Reuse existing QStash cron infra.
- Scan upcoming events: skip non-academic via heuristic (title or attendee email domains)
- For each qualifying event, generate brief if not cached

### Brief content

LLM-generated summary covering:
- Last interaction with each attendee (most recent email + 1-line summary)
- Open / unresolved threads with that attendee
- Pending decisions waiting on that attendee
- Relevant deadlines (next 7 days for any class shared with attendee)
- Recent mistake notes for that prof's class (last 30 days)

Prompt budget: < 4K input tokens.

### UI surface — Type B informational variant

Wave 2's `QueueCard` already accepts the optional `primaryAction` prop — when omitted, render only secondary actions + dismiss. Pre-brief uses this:

- Title: "Meeting with {attendee} in {N} min"
- Body: 4-6 bullets of context summary
- Actions: [Open detail] [Open in Calendar] [Mark reviewed] [Dismiss] (no primary "Send" button)
- Detail expansion: full executive briefing with last 30 days of interactions

### Push notification

Type-A-tier override per spec — pre-brief is time-sensitive even though it's informational. Wire to the `STEADII_WEB_PUSH_ENABLED` flag from Wave 2; if flag is off, fall back to email digest.

### Cache

Per event id, persist generated brief in DB (`event_pre_briefs` table or similar). Invalidate on:
- New email from any attendee since cache time
- New task assigned with deadline before event
- Event itself updated (time / attendee changed)

### Cost target

~$0.005-0.01 per brief × 5-10 events/day/user = ~$1.50/user/month at full ramp. Acceptable. If a heavy user blows past $5/month, gate behind a Settings toggle (default ON for ≤10 events/day).

---

## Feature 2 — Group project coordinator

Track group projects (auto-detected or manually created), monitor member silence, draft check-in emails when threads go quiet.

### Detection — HYBRID auto-suggest + manual

Auto-detection signals (any 1+ hits → emit Type E clarifying card):
- Email thread with 3+ messages × 3+ unique participants × 7+ day active window (user is one of the participants)
- Calendar event with 3+ attendees of same email domain (likely classmates)
- Syllabus chunk extracted via LLM mentions "group project" — tag at ingestion, surface as suggestion when first matches

Type E card example:
> "PSY100 でグループプロジェクトらしき活動を検出: Jane / Bob / Carlos と過去 2 週間で 7 通やり取り。tracker を作りますか?" [作成] / [これは別件] / [後で聞く]

User confirm → group project entity created.

Manual path: command palette ("PSY100 group project 作って Jane Bob Carlos") → Steadii fetches relevant email history + creates entity.

### Data model

```
group_projects (
  id (uuid, default random),
  user_id (FK, cascade),
  class_id (FK, nullable — non-class group projects allowed),
  title (text),
  deadline (date, nullable),
  source_thread_ids (text[]),
  detection_method (enum: 'auto' | 'manual'),
  status (enum: 'active' | 'done' | 'abandoned'),
  created_at (timestamptz default now)
)

group_project_members (
  group_project_id (FK, cascade),
  email (text),
  name (text, nullable),
  role (text, nullable),
  last_responded_at (timestamptz, nullable),
  last_message_at (timestamptz, nullable),
  status (enum: 'active' | 'silent' | 'done'),
  PRIMARY KEY (group_project_id, email)
)

group_project_tasks (
  id (uuid, default random),
  group_project_id (FK, cascade),
  title (text),
  assignee_email (text, nullable — references members.email),
  due (date, nullable),
  done_at (timestamptz, nullable)
)
```

Add Drizzle schema entries + migration.

### Silence detection

- Daily cron updates per-member status
- Member is `silent` when `last_message_at > last_responded_at` AND `now - last_responded_at > 14 days`
- Surface as Type C card: "PSY100 group · Jane silent 14 days · 締切 5 日前"
- User clicks → Steadii drafts low-stakes check-in to Jane → Type B card upgrade for review/send

### Detail page

`/app/groups/[id]` (new route):
- Members list with status pills
- Tasks (assignee + due + done state)
- Source threads (link to inbox detail)
- Deadline countdown
- Actions: [全員に進捗確認 broadcast] [タスク追加] [メンバー追加] [Archive]

### Blocker detection — STRETCH

If task A.assignee = X waits on task B.assignee = Y and Y's last update was N days ago → blocker. Surface as Type C card.

**If implementation runs over scope, defer blocker detection to Wave 3.5.** Silence detection is must-have, blocker detection is nice-to-have for this PR.

### Cost

Per silence detection: zero LLM (rule-based).
Per check-in draft: 1 LLM call via existing W1 pipeline. Bounded.
No ongoing per-user cost outside what existing W1 already spends.

---

## Feature 3 — Office hours scheduler

User-initiated via voice / command palette / chat. Steadii looks up office hours from syllabus, compiles relevant questions, drafts request email.

### Trigger

- Voice / text command: "Prof Tanaka と office hours、ch4 について" / "Schedule with my MAT223 prof about chapter 4"
- Routes through chat scope detection (already wired in Wave 1) — secretary scope, not tutor

### Flow

1. **Office hours look-up**: query syllabus for the named prof. LLM extracts office hours per prof during ingestion (add this pass if not present); store in `class_office_hours` (or `professors.office_hours` JSON column). Surface 3 candidate slots from next 14 days.

2. **Question compilation**: orchestration (no new LLM call):
   - Recent mistake notes referencing the topic ("ch4")
   - Unresolved emails with that prof referencing the topic
   - Recent chats mentioning the topic
   - Ambiguous task / assignment items in the relevant class
   - Top 3-5 by recency

3. **Type A card**:
   ```
   ❓ Prof Tanaka office hours
   Slots:
   ◯ Tue 14:00-16:00 (5/13)
   ◯ Thu 10:00-12:00 (5/15)
   ◯ Fri 13:00-15:00 (5/16)
   
   Compiled questions (3):
   - ch4 §3.4 線形変換 例題 step 不明 (5/10 mistake)
   - 中間 (5/20) 出題範囲確認
   - ch4 extension request 未返信 (5/14 メール)
   
   [Pick slot] [Edit questions] [Cancel]
   ```

4. User picks slot + confirms questions → Steadii drafts email (slot proposal + question list inline) → Type B card upgrade for review/send.

5. User approves send → email out + provisional Calendar event created with question list in description.

### Office hours extraction backfill

Wave 1 syllabus ingestion already runs LLM extraction. Add a separate "office hours" parser pass during this wave + one-shot script to backfill existing syllabi.

### NO Calendly / Cal.com integration

Email-based scheduling only. Calendly / Cal.com / Google Calendar Appointments stay deferred to post-α — JP profs rarely have Calendly, EN profs mixed. If a prof has a known scheduling URL (e.g. extracted from email signature), surface it as a fallback in the slot-picker UI.

### Cost

Question compilation: 0 LLM.
Slot extraction: 1 LLM call per prof during ingestion (~$0.001).
Email draft: 1 LLM call via W1 pipeline. Bounded.
Negligible per-user cost.

---

## Internal build order (within one PR)

Engineer's recommended sequence for managing complexity within the single PR:

1. Meeting pre-brief first — smallest surface, validates Type B informational variant works end-to-end
2. Group project coordinator — biggest data-model addition, do middle so it's not last-minute
3. Office hours scheduler — depends on syllabus office-hours extraction, do last

But ship as ONE PR.

---

## Verification

For each feature, capture screenshots @ 1440×900 in BOTH locales (EN + JA). Per AGENTS.md §13.

Required captures:
- Pre-brief Type B card on Home queue (with mock data if real data sparse)
- Pre-brief detail expansion view
- Group project Type E auto-detect card on Home queue
- Group project Type C silence card → upgraded to Type B draft (if you can sequence the demo)
- Group project detail page `/app/groups/[id]` (with mock data)
- Office hours Type A card with slot picker + question list
- Office hours email draft preview (Type B after slot pick)

---

## Tests

- `pnpm typecheck`: 2 pre-existing handwritten-mistake-save errors stay
- `pnpm test`: stay above 832 / 832 pass
- `pnpm i18n:audit`: must be **0 findings** (this is now a CI gate from polish-19)

New test files:
- `tests/pre-brief-cron.test.ts` — cron picker, cache invalidation logic
- `tests/group-project-detection.test.ts` — auto-detection signal-fire cases
- `tests/group-project-silence.test.ts` — daily silence detection logic
- `tests/office-hours-extraction.test.ts` — LLM-extracted office hours parser
- `tests/queue-card-pre-brief.test.tsx` — Type B informational variant render

---

## What NOT to touch

- Wave 2's queue-card system itself (extend, don't refactor — `primaryAction` prop is the extension point)
- Phase 8 proactive engine (the engine that produces proposals — Wave 3 only adds new SURFACES on top)
- W1 draft generation pipeline — same, extend with new draft templates if needed but don't refactor
- Mistake notes / OCR pipeline — stays input-side
- Voice cleanup logic — out of scope
- Translation key namespace structure — only add new keys, don't restructure
- `app/app/inbox/*` — Inbox stays as-is (the "show me everything" surface; queue stays the "what needs me")
- Auto-execute mode — that's Wave 5

If you find yourself wanting to refactor anything beyond the 3 features, **flag and pause**.

---

## Final report format

Per AGENTS.md §12:

1. **Branch / PR name**: `wave-3-secretary-deepening`
2. **Summary**: per-feature what shipped + any scope flags
3. **Verification screenshots**: list above, all 1440×900, EN + JA pairs
4. **Tests added**: 5 new test files (or whatever you ended up with)
5. **Memory entries to update**: any spec contradictions or learnings
6. **Out-of-scope flags**: anything for Wave 3.5 / Wave 5 / post-α

---

## Estimated cost (LLM only, time isn't a decision factor)

- Pre-brief generation per cron tick: ~$0.005-0.01 per active event
- Group project check-in draft: existing W1 pipeline, no new cost
- Office hours flow: ~$0.001 per office hours extraction (one-shot per syllabus)

Aggregate at α scale (10-100 users): ~$15-150/month for pre-briefs, negligible for the rest. Acceptable.

If pre-brief costs surprise during dogfood, gate behind a Settings toggle and flag.
