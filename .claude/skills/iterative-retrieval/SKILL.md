---
name: iterative-retrieval
description: Use when spawning a subagent (Explore, general-purpose, Plan) to investigate the codebase for an open-ended question — "where is X handled?", "how does Y flow across files?", "what already exists for Z?". Replaces one-shot subagent calls with a max-3-cycle DISPATCH → EVALUATE → REFINE loop so context stays small + relevant. Sourced from ECC's iterative-retrieval pattern, adapted for Steadii.
---

# Iterative Retrieval (for subagent context refinement)

When the answer to a question lives across multiple files and you can't predict where, **don't fire a single broad subagent query and accept whatever comes back.** Iterate.

## The four phases

| Phase | What you do | Stop condition |
|---|---|---|
| **DISPATCH** | Issue a broad query with high-level intent + keywords + exclusions. Use `Explore` for code lookup; `general-purpose` for multi-step investigation. | Always run once. |
| **EVALUATE** | Score each returned file 0–1 for relevance: **0.8–1.0** directly implements the target; **0.5–0.7** related patterns/types; **0.2–0.4** tangential; **<0.2** exclude from future searches. Document what's missing. | Always run after DISPATCH. |
| **REFINE** | Re-query with: (i) new terminology the first cycle revealed, (ii) explicit exclusions for low-relevance dirs, (iii) targeted searches for the named gaps. | Skip if cycle 1 already has ≥2 high-relevance files AND no gaps. |
| **LOOP** | Repeat at most 3 cycles total. | Stop when high-relevance files cover the question, OR cycle 3 hits. |

## When to use

- Spawning a subagent for an open-ended codebase question
- Pre-PR exploration: "what's the existing pattern for X?"
- Triage: "where does failure mode Y get raised?"
- Verification: "what calls function Z?"

## When NOT to use

- Path is already known → use `Read` directly
- Keyword is unique → one-shot `grep` via `Bash` (no subagent needed)
- The user asked a closed question with a single file's worth of context

## Worked example (Steadii-flavoured)

Question: *"Where does the agent decide to call `infer_sender_norms`, and which prompt rule gates it?"*

**Cycle 1 — DISPATCH** (broad):
```
Explore with breadth="medium":
  - grep for `infer_sender_norms` symbol
  - grep for "infer.sender" in prompts
  - find tool registration entries
```
Returns: `lib/agent/tools/infer-sender-norms.ts`, `lib/agent/prompts/main.ts` (multiple hits).

**EVALUATE**:
- `lib/agent/tools/infer-sender-norms.ts` — **0.9**, defines the tool
- `lib/agent/prompts/main.ts` — **0.7**, prompt rule mentions it but file is 365 lines, exact rule location unclear
- Gap: which specific MUST-rule mandates the call?

**Cycle 2 — REFINE**:
```
Explore with breadth="quick":
  - grep for "infer_sender_norms" inside lib/agent/prompts/main.ts
    with surrounding 20 lines of context
```
Returns: MUST-rule 3b in EMAIL REPLY WORKFLOW + COUNTER-PROPOSAL PATTERN rule 3b.

**EVALUATE**: Both locations are 0.95 relevance. Question fully answered. STOP.

3 cycles weren't needed; 2 sufficed. The first broad pass gave the *what*, the refined pass gave the *where in the file*.

## Output discipline (when reporting back)

After the loop, report:
1. **Conclusion** in 1–2 sentences
2. **High-relevance findings** with `file_path:line` references
3. **Gaps left** (if cycle 3 still missed something) — flag explicitly, don't pretend to know

## Why this matters for Steadii

Steadii has a moderately complex `lib/agent/` tree (prompts, tools, orchestrator, self-critique, scenarios). One-shot subagent queries have repeatedly:
- Found *some* of the answer but missed the gating rule
- Pulled too much context (the entire `main.ts` is 365 lines) when only a section was needed
- Failed silently when the right grep term wasn't in the first query

Iterative refinement directly addresses each: progressive narrowing keeps token spend low, the EVALUATE step forces honest assessment of what was found vs. what's still missing, and the LOOP cap prevents runaway exploration.

## Related

- `Explore` subagent — the primary DISPATCH/REFINE vehicle for code search
- `Plan` subagent — use AFTER iterative-retrieval clarifies the surface, not before
- `general-purpose` subagent — for cycles that need WRITES (rare; usually read-only is enough)
- Source: [affaan-m/ECC `skills/iterative-retrieval/SKILL.md`](https://github.com/affaan-m/ECC/blob/main/skills/iterative-retrieval/SKILL.md)
