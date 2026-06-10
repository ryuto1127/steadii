# docs/knowledge — cross-session engineering memory

Persistent, **verified** engineering knowledge about this codebase and its
environment, so future sessions (sparring, engineer, evaluator — and any
human) use established findings instead of re-deriving them.

## The one rule that matters

**Verified facts and unverified hypotheses never share a file.**

- [`LEARNINGS.md`](./LEARNINGS.md) — verified facts ONLY. Every entry carries
  evidence (a PR, an incident, a reproduced command) and a verification date.
- [`HYPOTHESES.md`](./HYPOTHESES.md) — unverified beliefs ONLY. Every entry
  carries what made us suspect it and the concrete check that would settle it.

If you are about to rely on something from `HYPOTHESES.md`, you must verify it
first — and then move it (that's a promotion, see below). If you are about to
write something into `LEARNINGS.md` you haven't verified, stop: it goes in
`HYPOTHESES.md`. There is no third state and no "probably verified."

The file-level split is deliberate: a future session skimming under time
pressure cannot mistake a hunch for a law, because the filename is the
epistemic status.

## What belongs here (and what doesn't)

| Content | Home |
|---|---|
| Codebase traps, tooling quirks, environment bootstrap facts | `LEARNINGS.md` |
| Observed external-service behavior that differs from its docs (Gmail, QStash, Neon, Vercel, Stripe, MS Graph…) | `LEARNINGS.md` |
| Approaches we tried and rejected, with the reason (prevents re-trying) | `LEARNINGS.md` (Failed approaches section) |
| Suspicions, single observations, untested scale ceilings | `HYPOTHESES.md` |
| Product / pricing / process decisions | private memory (`~/.claude/projects/-Users-ryuto-Documents-steadii/memory/`) — see AGENTS.md header |
| Agent-behavior failure modes (prompt/LLM output bugs) | `feedback_agent_failure_modes.md` in private memory (it predates this dir and contains incident material that must stay off the public repo; reference entries by SHOUTY_NAME) |
| How-to conventions (stack, dir layout, MUST-rules) | `AGENTS.md` |

Ownership rule (extends AGENTS.md's "memory wins"): **engineering facts are
canonical here; decisions/process/identity are canonical in private memory.**
Don't duplicate a fact in both places — link instead.

**This directory is on a public repo.** AGENTS.md §7a applies in full: shapes
and rules only, never real senders/subjects/names/dates from real inboxes.
CI's PII scan covers these files like any other committed artifact.

## Entry format

`LEARNINGS.md`:

```markdown
### kebab-id — one-line rule
- **Rule**: the distilled, future-applicable statement (generalize past the incident).
- **Evidence**: how it was verified — PR #N / incident date / command + observed output.
- **Verified**: YYYY-MM-DD, context (versions, env) if relevant.
- **Re-check if**: the decay trigger — what change would invalidate this.
```

`HYPOTHESES.md`:

```markdown
### kebab-id — one-line suspicion
- **Hypothesis**: the belief, stated falsifiably.
- **Basis**: the observation that prompted it (an observation is not proof).
- **To verify**: the concrete check that would settle it.
- **Logged**: YYYY-MM-DD · **Review by**: date or trigger event.
```

The **Rule** line is mandatory and must be distilled: "PR #312 broke because
the journal was missing an entry" is an incident report; "new Drizzle SQL
files are invisible to the migrator until `_journal.json` has the entry" is a
rule. Write the rule; cite the incident as evidence.

## When to write (the trigger list)

Add or update an entry when, during any session:

1. **Reality surprised you** — expectation ≠ observed behavior, and you spent
   time figuring out why.
2. **You re-derived something** — if you had to investigate it twice, the
   second time pays the write-down tax.
3. **An external service behaved contrary to its documentation.**
4. **An approach failed for a non-obvious reason** — record it so nobody
   re-walks the dead end.
5. **A guess got confirmed or refuted** — promote or retire the hypothesis.

Before recording in `LEARNINGS.md`, verify: reproduce it, or point at the
artifact that proves it (CI run, PR diff, command output). "It seems like" →
`HYPOTHESES.md`.

## Lifecycle

- **Promote** (hypothesis → learning): move the entry, replace **Basis** with
  **Evidence**, stamp **Verified**. The verification belongs in the same PR /
  report that does the move.
- **Retire**: refuted hypotheses are deleted with a one-line tombstone in the
  PR description (not in the file — the file holds live beliefs only).
  Learnings invalidated by change (dependency upgrades, infra moves) are
  deleted or rewritten — a stale law is worse than no law.
- **Curate**: sparring is the curator. At PR review time (same moment as the
  PII review), sparring demotes any "learning" without evidence to
  `HYPOTHESES.md` and prunes narrative bloat. Engineers may add entries in
  their PRs (hypotheses freely; learnings only when the evidence is in the
  same PR).

## How sessions use this (the habit)

- **Read before investigating.** Both files are deliberately small — read them
  (or grep for the subsystem/tool/error string) before starting any
  non-trivial investigation. Engineer and evaluator have this as a pipeline
  step in their agent definitions; sparring reaches it via MEMORY.md.
- **Cite what you used.** When an entry saved you work or shaped a decision,
  name its kebab-id in the PR body. This is how we know the system is alive
  (see rot signs below).
- **Report candidates.** Engineer/evaluator reports include a "Candidate
  learnings" section (or "none") — same contract as AGENTS.md §12's memory
  deltas.

## Rot signs — when to redesign this

The system is failing if you observe:

1. **`HYPOTHESES.md` only grows** — nothing promoted or retired for ~a month
   means it's a write-only graveyard, not a verification queue.
2. **Entries without evidence in `LEARNINGS.md`** — the epistemic discipline
   broke; demote them immediately and find out how they got in.
3. **A documented trap bites again** — the read habit broke. Check whether
   recent PR bodies cite any kebab-ids; if none do, agents aren't reading.
4. **Narratives instead of rules** — entries that read like session diaries.
   Distill or delete.
5. **Either file exceeds ~300 lines** — reading cost now competes with
   re-derivation cost. Split by category, archive the stale tail.
6. **The same fact diverges between here and private memory** — the ownership
   rule broke; re-link.
7. **Stale "Verified" dates on external-service entries (> ~6 months)** being
   relied on without re-checking — decay triggers are being ignored.
