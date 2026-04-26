# Phase 7 W1 Completion Report — Multi-source retrieval fanout

Implementation pickup of `phase7-w1-scoping.md`. Five PRs landed locally
on top of `main` (commit `7673e80`), branched as
`phase7-w1-{class-binding,fanout-retriever,calendar-unify,provenance,
tests-docs}`. Pushes pending Ryuto's authorization.

---

## 1. PR map

| PR | Branch | Local HEAD | Scope |
|----|--------|------------|-------|
| 1  | `phase7-w1-class-binding` | `73ebc96` | Class binding module + 3-column migration + ingest hook + JA seed list + 11 unit tests |
| 2  | `phase7-w1-fanout-retriever` | `2fe673c` | `fanout.ts` + `fanout-prompt.ts` + L2/risk/deep/draft integration + system-prompt rewrites + Google Tasks helper |
| 3  | `phase7-w1-calendar-unify` | `15c3f42` | `CalendarAssignment` widening + page fetch + sidebar `tasks` 6th item + DEPLOY.md JPY catalog |
| 4  | `phase7-w1-provenance` | `ef09718` | `RetrievalProvenance` discriminated union + typed ThinkingBar pills + ReasoningPanel footnote citations + Settings → "How your agent thinks" route |
| 5  | `phase7-w1-tests-docs` | (this PR) | Admin fanout panel + fanout-prompt snapshot tests + completion report |

The branches stack: each one is built off the previous PR's HEAD. Open
order should be 1 → 2 → 3 → 4 → 5 so each PR's diff is reviewable
without the prior PRs' changes.

---

## 2. Scoping doc § coverage

- **§3 Class binding** — `lib/agent/email/class-binding.ts` implements
  five methods (subject_code, subject_name, sender_professor,
  ja_sensei_pattern, vector_chunks) with confidence floors per scoping
  recommendation. Persistence on `inbox_items` with the partial index
  per §3.3. Backfill script at `scripts/class-binding-backfill.ts`.
- **§4 Hybrid retrieval SQL** — `lib/agent/email/fanout.ts` runs the
  structured / vector branches per source in `Promise.all` with 500ms
  per-source timeouts (§4.6). Mistakes ranked by recency (§12.4),
  syllabus by similarity, dedup-by-`syllabus_id` (§4.5).
- **§5 L2 prompt restructuring** — system-prompt rewrites for risk,
  deep, and draft now require per-source citation. New per-source tags
  (`mistake-N`, `syllabus-N`, `calendar-N`, `email-N`) in the user
  content; the `ReasoningPanel` regex keys off the same shape.
- **§6 Provenance / glass-box** — `RetrievalProvenance` widened to a
  discriminated union; `classBinding`, `fanoutCounts`, `fanoutTimings`
  added as optional fields so pre-W1 rows still parse. ThinkingBar
  renders typed pills with distinct icons + colours per source. New
  Settings → "How your agent thinks" route lists the last 10 drafts
  with their full pill row + reasoning.
- **§7 Performance** — fanout latency surfaced in admin metrics
  (per-source averages, total p̂). pgvector index deferral honoured
  (§4.7) — sequential scan stands at α scale.
- **§8 Cost / credit** — no tier-gating, no copy changes (the
  cap-exhaustion message stays generic). Spending will be observable
  in admin after α traffic accumulates.
- **§9 Failure modes** — fanout fail-soft on per-source timeout +
  full-failure fall-through to legacy `fetchUpcomingEvents` for the
  draft block. Empty-corpus prompt hint per §9.1. Wrong-class binding
  surfaces visibly in the reasoning per §9.6.
- **§10 Eval / measurement** — `email_fanout_completed` audit shape
  per §10.4 (counts + timings + binding payload). Admin page surfaces
  per-source means and class-binding method distribution. Counterfactual
  shadow eval **not** implemented per locked decision §12.8 (ship to
  all 10 α users, dogfood counterfactual instead).

---

## 3. Locked decisions honoured

All 11 decisions from §12 of the scoping doc were treated as canonical
and not re-litigated. Plus the three additional scope items (Google
Tasks in fanout, Steadii assignments on calendar, Tasks sidebar nav).

