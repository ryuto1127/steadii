# Engineer-35 — Fanout retrieval quality (drop unrelated sources)

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`

Reference shipped patterns:

- `lib/agent/email/fanout.ts` — multi-source retrieval (mistakes / syllabus / emails / calendar). Existing `SIM_FLOOR = 0.55` for syllabus only.
- `lib/agent/email/classify-deep.ts` — L2 deep-pass that consumes the fanout output and writes `retrieval_provenance` per draft.
- `components/agent/draft-details-panel.tsx` — user-facing surface (PR #167) that displays the `provenance.sources` pills the user cares about.

---

## Strategic context

Ryuto report 2026-05-06: a recruiting interview email (令和トラベル / 明日のグループディスカッション選考のご案内) surfaced `syllabus-1 64%` in the draft details panel. The email has nothing to do with any class — but the syllabus chunk passed the existing 0.55 similarity threshold.

This is a **retrieval quality bug**: the fanout's vector search returns chunks above threshold even when the email has no class binding. For non-academic emails (recruiting, billing, OTPs, vendor support), syllabus retrieval is irrelevant and clutters reasoning.

The bug is two layered:

1. **Threshold too low.** 0.55 is OpenAI cosine similarity — at this level, 0.55-0.65 hits often catch only topical overlap, not semantic relevance to the email.
2. **No class-binding gate.** `inbox_items.classBindingMethod` already encodes whether the email is class-bound. When `method === "none"`, the email is NOT class-related — but fanout still queries `loadVectorSyllabusChunks` (vector-only across all syllabus chunks).

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected: PR #168 (L2 reasoning locale) at commit `c02daee` or any sparring inline after this handoff doc lands. If main is behind, **STOP**.

Branch: `engineer-35-retrieval-quality`. Don't push without Ryuto's explicit authorization.

---

## What changes

### 1. Tighten syllabus threshold + class-bind gate

In `lib/agent/email/fanout.ts`, the syllabus retrieval block (around line 221):

- Move `SIM_FLOOR` from a single 0.55 constant to per-source: `SYLLABUS_SIM_FLOOR_BOUND = 0.55` (when class-bound), `SYLLABUS_SIM_FLOOR_UNBOUND = 0.78` (when not class-bound).
- When `classBindingMethod === "none"` AND there's no clear academic signal in the email (subject keywords like 「シラバス」「課題」「試験」「midterm」「assignment」「lecture」etc.), SKIP syllabus retrieval entirely — vector similarity at any threshold is too lossy when the input is structurally non-academic (recruiting / billing / OTP / vendor support).
- Add a small `EMAIL_LIKELY_ACADEMIC` predicate that takes the subject + snippet and returns boolean. Curated keyword list, EN + JA. False-positives go through (better to surface a syllabus chunk than miss a real class email).

### 2. Same gate for mistakes

`lib/agent/email/fanout.ts` mistakes block uses `loadVectorMistakes` for unbound emails. Apply the same `EMAIL_LIKELY_ACADEMIC` gate so a recruiting email doesn't pull in unrelated past mistake notes.

### 3. Provenance audit

Add a one-shot `tests/fanout-quality-audit.test.ts` that:
- Constructs 5 representative non-academic emails (recruiting / billing / OTP / vendor support / shipping notification)
- Runs `fanoutForInbox` against each
- Asserts `result.syllabusChunks` and `result.mistakes` are EMPTY for each
- (No assertion on calendar — calendar context is fine for any email since events are concrete and time-bound)

This is a regression-prevention test: future threshold tweaks should keep the non-academic-no-syllabus invariant.

---

## Files

- `lib/agent/email/fanout.ts` — split SIM_FLOOR, add `EMAIL_LIKELY_ACADEMIC` predicate, gate syllabus + mistakes
- `lib/agent/email/fanout-prompt.ts` (if exists) — possibly update the prompt block to clarify "no syllabus retrieved" message
- `tests/fanout-quality-audit.test.ts` (NEW) — 5-case regression suite

No schema changes. No migration.

---

## Tests

- New test file `fanout-quality-audit.test.ts` (~5-7 cases) covering non-academic email categories
- Existing fanout tests must keep passing
- Existing classify-deep tests should be unaffected (the input shape doesn't change)

Aim: existing 976 stay green, +5-7 new → **981+** total.

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA. Required:

- `/app/inbox/[id]` for a recruiting-type email — expand "Steadii の判断詳細" — confirm NO syllabus pill in the sources list (BEFORE: `syllabus-1 64%`; AFTER: only email + calendar pills if any)
- `/app/inbox/[id]` for a class-related email (subject contains "課題" or class code) — expand details — confirm syllabus pills DO appear (regression check that the gate doesn't over-block)
- Compare provenance via Sentry: `fanoutCounts.syllabus` distribution should drop for non-academic ingest cycles

---

## Out of scope

- Re-running L2 over already-classified items to refresh provenance. The post-fix takes effect for new classifications only; the reclassify-all admin action (PR #161) re-runs L1 not L2, so it doesn't refresh provenance either. A follow-up "regenerate-draft-with-fresh-fanout" admin action could ship if Ryuto wants legacy provenance cleaned up.
- Threshold tuning per source-type beyond syllabus + mistakes (calendar / emails are fine as-is).
- Embedding model upgrade (currently text-embedding-3-small at 0.55-0.78 threshold range; switching to a stronger model is separate cycle).

---

## Final report (per AGENTS.md §12)

- Branch / PR: `engineer-35-retrieval-quality`
- New tests: `fanout-quality-audit.test.ts` with case count
- Per-source threshold values + EMAIL_LIKELY_ACADEMIC keyword list
- Screenshot pairs of recruiting-email vs class-email in `/app/inbox/[id]`
- **Memory entries to update**: `project_decisions.md` if any new locked threshold; `sparring_session_state.md` updated by sparring after merge.
