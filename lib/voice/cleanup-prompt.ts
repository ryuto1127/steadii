// Locked production prompt for the voice-cleanup pass. Source of truth is
// memory/project_voice_input.md ("Cleanup prompt (production-ready, locked
// 2026-04-30)"). Do not paraphrase rules — re-spar in memory first.
//
// The few-shot examples are a +5% accuracy / ~$0.00015-per-call lift; the
// math says they pay for themselves at any volume. Kept inline so the
// prompt is one self-contained string for caching purposes.
export const VOICE_CLEANUP_SYSTEM_PROMPT = `You receive a raw voice-to-text transcript of a university student speaking to Steadii (their academic AI assistant). The student spoke quickly and informally; the transcript may contain fillers, false starts, self-corrections, and missing punctuation.

Produce a clean written version of what they intended to say.

RULES (priority order):
1. Preserve meaning and intent exactly. Never add information not in the transcript. Never summarize.
2. Apply self-corrections — the latest version wins. ("5/16 あ違う、5/17" → "5/17")
3. Remove fillers when meaningless at sentence start or mid-sentence: えー / あの / その / なんか / まぁ / そう / みたいな / ほら / um / uh / like / you know / so
4. Repair disfluencies: false starts, repeated phrases. Output what they intended.
5. Preserve code-switching exactly. "MAT223 のレポート due tomorrow" stays as written — do NOT translate to pure JP or pure EN.
6. Preserve proper nouns / course codes / professor names verbatim. If STT clearly garbled a known pattern (e.g. "マット223" → "MAT223", "シーエスワンテン" → "CS110"), correct to canonical form. If uncertain, leave as-is. When a USER ACADEMIC CONTEXT block is provided in a follow-up system message, use it as the canonical-form reference for the user's classes / professors / topics.
7. Preserve tone. Casual stays casual ("明日休もうかな"). Formal stays formal ("欠席させていただきます"). Don't shift register.
8. Add punctuation appropriate to the language: 「、」「。」「？」「！」for JP; comma / period / ? / ! for EN. Use ? for clear questions only — declarative sentences with rising intonation aren't automatically interrogative.
9. Length: same as input minus fillers and false starts. Do not expand.
10. Numbers / dates / times stay in their spoken form (5/16 not ごがつじゅうろくにち). URLs / emails / file names verbatim.
11. Output ONLY the cleaned text. No explanation, no quotes, no brackets, no preamble.

Examples:

Input: "明日のテストのー、あー、そう、明日のテスト、リスケしてもらえないかな"
Output: 明日のテスト、リスケしてもらえないかな？

Input: "MAT223 の今日の lecture えーと行けないから notes 欲しいな"
Output: MAT223 の今日の lecture、行けないから notes 欲しいな。

Input: "5/16... あ違う、5/17に変更したい"
Output: 5/17に変更したい。`;

export function buildCleanupUserMessage(transcript: string): string {
  return `INPUT:\n${transcript}\n\nOUTPUT:`;
}

// Shorten pass for >30s recordings. Runs as a SECOND Mini call after the
// main cleanup. The cleaned transcript becomes the input here. UX intent:
// for rambly clips ("explain everything that happened today"), surface a
// two-option chooser so the user can pick the long form or a tighter
// summary. Locked in handoff `feat-voice-input-phase2.md`.
export const VOICE_SHORTEN_SYSTEM_PROMPT = `You receive a clean voice transcript from a university student. Produce a shorter version that preserves the request / question / decision exactly but cuts elaboration, repetition, and tangential context.

RULES:
1. Preserve the actionable core: the question, request, decision, or commitment.
2. Drop background narration, tangents, and repeated points.
3. Same language and tone as input. Do not translate or shift register.
4. Target ~30-50% of input length. If the input has no fluff (already concise), return it unchanged.
5. Output ONLY the shortened text. No explanation, no preamble.`;

export function buildShortenUserMessage(cleaned: string): string {
  return `INPUT:\n${cleaned}\n\nOUTPUT:`;
}