| Decision | Honoured |
|----------|----------|
| §12.1 Class binding location → standalone module | ✓ |
| §12.2 Token budget → per-source caps | ✓ (3×250 / 3×500 / 3×800 by phase) |
| §12.3 Fanout k values → 3, 3, 5/20 | ✓ (`FANOUT_K_*` constants) |
| §12.4 Mistakes ranking → pure recency | ✓ (`ORDER BY created_at DESC`) |
| §12.5 JA course-code regex → operator-curated seed list | ✓ (`COURSE_CODE_PATTERNS_JA` + `KANJI_COURSE_NAMES_JA`) |
| §12.6 Defer assignment_embedding / class_chunks | ✓ |
| §12.7 Defer audit_log enum, ship inline strings | ✓ (added to `EmailAuditAction` union) |
| §12.8 Ship to all 10 α, no A/B framework | ✓ |
| §12.9 Ship "How your agent thinks" route | ✓ (`/app/settings/how-your-agent-thinks`) |
| §12.10 Calendar live both phases | ✓ (`fanoutForInbox` calls `fetchUpcomingEvents` + `fetchUpcomingTasks` at both classify/draft) |
| §12.11 Embed reuse | ✓ (`emailEmbeddings.embedding` joined into the fanout query, no fresh embed per L2) |

---

## 4. Verification log

### Class binding accuracy spot-check (EN + JA fixtures)

11 unit tests in `tests/class-binding-structured.test.ts` cover:

- EN code match (`CSC108 — Assignment 2 reminder` → cls-1 via subject_code)
- Word-boundary safety (`DISCSCIENCE colloquium` does NOT match `CSC`)
- Class-name substring (`Linear Algebra office hours moved` → cls-1
  via subject_name)
- JA kanji-name match (`【線形代数】レポート提出のお知らせ` → cls-1)
- UTAS-style 8-digit code (`【21130200】試験範囲のお知らせ` → cls-1)
- Sender professor binding (sender role gating + name-substring lookup)
- 〇〇先生 honorific (Body `田中先生、レポートの件で…` → cls-1)
- Method precedence (subject_code wins over sender_professor when both
  fire on different classes)
- MIN_CONFIDENCE fall-through to `none`

Result: 11/11 pass. Live α dogfood is the next confidence step
(operator-tuned regex + production-shaped data).

### Fanout latency target (p50 <50ms / p99 <200ms excl. calendar)

Not measurable on stub data — admin page surfaces the per-source means
once production traffic accumulates. Source-level instrumentation in
place: `Sentry.startSpan` wraps every fanout call with
`op: "db.query"` and per-source spans inside `timed()`.
`email_fanout_completed.detail.timings_ms` carries the same numbers
for SQL-side analysis.

### ThinkingBar typed pills across 4 source types

`components/agent/thinking-bar.tsx:SourcePill` switches on
`source.type` and emits a styled pill per variant (mail/amber-alert/
violet-book/sky-calendar). Authentication boundary blocked end-to-end
visual verification in the dev server, but the dev server compiled and
served the protected routes (200 → redirect-to-login) without errors;
typecheck and Sentry-instrumented spans pass.

### "How your agent thinks" route renders last N drafts

`/app/settings/how-your-agent-thinks/page.tsx` queries
`agent_drafts` joined to `inbox_items`, ORDER BY created_at DESC LIMIT
10. Renders the same `<ThinkingBar />` + `<ReasoningPanel />` pair
the inbox detail uses, plus a sender / action / auto-sent badge
header. Linked from `/app/settings`. Read-only.

### Tasks as 6th sidebar item with `g t` chord

- `NAV_ITEM_KEYS` now 6 entries with `tasks` last (locked decision
  revised 2026-04-25).
- `NAV_HREFS.tasks` → `/app/tasks` (already created by PR #40 / JP α
  readiness).
- `NAV_SHORTCUTS.tasks` → `t` (no collision with existing
  `i/h/c/l/a`).
- Icon: `ListChecks` from lucide-react.
- `tests/sidebar-keyboard-nav.test.ts` updated to assert the 6-item
  rail and `g t` chord.

### Test suite count

| Pre-PR1 (origin/main) | Post-PR5 |
|-----------------------|----------|
| 444 tests across 72 files | 461 tests across 73 files |

