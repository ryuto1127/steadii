# Engineer-56 — Bidirectional working-hours norms (sender + user) with soft defaults

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_agent_failure_modes.md` — full taxonomy
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md` — secretary-not-ChatGPT pitch
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_typecheck_before_push.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_sparring_engineer_branch_overlap.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_dogfood_batched_end.md`

Reference shipped patterns:

- `lib/agent/prompts/main.ts` — TIMEZONE RULES, SLOT FEASIBILITY CHECK (engineer-54, rules 0–4), COUNTER-PROPOSAL PATTERN (rules 5–8), PAST PATTERN GROUNDING. This wave REVISES rules 0 and 3.
- `lib/agent/preferences.ts` (engineer-54) — `workingHoursLocal` zod schema
- `lib/agent/serialize-context.ts` (engineer-54) — `USER_WORKING_HOURS` injection
- `lib/agent/tools/save-working-hours.ts` (engineer-54) — write tool
- `lib/agent/email/sender-timezone-heuristic.ts` (engineer-45 / PR #212) — sender TZ inference. New: also infer working hours from same signal.
- `lib/agent/tools/infer-sender-timezone.ts` (engineer-45 / PR #226) — sender-TZ chat tool. New companion: `infer_sender_norms` or extend this tool.
- `tests/agent-evals/scenarios/late-night-slot-pushback.ts` (engineer-54) — counter-proposal fixture. Add a sender-norms-violated variant.

---

## Strategic context — why this wave matters

The 2026-05-13 engineer-54 dogfood worked at the user-side gate (agent recognized 5/20 18:00 JST = Vancouver 2 AM and refused). But the counter-proposal failed at the **sender side**: the agent proposed `JST 6:00–14:00` as the new window. **JST 6 AM is not working hours for the sender either** — Steadii proposed an inconsiderate slot to the Japanese recruiter.

Ryuto's articulation (2026-05-13):

> 普通に基づいて提案し、徐々にユーザーに合わせていく方向でいいと思います。例えば、人間の秘書なら9:00から14:00の範囲でお願いをする返信を作り、同時に私に向こうが朝の9時前だとworking hourではない可能性が高いことを説明します。

Two shifts encoded:

1. **Soft defaults instead of mandatory explicit input** — the agent should NOT require the user to set their working hours up-front. It should reason from norms (Japanese business meetings = 9–18 JST default, North American students = 9 AM–10 PM PT default) and refine as the user reveals their actual pattern through accepted slots.

2. **Bidirectional consideration** — counter-proposals must respect the SENDER'S likely working hours too, not just the user's. The agent must explain its sender-side reasoning to the user so trust is preserved.

This is the "secretary" half of Steadii's pitch. ChatGPT proposes blindly; Steadii thinks like a person who actually understands business norms.

---

## Scope — build in order

### Part 1 — Remove the hard ASK gate; replace with soft default

Today (post-engineer-54) `lib/agent/prompts/main.ts` SLOT FEASIBILITY CHECK rule 0 says:

> **GATE — if USER_WORKING_HOURS is `(not set)`, STOP and ASK.** … you MUST NOT emit a draft body in this turn.

Replace this with:

> **DEFAULT — if `USER_WORKING_HOURS` is `(not set)`, USE NORMS.** Treat the user's likely available window as their profile-TZ default norm (in `users.timezone`):
> - North American users (America/Vancouver, America/Los_Angeles, America/New_York, America/Toronto, etc.) → 09:00–22:00 user-local
> - Japan / East Asia (Asia/Tokyo, Asia/Seoul, Asia/Shanghai) → 08:00–22:00 user-local
> - Europe (Europe/*) → 08:00–21:00 user-local
> - Other / unknown → 09:00–21:00 user-local
>
> Surface the default once when you use it: "あなたの対応時間は仮に 9:00–22:00 PT として進めます。違っていれば教えてください、保存しておきます。" / "Assuming you're available 9 AM – 10 PM Pacific by default. Let me know if your actual hours differ — I can save them."
>
> DO NOT block the draft on this. The user gets a complete draft on the first turn; the working-hours fact is refined over time, not collected up-front.

Move the explicit ASK flow to a SECONDARY path: only ASK when (a) the user explicitly says something like "対応時間を教えておく" / "save my meeting hours", OR (b) the agent observes two contradictory slot acceptances (e.g. user previously took a 14:00 PT meeting and a 21:00 PT meeting on the same proposal — suggests no fixed window, the agent should ask once).

### Part 2 — Sender working-hours norms (new helper + prompt rule)

Add `lib/agent/email/sender-norms.ts` exporting `inferSenderWorkingHours(senderEmail, senderDomain, body?)` → `{ start: "HH:MM", end: "HH:MM", tz: string, confidence: number }`.

Initial heuristic set (no LLM — pure rule-based, like `sender-timezone-heuristic.ts`):

- `.co.jp` / `.ne.jp` / `.or.jp` / Japanese body language → 09:00–18:00 Asia/Tokyo, confidence 0.9
- `.com` / `.org` US business sender (heuristic: `tz: America/*` from sender TZ inference) → 09:00–17:00 sender TZ, confidence 0.7
- University-domain senders (`.edu`, `.ac.jp`, `.ac.uk`) → 09:00–18:00 sender TZ, confidence 0.6 (professor norms wider; "after hours" is often legitimate for academics)
- Government domains (`.gov`, `.go.jp`) → 09:00–17:00 sender TZ, confidence 0.9 (strict)
- Generic / unknown → 09:00–18:00 sender TZ, confidence 0.4 (low — agent SHOULD surface uncertainty in the counter-proposal)

The confidence threshold drives a prompt-level decision:
- ≥ 0.7 → use the norm silently
- 0.4 – 0.7 → use the norm but disclose the assumption ("recruiters in JP usually 9–18 JST, treating this as a default")
- < 0.4 → ask the user OR research (see Part 5)

Add `infer_sender_norms` chat tool wrapping this helper. Schema:
```typescript
{
  name: "infer_sender_norms",
  description: "Infer the sender's likely working hours from their email domain + body language. Use when drafting a counter-proposal so your proposed window respects the sender's day, not just the user's.",
  mutability: "read",
  parameters: {
    senderEmail: string,
    senderDomain: string,
    body: string | null,
  }
}
```

### Part 3 — COUNTER-PROPOSAL PATTERN revision (bidirectional intersection)

Current rule 3 in `main.ts`:

> **MUST propose an alternative WINDOW with CONCRETE SENDER-TZ HOURS** — never vague phrases like "平日の日中". The window MUST contain a HH:MM–HH:MM range in the sender's TZ, derived from USER_WORKING_HOURS converted back via `convert_timezone` …

Replace the derivation step with **bidirectional intersection**:

> 3a. Compute the user's working window in user-local TZ (USER_WORKING_HOURS or norm default per Part 1).
> 3b. Call `infer_sender_norms` for the sender's working window in sender TZ.
> 3c. Convert both to a common TZ via `convert_timezone` (sender TZ recommended — the counter-proposal will display in sender TZ for the recipient).
> 3d. **The proposed window is the INTERSECTION of (a) and (b).** Empty intersection = no overlap → say so plainly: "残念ながら、お互いの対応可能時間に重なりがないようです — もし可能でしたら、土日や時間外でのご対応もご相談できますでしょうか。" / "Looks like our working windows don't overlap on weekdays — would weekend / after-hours work on your end be an option?"
> 3e. Disclose the sender-side reasoning to the user (separate sentence outside the draft code block): "向こう側の業務時間を JST 9:00–18:00 と推測したので、その範囲で重なる時間帯を提案しました。" / "I assumed the sender's working hours are around 9 AM – 6 PM JST, so the window I proposed respects both."

**New failure mode**: `SENDER_NORMS_IGNORED` — agent proposes a window that lies inside the user's working hours but outside the sender's (e.g. JST 6:00 from a JP recruiter). Add to taxonomy.

### Part 4 — Past-pattern refinement (silent learning)

Current PAST PATTERN GROUNDING (engineer-54) reads prior reply bodies and references the pattern in the draft. Extend with silent refinement of the user's working window:

- When the user accepts a slot (gmail_send fires on a reply that picked a specific slot), the agent SHOULD record the accepted local-TZ time as a data point for the user's working-window inference (currently nothing stores this).
- After ≥ 3 accepted slots, infer the empirical working window as `[min(accepted_starts), max(accepted_starts)]` with a tolerance buffer.
- This empirical window OVERRIDES the norm default (Part 1) but does NOT override an explicit `workingHoursLocal` set by the user.

Storage: extend `users.preferences` JSONB with `inferredWorkingHoursLocal?: { start, end, sampleCount, lastUpdatedAt }`. Migration not needed (JSONB). New cron OR inline post-`gmail_send` hook to update the inference.

The inference is intentionally simple — no clustering, no time-of-week segmentation. α scale doesn't need ML.

### Part 5 — Sender business-hours research (DEFERRED — engineer-57)

Ryuto's stretch case: "令和トラベルの電話対応時刻や、一日のスケジュールのサンプルなどを調べて、その会社は何時から働き始めることが多いのかを調べます".

This requires web search / scraping of the sender's contact page. Out of scope for engineer-56 because:
- Heuristic in Part 2 covers 80%+ of cases at α
- Web search adds cost + new tool surface (search_web tool would need to be vetted)
- We can ship Parts 1–4 standalone and validate sender-norms inference quality before adding research

Mention the future tool in the new failure-mode entry so the taxonomy points at it.

### Part 6 — Eval scenario revisions + new scenarios

Update `tests/agent-evals/scenarios/late-night-slot-pushback.ts`:
- The expected counter-proposal window must INTERSECT user norms AND `infer_sender_norms` output for `recruiter@reiwa-travel.co.jp` (= JST 09:00–18:00). User-side norm for America/Vancouver = 09:00–22:00 PT = JST 02:00–15:00 next-day. Intersection = JST 09:00–15:00. Add a custom assertion: response's proposed JST window does NOT include any hour < 09:00 OR > 18:00 JST.
- New assertion: response mentions sender-side reasoning ("向こう側" / "the sender's side" / "their working hours") at least once.

New scenario `tests/agent-evals/scenarios/sender-norms-respected.ts`:
- Fixture: same 令和トラベル round-2 setup, but workingHoursLocal explicitly set to 06:00–23:00 PT (so user CAN take a 6 AM PT meeting). The agent's counter-proposal MUST STILL respect sender norms — i.e. not propose JST 23:00 or 02:00 even though the user is technically available then.
- Failure mode covered: `SENDER_NORMS_IGNORED`.

New scenario `tests/agent-evals/scenarios/empty-intersection-window.ts`:
- Fixture: sender in Asia/Tokyo, user in Pacific/Auckland (NZST = JST+3). User working 09:00–22:00 NZST = JST 06:00–19:00. Sender working 09:00–18:00 JST. Intersection = JST 09:00–18:00 (still non-empty).
- For a truly empty intersection, use a fixture with user in Europe/Berlin (CEST) + sender in JST: berlin 09:00–22:00 = JST 16:00 next-day–05:00 next-day → intersection with JST 09:00–18:00 is JST 16:00–18:00 (still 2 hours). To force truly empty: berlin 09:00–16:00 = JST 16:00–23:00 vs sender JST 09:00–15:00 → no overlap. Then agent should say "no overlap, can we go weekend / out of hours?" — assert this language.

### Part 7 — Failure-mode taxonomy + memory

Add to `feedback_agent_failure_modes.md`:

```markdown
### `SENDER_NORMS_IGNORED`

**Shape:** Agent proposes a counter-window that respects the user's working hours but lies outside the sender's likely working hours — e.g. proposing JST 06:00 to a Japanese recruiter (whose working day starts at 09:00). Inconsiderate / reads as rude.

**Root cause:** Pre-engineer-56 the counter-proposal only checked USER_WORKING_HOURS; the SLOT FEASIBILITY CHECK was unidirectional. Sender norms were not modeled.

**Fix:** `infer_sender_norms` tool + COUNTER-PROPOSAL PATTERN rule 3d "bidirectional intersection" (engineer-56). Eval scenarios `sender-norms-respected.ts` + revised `late-night-slot-pushback.ts`.
```

Update existing `LATE_NIGHT_SLOT_ACCEPTED_BLINDLY` entry to note the soft-default change in engineer-56 (`workingHoursLocal` no longer mandatory; norms default kicks in).

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-56
```

IMPORTANT before checkout: `git status`. See `feedback_sparring_engineer_branch_overlap.md`.

## Verification

- `pnpm typecheck` clean
- `pnpm test` full suite green, +~15 new tests (sender-norms heuristic, preference schema extension for `inferredWorkingHoursLocal`, intersection math)
- `pnpm eval:agent` — every scenario passes; cost ~$0.025/run
- Manual: re-run the 令和トラベル round-2 dogfood without setting working hours first. Expected: agent uses 09:00–22:00 PT norm silently, proposes JST 9:00–15:00 (NOT 6:00–14:00), explicitly explains it considered the sender's likely 9–18 JST window.

## Out of scope

- Web-search sender research (engineer-57)
- Day-of-week / weekday-vs-weekend variability — α users mostly have flat weekday-only schedules; defer
- ML clustering of accepted-slot patterns — simple min/max with tolerance is enough for α
- Cultural overrides beyond JP / NA / Europe — add more region buckets if α expands beyond these
- Removal of `save_working_hours` tool — keep it; the user can still volunteer their hours, the agent just no longer blocks on the absence

## Memory entries to update on completion

- `feedback_agent_failure_modes.md` — new `SENDER_NORMS_IGNORED` + update to `LATE_NIGHT_SLOT_ACCEPTED_BLINDLY`
- Reference scenarios in each entry per the convention engineer-52 introduced