Net +17 tests, +1 file. All net-new tests pass. Three pre-existing
failures on `main` (`tests/context.test.ts` "active assignments" rot
from PR #40's tasks rename, and a flaky pair in
`tests/dogfood-metrics.test.ts` that passes in isolation but fails
under full-suite scheduling) are unrelated to this work unit and
left for a separate cleanup pass.

---

## 5. Deviations from scoping doc

- **`buildProvenance` includes the calendar source as well as
  mistakes/syllabus/email.** The scoping doc §6.2 listed `calendar` as
  a discriminated-union variant; `buildProvenance` now actually emits
  one source-pill per calendar item (event/task/assignment) so the
  ThinkingBar can render them. Reason: glass-box parity — without
  pills the calendar block is invisible to the user even though it
  shaped the draft.
- **Steadii assignments fan out as a third calendar flavour**, not as
  a separate fanout source. Reason: scoping-doc §2.3 framed calendar
  as one source; Addition B in the work-unit brief said "single
  retrieval pipeline." Folding all three (Google events / Google
  Tasks / Steadii assignments) under one calendar block matches that
  intent and keeps the prompt structure stable.
- **Medium-tier drafts get fanout provenance too.** Scoping §6.1
  scoped provenance to deep-pass (`agent_drafts.retrievalProvenance`
  was set only when `deep` was non-null). PR 4 builds the same shape
  from the draft-phase fanout for medium-tier rows. Reason: the
  inbox-detail UI now renders pills uniformly across tiers, and
  medium-tier drafts ARE grounded in fanout context — leaving them
  pill-less would be a UX regression.
- **Calendar "next D days" header in the prompt now reads
  `(next days, N items)` instead of `(next 7 days)`.** Reason: the
  fanout's calendar source can include events + tasks + Steadii
  assignments, each with their own date range; a single days-suffix
  was misleading.
- **`CalendarAssignment` projects to `CalendarTask` for rendering
  via `assignmentAsTask` instead of fully forking the UI.** The TYPE
  union in `lib/calendar/events.ts` is properly widened
  (`CalendarEvent | CalendarTask | CalendarAssignment`) per spec, but
  the boundary projection means the existing month/week/day/timegrid
  components don't need to handle a new variant. Trade-off: callers
  that want assignment-flavoured fields (`status`, `priority`,
  `classId`) read them from the `items` array directly, not the
  rendered task.

---

## 6. Open questions for the next work unit (Phase 7 step 3)

These surfaced during W1 implementation; not in scope for W1:

1. **Mistakes pure-recency ranking** — §12.4 ships pure recency with a
  caveat to switch to similarity if α observation shows topical-
  relevance gap. The eval signal is in place
  (`fanoutCounts.mistakes` + per-source citation parsing); the policy
  switch itself is one constant flip in `fanout.ts:loadMistakesByClass`.
2. **`assignment_embedding` / `class_chunks`** — deferred per §12.6.
  Re-evaluate when class-binding precision drops. The vector-binding
  method already gets class-level signal by aggregating over chunks.
3. **`audit_log.resourceType` enum** — deferred per §12.7. PR 1 added
  the new strings inline; the typed enum + writer-side
  `assertAuditResourceType()` helper are a separate cleanup PR.
4. **Mistake-chunk delete-then-insert optimization** — flagged in
  §12.11. Fine at α; revisit when write rates climb.
5. **Per-decision feedback in "How your agent thinks"** — v1 is
  read-only. A "this binding was wrong" / "this draft helped" button
  would close the loop on observation → tuning.
6. **PDF/image OCR notes abstraction** — Phase 7 step 3, the explicit
  next work unit. Mistake chunks today come from the user's typed
  body markdown only.

---

## 7. What's NOT in this work unit (per the brief)

Verbatim from the work-unit brief, NOT touched:

- Phase 7 step 3 (PDF/image OCR notes abstraction).
- Notion export.
- LMS integrations (Canvas, Brightspace, manaba, WebClass, UTAS).
- Apple iCloud Calendar via CalDAV.
- iOS share extension.
- Apple Reminders / MS To Do / Todoist / Asana.
- A/B framework infrastructure.

End of report.
