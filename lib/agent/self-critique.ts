// 2026-05-12 (sparring inline post-engineer-51) — output self-critique
// pass for the chat orchestrator. Catches PLACEHOLDER_LEAK failure
// mode (see memory/feedback_agent_failure_modes.md) by running a
// deterministic regex check against the agent's final text. When a
// leak is detected, the orchestrator pushes a corrective system
// message and runs ONE more tool-loop iteration so the agent can
// re-fetch the missing data and emit grounded output.
//
// Regex-only first pass (fast, free, deterministic). LLM-judge
// version could come later if too many leaks slip past — but at α
// scale the explicit forbidden tokens cover the common shapes.
//
// Scope: chat orchestrator only. Agentic L2 has its own forced
// final pass + structured-output JSON schema that already enforces
// non-empty fields.

import { detectDraftBlocks } from "@/lib/chat/draft-detect";

export type PlaceholderLeakDetection = {
  hasLeak: boolean;
  matched: string[];
};

// Patterns that are NEVER acceptable in a final response. These are
// concrete tokens the agent has no business emitting — they signal
// the agent shipped a template instead of grounded output. Phrases
// like "ご提示いただいた日程" without a date are not in this list
// because regex can't tell whether a date follows.
const FORBIDDEN_TOKENS: Array<{ name: string; pattern: RegExp }> = [
  // Full-width / half-width placeholder bullets common in Japanese
  // letter templates. Single 〇 is sometimes legitimate (used as an
  // adjective ending) so require 2+ in a row.
  { name: "〇〇", pattern: /〇{2,}|○{2,}|◯{2,}/ },

  // Curly-brace placeholder slots: {name}, {date}, {course}, etc.
  // Match {WORD} where WORD is alphanum/JP under 30 chars. Avoid
  // accidentally matching legitimate code in chat ("use the
  // {item.id} property"); single-word identifier-style only.
  {
    name: "{placeholder}",
    pattern:
      /\{[A-Za-z_][A-Za-z0-9_]{0,28}\}|\{[ぁ-んァ-ヶ一-鿿]{1,15}\}/,
  },

  // Square-bracket TBD / ellipsis style.
  { name: "[TBD]/[...]", pattern: /\[(TBD|tbd|未定|\.\.\.|…)\]/ },

  // Time placeholders like xx:xx, XX月XX日, etc.
  { name: "xx:xx", pattern: /\b[xX]{2}:[xX]{2}\b/ },
  { name: "XX月XX日", pattern: /[xX]{2}月[xX]{2}日/ },

  // SUBJECT_LINE_FABRICATED_ON_REPLY (engineer-53). A `件名:` / `Subject:`
  // line at the start of a draft body is wrong for reply context — email
  // clients auto-prefix `Re:` on the parent subject, so a fabricated
  // subject inside the body is dead weight at best and misleading at
  // worst (the agent's invented subject often diverges from the real
  // thread's subject). Conservative match: only fires when the line is
  // at line-start AND followed by `Re:` / `RE:` / `re:` — that pattern
  // is unambiguously a reply-context fabrication. Plain `Subject:` with
  // no `Re:` may be a new-mail draft (out of scope) so we skip those.
  {
    name: "件名 fabricated on reply",
    pattern: /^\s*(件名|Subject)\s*[:：]\s*Re:/im,
  },

  // ACTION_COMMITMENT_VIOLATION trailing variant (engineer-53).
  // Narration of a future fetch/check action that should have happened
  // BEFORE the draft. When this phrase reaches the user it means the
  // agent shipped output AND admitted on-the-record it didn't fetch.
  // The orchestrator's main loop is supposed to invoke any such tool
  // in the SAME turn the agent commits to it; reaching the user with
  // this phrase is a documented failure shape.
  //
  // Detector catches both the masu-form ("〜確認します") and the te-form
  // chain ("〜確認して、〜拾います") because the actual 2026-05-13 dogfood
  // failure used the te-form. Past-tense ("〜確認しました") is excluded
  // by being absent from the alternation — we want fire only on
  // future-intent phrases. Common JA/EN forms only; doesn't try to be
  // exhaustive — false negatives are tolerable since the prompt's
  // MUST-rule 8 catches the rest.
  {
    name: "trailing future action",
    pattern:
      /(メール本文を確認します|メール本文を確認して|本文を確認します|本文を確認して|確認して報告します|チェックして送ります|reviewing the email|let me check the body|let me read the body|i'll check the email body)/i,
  },

  // engineer-54 — LATE_NIGHT_SLOT_ACCEPTED_BLINDLY heuristic. Fires when
  // the response narrates acceptance of a proposed time slot using the
  // common acceptance shape ("ご提示いただいた日程… で参加可能です" /
  // "the proposed slot … works for me") without disclosing the user-
  // local time. The regex is loose by design (false-positive tolerant):
  // a clean draft that DID surface dual-TZ slots can still trigger this
  // if the acceptance prose is phrased generically, but the retry pass
  // re-fetches and re-emits with the SLOT FEASIBILITY CHECK section in
  // play, so the false-positive cost is one extra LLM iteration. The
  // false-negative cost — shipping a 2 AM acceptance to the user — is
  // far worse. The detector pairs with WORKING_HOURS_IGNORED below for
  // the case where slot times ARE shown but no user-TZ counterpart
  // anchors them.
  {
    name: "slot acceptance missing user-local TZ",
    pattern:
      /(ご提示いただいた[日時候]|ご提案いただいた[日時候]|the proposed (slot|time|date)|that proposed (slot|time|date)).{0,200}(参加可能|可能です|問題ありません|問題なく|works for me|sounds good|that works|that'll work|that would work)/i,
  },

  // 2026-05-14 — CONTEXT_LABEL_LEAK. The user-context block uses
  // ALL_CAPS_WITH_UNDERSCORES labels (USER_WORKING_HOURS, USER_NAME,
  // USER_FACTS, USER_TIMEZONE) for the agent's reasoning surface only.
  // Surfacing them verbatim in user-facing prose ("USER_WORKING_HOURS
  // が未設定なので…") reveals scaffolding and reads as a bug. Pattern
  // matches the exact label tokens we currently inject; if a new
  // context label gets added in lib/agent/serialize-context.ts, extend
  // this list at the same time.
  {
    name: "context label leak",
    pattern:
      /\b(USER_WORKING_HOURS|USER_NAME|USER_FACTS|USER_TIMEZONE)\b/,
  },

  // 2026-05-15 sparring — response opens with a conjunction (ただ /
  // でも / それで / However / But / And so) without an establishing
  // sentence first. Violates EMAIL REPLY WORKFLOW MUST-rule 11. User
  // reads fresh and needs context before reasoning. Pattern matches
  // the FIRST line of the response (after optional whitespace).
  {
    name: "response opens with conjunction",
    pattern:
      /^\s*(ただ|でも|それで|しかし|However|But|And so)[、,\s]/,
  },

  // Numeric placeholders like 00:00 in templates (loose — single 00:00
  // could be a real midnight slot, but in concert with other context...
  // — skip for now, too noisy).
];

// engineer-54 — WORKING_HOURS_IGNORED proximity check. Can't be a single
// regex because the rule is "JST time appears AND no user-local TZ
// marker (PT/PDT/PST/user TZ) within 80 chars" — proximity needs
// programmatic logic. Catches the most-violated MUST-rule 7 shape
// (dual-TZ on first mention) that no other detector covers, AND the
// WORKING_HOURS_IGNORED failure mode (draft shows JST slots in spite of
// the user's working hours being known and incompatible with that JST
// time-of-day).
//
// Verified against engineer-53's detector set: no existing dual-TZ
// check, so this doesn't double-count. The LATE_NIGHT detector above
// covers the "acceptance prose, no slot times shown" branch; this one
// covers the "slot times shown JST-only, no user-TZ anchor" branch.
//
// 2026-05-13 refinement: when the response has ESTABLISHED PT context
// elsewhere (e.g. analysis section above the draft uses PT; draft body
// uses JST for the recipient's benefit), proximity check still works
// but failing it would punish a correct shape (analysis-in-user-TZ +
// body-in-sender-TZ). The detector now treats the FIRST JST mention as
// authoritative: if PT is within proximity of the FIRST JST mention OR
// appears anywhere before it, dual-TZ context is established and
// subsequent JST-only mentions inside the draft are fine.
//
// `\b` only binds to ASCII word boundaries; Japanese characters fall
// outside `\w` so we anchor the JA aliases without `\b`. The ASCII
// alternatives keep `\b` for precise matching.
const JST_TOKEN_RE = /(\bJST\b|\bAsia\/Tokyo\b|日本時間)/g;
// User-local TZ markers. Vancouver (the historical α user) is first,
// then we accept all major IANA-TZ abbreviations and English names
// because the detector is a "did the agent disclose ANY non-JST anchor
// for the user" check, not "Vancouver specifically". A response that
// names CET/CEST for a Berlin user has correctly anchored the user's
// side, even if the regex was originally built for Vancouver.
//
// engineer-56 — extended to cover Europe (CET/CEST/BST), North America
// non-Vancouver (ET/EDT/EST/CT/CDT/CST/MT/MDT/MST), Oceania (NZST,
// AEST), and IANA Europe/* names. The detector is intentionally
// permissive: false negatives (let a real leak slip) are cheaper than
// false positives (block a correctly-anchored draft on the retry path).
const USER_LOCAL_TZ_RE = /(\bP(D|S)?T\b|\bE(D|S)?T\b|\bC(D|S)?T\b|\bM(D|S)?T\b|\bA(E|K|D|H)?ST\b|\bCEST?\b|\bBST\b|\bGMT\b|\bNZST\b|\bIST\b|\bAmerica\/[A-Za-z_]+\b|\bEurope\/[A-Za-z_]+\b|\bPacific\b|\bMountain\b|\bEastern\b|\bCentral\b|\bAtlantic\b|バンクーバー時刻|バンクーバー時間|\bVancouver time\b|\bBerlin time\b|\bLondon time\b|\bToronto time\b|\bNew York time\b|\bAuckland time\b)/i;
const WORKING_HOURS_IGNORED_PROXIMITY = 80;

// 2026-05-15 sparring — LOCATION_NOT_DISCLOSED_TO_SENDER detector.
// When the agent emits a draft (inside ```...```) that references
// user-local TZ tokens (PT / PDT / こちらの時間 / 現地時間) WITHOUT a
// location disclosure (海外 / 北米 / Pacific / Vancouver / 在住 /
// currently based in / based out of), the recipient can't frame the
// times — "こちら" is ambiguous, PDT unexplained. MUST-rule 12.
//
// Implementation: extract fenced code-block bodies; for each, check
// for user-TZ tokens vs location-disclosure tokens. Flag if mismatch.
const USER_TZ_IN_DRAFT_RE =
  /(\bP(D|S)?T\b|\bE(D|S)?T\b|\bC(D|S)?T\b|\bM(D|S)?T\b|\bCEST?\b|\bBST\b|\bNZST\b|Pacific Time|Eastern Time|Central Time|Mountain Time|こちらの時間|現地時間|私の時間)/i;
const LOCATION_DISCLOSURE_RE =
  /(海外|北米|アメリカ|カナダ|Pacific\s+(?:Time|Standard|Daylight)|Mountain\s+(?:Time|Standard|Daylight)|Eastern\s+(?:Time|Standard|Daylight)|Central\s+(?:Time|Standard|Daylight)|Vancouver|Toronto|Berlin|London|New York|Auckland|バンクーバー|トロント|ベルリン|ロンドン|ニューヨーク|オークランド|シドニー|在住|住んで|currently based|based in|based out of|住んでおり|海外におり)/i;

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  // 2026-05-19 — accept optional language tag after the opening ```
  // (e.g. ```text, ```yaml). The production agent emits ```text for
  // email drafts; the prior regex required ``` followed by only
  // whitespace before the newline, which missed every draft with a
  // language tag.
  const re = /```[a-zA-Z]*[ \t]*\n([\s\S]*?)\n[ \t]*```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

function detectLocationNotDisclosed(text: string): boolean {
  const blocks = extractCodeBlocks(text);
  for (const block of blocks) {
    // Skip blocks that don't look like an email body — heuristic: must
    // have a greeting marker AND a closing marker (same shape as
    // draft-detect.ts confidence check). Avoids false-positives on
    // code snippets / config blocks that happen to mention PDT.
    const hasGreeting =
      /(お世話になっております|お疲れ様|Dear\s|Hi\s|Hello\s)/.test(block);
    const hasClosing =
      /(よろしくお願いいたします|Best regards|Best,|Sincerely|Regards,)/.test(
        block
      );
    if (!hasGreeting || !hasClosing) continue;
    if (!USER_TZ_IN_DRAFT_RE.test(block)) continue;
    if (LOCATION_DISCLOSURE_RE.test(block)) continue;
    // Draft references user-TZ but lacks a location disclosure → flag.
    return true;
  }
  return false;
}

// 2026-05-19 — three structural violations seen in the post-#281
// production dogfood:
//
// (1) MISSING_INTRO_BEFORE_DRAFT (MUST-rule 11): tool trace finishes,
//     response jumps directly into mid-draft content with no
//     establishing intro for the user.
// (2) DRAFT_OUTSIDE_CODE_BLOCK (MUST-rule 10): the email-draft prose
//     (greeting + closing) is emitted as plain text, not wrapped in a
//     fenced code block — the UI can't attach Send/Edit affordances.
// (3) COUNTER_WINDOW_NOT_DUAL_TZ (COUNTER-PROPOSAL PATTERN rule 3):
//     agent proposes a counter window in only ONE TZ (user-TZ only OR
//     sender-TZ only), so the recipient has to math the offset.
//
// All three are mini-tier variance shapes — the prompt has explicit
// MUSTs for each, but the model drops them under load. Post-hoc
// detectors mirror the placeholder-leak pattern: detect → push a
// corrective system message → one retry iteration.

const DRAFT_GREETING_RE =
  /(お世話になっております|お疲れ様|Dear\s\S|Hi\s\S|Hello\s\S)/;
const DRAFT_CLOSING_RE =
  /(よろしくお願いいたします|よろしくお願いします|Best regards|Best,|Sincerely|Regards,)/;

function detectMissingIntroBeforeDraft(text: string): boolean {
  // Only fires when the response contains a draft-shaped code block —
  // a "no draft" turn (clarification-only, summary, etc.) has no
  // MUST-rule 11 obligation.
  const blocks = extractCodeBlocks(text);
  const hasDraftBlock = blocks.some(
    (b) => DRAFT_GREETING_RE.test(b) && DRAFT_CLOSING_RE.test(b),
  );
  if (!hasDraftBlock) return false;

  // Intro = text BEFORE the first fence opener. Strip whitespace.
  const fenceIdx = text.indexOf("```");
  if (fenceIdx === -1) return false;
  const intro = text.slice(0, fenceIdx).trim();

  // Heuristics for "this is a real intro":
  //   - At least 40 chars of prose (a substantive sentence)
  //   - Contains a sentence-ending punctuation (。 / ! / ?)
  // Failing either = MUST-rule 11 violation.
  if (intro.length < 40) return true;
  if (!/[。!?]/.test(intro)) return true;
  return false;
}

function detectDraftOutsideCodeBlock(text: string): boolean {
  // Strip out all fenced code-block contents — what's left is
  // "outside-block prose". If that prose contains BOTH a greeting AND
  // a closing marker, the agent emitted a draft body inline. MUST-
  // rule 10 requires the draft body to be inside a fence so the UI's
  // Send/Edit affordances can attach.
  const stripped = text.replace(/```[\s\S]*?```/g, "");
  const hasGreeting = DRAFT_GREETING_RE.test(stripped);
  const hasClosing = DRAFT_CLOSING_RE.test(stripped);
  return hasGreeting && hasClosing;
}

// Counter-push language signals the agent is proposing an alternative
// window to the sender (not accepting the original slots). Used to
// gate detector (3) so non-counter replies don't trip it.
const COUNTER_PUSH_RE =
  /(再度ご調整|再度ご提案|別途ご調整|別の時間|別の日程|別途ご提案|もう少し早い時間|もう少し遅い時間|もう少し早めの時間|もう少し遅めの時間|earlier (slot|time|window|hours)|different (slot|time|window)|alternative (slot|time|window|times)|propose .{0,15}different)/i;

// 2026-05-19 — COUNTER_WINDOW_VAGUE: counter-push language fires but the
// proposed window has NO concrete HH:MM (or fewer than 2 distinct HH:MM
// tokens). Catches the post-#282 production dogfood shape: agent wrote
// "平日の日中〜夕方で再度ご調整いただけますと幸いです" — push-back but no
// actionable range. The recipient has no anchor to choose from, and the
// thread gets stuck in another round of vague back-and-forth.
//
// Scoped to the 300-char window FOLLOWING the counter-push token so an
// HH:MM range elsewhere in the response (e.g., the intro citing the
// original sender's slots in dual-TZ form) doesn't accidentally satisfy
// the check. Distinct from `detectCounterWindowNotDualTZ` which fires
// when a CONCRETE range is present in only one TZ — this detector fires
// when there's no concrete range at all.

// 2026-05-19 — ROLE_FLIPPED_GREETING. The draft's greeting line addresses
// the USER (not the recipient). Shape: 「<user's own name> さま」 at the
// top of the draft body, with the SAME name in the sign-off. The user's
// name appeared at the top of the email body the agent READ (because
// the recruiter / professor was addressing the user there) — but in
// the REPLY draft, roles flip: the user is now the sender, the original
// sender is now the recipient. Echoing the user's name back as a
// greeting ships an email addressed to the user themselves.
//
// Detection: extract the draft fenced block, compare the first non-empty
// line (greeting candidate, with honorifics stripped) against the last
// non-empty line that isn't a closing phrase (sign-off candidate).
// Strict equality (after stripping honorifics) avoids the false-positive
// where two unrelated people share a family-name token (「田中 一郎」 ≠
// 「田中 太郎」).

const GREETING_HONORIFICS_RE =
  /\s*(さま|様|さん|-san|-sama|,?\s*$)\s*$/;
// EN greeting prefixes ("Dear …", "Hi …", etc.) stripped so the cleaned
// greeting-name matches the sign-off-name on JP-style draftsAND EN-style
// drafts. JA greetings carry honorifics as a SUFFIX (already handled by
// GREETING_HONORIFICS_RE); EN carries them as a PREFIX.
const GREETING_PREFIX_RE = /^(Dear|Hi|Hello|To)\s+/i;
const CLOSING_PHRASE_RE =
  /(よろしくお願い|Best,?$|Sincerely,?$|Regards,?$|Best regards,?$|敬具|何卒よろしく)/;

function detectRoleFlippedGreeting(text: string): boolean {
  const blocks = extractCodeBlocks(text);
  for (const block of blocks) {
    if (!DRAFT_GREETING_RE.test(block) || !DRAFT_CLOSING_RE.test(block)) continue;
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 4) continue;

    const firstLine = lines[0];
    // Only fire when the first line LOOKS like a named greeting
    // (carries an honorific OR Dear/Hi prefix). Skip standard "お世話に
    // なっております" alone, "Hi team", etc.
    if (!/(さま|様|さん|-san|-sama|^Dear\s|^Hi\s)/.test(firstLine)) continue;

    const greetingName = firstLine
      .replace(GREETING_PREFIX_RE, "")
      .replace(GREETING_HONORIFICS_RE, "")
      .trim();
    if (greetingName.length < 2) continue;

    // Walk backwards through lines to find the sign-off: first line from
    // the end that is NOT itself a closing phrase like "よろしくお願い".
    let signOff: string | null = null;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (CLOSING_PHRASE_RE.test(line)) continue;
      signOff = line;
      break;
    }
    if (!signOff || signOff.length < 2) continue;

    // Strict equality on cleaned forms — avoids false positives from
    // partial-name collisions. The dogfood failure (「田中 太郎 さま」
    // greeting + 「田中 太郎」 sign-off) hits this branch cleanly.
    if (greetingName === signOff) {
      return true;
    }
  }
  return false;
}

function detectCounterWindowVague(text: string): boolean {
  COUNTER_PUSH_RE.lastIndex = 0;
  const m = COUNTER_PUSH_RE.exec(text);
  if (!m) return false;
  // Scope: line containing the counter-push (backward to last \n)
  // + 100 chars forward. The intro typically cites the sender's
  // original slots in dual-TZ form on earlier lines; line-bounding
  // keeps those slots out of scope. A concrete counter window will
  // sit on the same line as (or right next to) the push verb.
  const beforeBreak = text.lastIndexOf("\n", m.index);
  const scopeStart = beforeBreak === -1 ? 0 : beforeBreak + 1;
  const scopeEnd = Math.min(text.length, m.index + 100);
  const scope = text.slice(scopeStart, scopeEnd);
  const rangeRe = /\d{1,2}:\d{2}\s*[-–~〜]\s*\d{1,2}:\d{2}/;
  if (rangeRe.test(scope)) return false;
  // Allow multi-slot proposals (≥2 distinct HH:MM tokens in scope).
  const timeRe = /\b\d{1,2}:\d{2}\b/g;
  const matches = scope.match(timeRe) ?? [];
  const unique = new Set(matches);
  if (unique.size >= 2) return false;
  return true;
}

function detectCounterWindowNotDualTZ(text: string): boolean {
  if (!COUNTER_PUSH_RE.test(text)) return false;

  // Find each HH:MM–HH:MM range in the response. For each, check if
  // a JST marker AND a user-TZ marker appear within 50 chars on either
  // side. The counter window is "dual-TZ" when at least one range has
  // BOTH markers nearby OR the response has two adjacent ranges each
  // labelled with a different TZ.
  //
  // Pragmatic check: count ranges that are TZ-anchored. If counter
  // language is present AND at least one range exists AND no range
  // has BOTH TZs in its neighbourhood AND no pair of ranges covers
  // both TZs → flag.
  const rangeRe = /\d{1,2}:\d{2}\s*[-–~〜]\s*\d{1,2}:\d{2}/g;
  let m: RegExpExecArray | null;
  let hasJstRange = false;
  let hasUserRange = false;
  while ((m = rangeRe.exec(text)) !== null) {
    const idx = m.index;
    const winStart = Math.max(0, idx - 60);
    const winEnd = Math.min(text.length, idx + m[0].length + 60);
    const win = text.slice(winStart, winEnd);
    if (/(\bJST\b|日本時間|Asia\/Tokyo)/i.test(win)) hasJstRange = true;
    if (
      /(\bP(D|S)?T\b|バンクーバー時|Pacific|Vancouver|\bE(D|S)?T\b|\bC(D|S)?T\b|\bM(D|S)?T\b|\bCEST?\b|\bBST\b|\bNZST\b)/i.test(
        win,
      )
    )
      hasUserRange = true;
  }
  // No ranges found at all → can't say (might be a "different day"
  // counter without HH:MM). Don't flag.
  if (!hasJstRange && !hasUserRange) return false;
  // Both sides present → dual-TZ. OK.
  if (hasJstRange && hasUserRange) return false;
  // Only one side present → violation.
  return true;
}

function detectWorkingHoursIgnored(text: string): boolean {
  JST_TOKEN_RE.lastIndex = 0;
  const firstJst = JST_TOKEN_RE.exec(text);
  if (!firstJst) return false;
  const idx = firstJst.index;
  const winStart = Math.max(0, idx - WORKING_HOURS_IGNORED_PROXIMITY);
  const winEnd = Math.min(
    text.length,
    idx + firstJst[0].length + WORKING_HOURS_IGNORED_PROXIMITY
  );
  // Dual-TZ context established at first JST mention → OK.
  if (USER_LOCAL_TZ_RE.test(text.slice(winStart, winEnd))) return false;
  // PT mentioned ANYWHERE earlier in the response → analysis-section
  // pattern, also OK.
  if (USER_LOCAL_TZ_RE.test(text.slice(0, idx))) return false;
  return true;
}

// engineer-62 — context the orchestrator (and the harness) hands the
// detector so the cascade-failure checks can inspect what was CALLED,
// not just what was SAID. `toolCallHistory` is the in-order list of
// tool calls that ran during this assistant turn. `userMessage` is the
// raw text of the user's most recent turn — used by the reply-intent
// heuristic.
//
// Both fields are optional. When omitted, the detectors that rely on
// them are no-ops, so existing callers keep working without changes.
export type SelfCritiqueContext = {
  toolCallHistory?: ReadonlyArray<{ toolName: string; status?: string }>;
  userMessage?: string;
};

// Reply-intent triggers (EMAIL REPLY WORKFLOW prompt). Used by the
// `reply intent without email_get_new_content_only` detector.
const REPLY_INTENT_RE =
  /(返したい|返信したい|返事|返信ドラフト|下書き|送りたい|返信して|返信した方|返信お願い|\breply\b|\brespond\b|draft a reply|write back|get back to)/i;

// Slot tokens — used by `slot list without convert_timezone` AND by
// `reply intent without email_get_new_content_only` (we only flag the
// reply-intent case when the response actually contains slot dates,
// since not every reply needs convert_timezone).
//
// A "slot line" is a line that contains a DATE token AND a TIME token.
// `countTzSlotLines` further requires a TZ marker on the line — that's
// the canonical shape of a dual-TZ slot list (`5月15日 10:00 JST / …`)
// and the cascade-failure signal. A line listing the user's own
// calendar events in their own TZ (e.g. "5/13 15:30 MAT223 Lecture")
// is NOT a slot list and must not trip the convert_timezone gate.
const SLOT_DATE_TOKEN_RE = /(\d{1,2}[\/\-月]\d{1,2}|候補\s*\d|第[一二三四五]希望|May\s*\d{1,2}|Jun\s*\d{1,2})/;
const SLOT_TIME_TOKEN_RE = /\d{1,2}[:：]\d{2}/;
const SLOT_TZ_TOKEN_RE =
  /(\bJST\b|\bAsia\/Tokyo\b|日本時間|\bP(D|S)?T\b|\bE(D|S)?T\b|\bC(D|S)?T\b|\bM(D|S)?T\b|\bCEST?\b|\bBST\b|\bGMT\b|\bNZST\b|バンクーバー時刻|バンクーバー時間|Pacific|Eastern|Central|Mountain|Atlantic)/i;

function countSlotLines(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (SLOT_DATE_TOKEN_RE.test(line) && SLOT_TIME_TOKEN_RE.test(line)) {
      count += 1;
    }
  }
  return count;
}

function countTzSlotLines(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (
      SLOT_DATE_TOKEN_RE.test(line) &&
      SLOT_TIME_TOKEN_RE.test(line) &&
      SLOT_TZ_TOKEN_RE.test(line)
    ) {
      count += 1;
    }
  }
  return count;
}

export function detectPlaceholderLeak(
  text: string,
  context?: SelfCritiqueContext
): PlaceholderLeakDetection {
  const matched: string[] = [];
  for (const tok of FORBIDDEN_TOKENS) {
    if (tok.pattern.test(text)) {
      matched.push(tok.name);
    }
  }
  if (detectWorkingHoursIgnored(text)) {
    matched.push("JST without user-local TZ nearby");
  }
  if (detectLocationNotDisclosed(text)) {
    matched.push("draft references user-TZ without location disclosure");
  }
  if (detectMissingIntroBeforeDraft(text)) {
    matched.push("missing intro before draft");
  }
  if (detectDraftOutsideCodeBlock(text)) {
    matched.push("draft body outside code block");
  }
  if (detectCounterWindowNotDualTZ(text)) {
    matched.push("counter window not dual-TZ");
  }
  if (detectCounterWindowVague(text)) {
    matched.push("counter window vague");
  }
  if (detectRoleFlippedGreeting(text)) {
    matched.push("role-flipped greeting");
  }

  // engineer-62 — cascade-failure detectors. Fire only when the
  // orchestrator (or the harness) handed us tool-call history. Text-
  // only callers (e.g. legacy tests, downstream tooling) keep working
  // exactly as before.
  if (context?.toolCallHistory) {
    const history = context.toolCallHistory;
    const tzSlotLineCount = countTzSlotLines(text);
    const userMessage = context.userMessage ?? "";

    // (1) slot list without convert_timezone — the agent emitted a
    // multi-slot dual-TZ-shaped response but never called
    // convert_timezone. The canonical cascade signal: agent displayed
    // dual-TZ slots without using the tool that produces them, so the
    // conversions are either hallucinated or copy-pasted from somewhere
    // they shouldn't be (quoted-block round-1 candidates).
    //
    // Requiring a TZ marker per slot line is what separates this from a
    // legit "here are your calendar events today" listing (which lives
    // entirely in the user's TZ and needs no conversion).
    // 2026-05-19 — loosened from ≥3 to ≥2. The 2-slot dogfood case
    // (recruiter offers 2 alternative times) shipped a dual-TZ slot
    // list that the prior threshold ignored, letting the failure mode
    // (agent shows dual-TZ slots without ever calling convert_timezone,
    // producing wrong TZ math) land in production. 2 lines is still a
    // strong signal — there's no legitimate scenario where 2+ TZ-tagged
    // slot lines exist in a response without the tool having been called.
    if (tzSlotLineCount >= 2) {
      const hasConvertTimezone = history.some(
        (h) => h.toolName === "convert_timezone"
      );
      if (!hasConvertTimezone) {
        matched.push("slot list without convert_timezone");
      }
    }

    // (2) reply intent + slot dates + email_get_body called +
    // email_get_new_content_only NOT called → THREAD_ROLE_CONFUSED-class
    // risk. The agent went through the metadata-then-body path but
    // skipped the structural slot-extraction surface — exactly the
    // cascade shape from the 2026-05-14 dogfood.
    //
    // For reply-intent, ANY slot line (date + time, with or without TZ
    // marker) counts — a draft that simply echoes the sender's slots is
    // still pulling them from somewhere, and if email_get_new_content_only
    // wasn't called the source might be quoted history.
    const replyIntent =
      userMessage.length > 0 && REPLY_INTENT_RE.test(userMessage);
    if (replyIntent && countSlotLines(text) >= 1) {
      const calledGetBody = history.some(
        (h) => h.toolName === "email_get_body"
      );
      const calledGetNewContent = history.some(
        (h) => h.toolName === "email_get_new_content_only"
      );
      if (calledGetBody && !calledGetNewContent) {
        matched.push("reply intent without email_get_new_content_only");
      }
    }

    // (3) 2026-05-18 — SILENT_DOUBLE_DRAFT detector. On a reply-intent
    // turn the agent MUST emit exactly one draft (MUST-rule 13). When
    // the response contains ≥2 draft-shaped fenced blocks (greeting +
    // closing markers, per draft-detect.ts), the UI ends up with two
    // Send/Edit pairs and the user can't tell which is primary. Reuses
    // the same detection helper the UI uses (`detectDraftBlocks`) so
    // the detector fires on exactly the surfaces that show two action
    // bars to the user.
    if (replyIntent) {
      const draftBlocks = detectDraftBlocks(text);
      if (draftBlocks.length >= 2) {
        matched.push("multiple drafts in one turn");
      }
    }
  }

  return { hasLeak: matched.length > 0, matched };
}

// Corrective system message the orchestrator pushes onto the
// conversation before doing the one retry iteration. Names the failure
// mode explicitly so the agent's reasoning can correct rather than
// re-emit the same template.
export function buildPlaceholderLeakCorrection(
  matched: string[]
): string {
  // Per-mode corrective hints — appended when the matched tokens
  // signal a specific failure shape beyond the generic placeholder
  // case. Keeps the message focused: the agent gets actionable guidance
  // tied to the actual leak, not a wall of every-possible-mistake text.
  const extras: string[] = [];
  if (matched.includes("件名 fabricated on reply")) {
    extras.push(
      "- SUBJECT_LINE_FABRICATED_ON_REPLY: you emitted a `件名: Re:` / `Subject: Re:` line inside the draft body. Email clients auto-prefix `Re:` on a reply — the body should be reply prose ONLY, no subject header inside. Remove the subject line entirely; do not 'fix' it by rewording."
    );
  }
  if (matched.includes("trailing future action")) {
    extras.push(
      "- ACTION_COMMITMENT_VIOLATION (trailing): you trailed a phrase like `メール本文を確認します` AFTER your draft was already emitted. That sequence ships ungrounded output AND admits on-the-record that you should have fetched. The fix is to actually fetch (email_get_body, etc.) BEFORE re-emitting the draft — never as a postscript. Drop the trailing 'will check' phrase from the rewrite."
    );
  }
  if (matched.includes("slot acceptance missing user-local TZ")) {
    extras.push(
      "- LATE_NIGHT_SLOT_ACCEPTED_BLINDLY: your draft accepted a proposed slot without comparing it to the user's working hours (USER_WORKING_HOURS in your context). Re-run the SLOT FEASIBILITY CHECK: convert each proposed slot to the user's local TZ via convert_timezone, then compare the user-local HH:MM to USER_WORKING_HOURS. If the slot is outside that window, switch to a COUNTER-PROPOSAL draft (push back politely, name the user-local time as the reason, propose an alternative window in the sender's TZ). Do not ship a 2 AM acceptance."
    );
  }
  if (matched.includes("JST without user-local TZ nearby")) {
    extras.push(
      "- WORKING_HOURS_IGNORED / MUST-rule 7 violation: your response cited a JST time without the user-local TZ counterpart within ~80 chars. EVERY slot you display MUST be in dual-TZ form on its first mention — sender-side AND user-side, side-by-side (see TIMEZONE RULES). Re-emit with each slot in the shape `5月15日(金) 10:00 JST / 5月14日(木) 18:00 PT`. The conversion goes through convert_timezone; do not math TZ offsets in your head."
    );
  }
  if (matched.includes("draft references user-TZ without location disclosure")) {
    extras.push(
      "- LOCATION_NOT_DISCLOSED_TO_SENDER / MUST-rule 12 violation: your draft body (inside the fenced code block) references a user-local TZ — a TZ abbreviation (PT / PDT / EST / etc.) OR a phrase like こちらの時間 / 現地時間 / 私の時間 — WITHOUT a location anchor naming your region. The recipient does not know where you are based; without a city/region they can't frame the times. Add a one-sentence disclosure right after お世話になっております (or the EN equivalent greeting) — shape (JA): 「現在 <region> 在住のため、…」or 「海外在住のため、…」。Shape (EN): 'I'm currently based in <region>, …'. Pull <region> from USER CONTEXT (USER_TIMEZONE) — never hard-code. The disclosure is a SEND-side concern only (inside the code block); meta-prose ABOVE the code block can keep using こちら freely."
    );
  }
  if (matched.includes("slot list without convert_timezone")) {
    extras.push(
      "- THREAD_ROLE_CASCADE / TIMEZONE RULES violation: your response shows ≥3 slot lines but you did NOT call `convert_timezone` this turn. Either the conversions you displayed are hallucinated, or you copy-pasted slots from somewhere instead of computing them. Re-run the EMAIL REPLY WORKFLOW from the top: `email_get_body` → `email_get_new_content_only` → `infer_sender_timezone` → `infer_sender_norms` → `convert_timezone` for EACH slot (start AND end endpoints), then re-emit the draft with the tool results inlined. Do NOT math TZ offsets in your head; do NOT skip the tool call because you 'already know' the answer."
    );
  }
  if (matched.includes("reply intent without email_get_new_content_only")) {
    extras.push(
      "- THREAD_ROLE_CONFUSED risk: you drafted a slot-list reply, and you called `email_get_body`, but you did NOT call `email_get_new_content_only` — the structural slot-extraction surface (MUST-rule 2). Extracting slots from `email_get_body`'s output means you may have pulled them from quoted history (previous-round candidates), which is the THREAD_ROLE_CONFUSED failure shape from the 2026-05-14 dogfood. Call `email_get_new_content_only` for the same inboxItemId, re-extract slots from its `newContentBody` ONLY, then re-emit the draft. If `stripperFlagged: true` comes back, fall back to `email_get_body` AND disclose to the user."
    );
  }
  if (matched.includes("multiple drafts in one turn")) {
    extras.push(
      "- SILENT_DOUBLE_DRAFT / MUST-rule 13 violation: your response contains TWO email-draft fenced code blocks. The UI renders one Send/Edit affordance per block, so the user now sees two ambiguous primaries with no clear which-to-act-on. Re-emit ONE complete draft inside a single code block. If you wanted to offer a variant, append a single-line prose offer OUTSIDE the block (e.g. `より短くしたい場合はおっしゃってください` / `Want a more formal tone?`) — the user will request the alternative explicitly. Never ship two drafts in one reply-intent turn."
    );
  }
  if (matched.includes("missing intro before draft")) {
    extras.push(
      "- MISSING_INTRO_BEFORE_DRAFT / MUST-rule 11 violation: your response jumped straight into the draft code block without an establishing intro for the user. The user reads fresh and has no anchor — they need to know WHO the email is from + WHAT it's about + WHICH ROUND + the SPECIFIC VALUES in dual-TZ form + YOUR DECISION before they see the draft. Re-emit with a 1–2 sentence intro above the code block per MUST-rule 11's 5-element shape (sender + topic + round + values + decision). Never start the response with just the draft body."
    );
  }
  if (matched.includes("draft body outside code block")) {
    extras.push(
      "- DRAFT_OUTSIDE_CODE_BLOCK / MUST-rule 10 violation: your response emitted email-draft prose (greeting + closing markers) as PLAIN TEXT, not wrapped in a fenced ``` code block. The UI attaches Send / Edit / Confirm affordances to the contents of a fenced block — when the draft is inline prose, the user has no copy-and-send target. Re-emit with the entire reply body inside a single ```text ... ``` fence. Meta-commentary (intro, sender-side reasoning disclosure, trailing offer) stays OUTSIDE the fence; only the literal send-as-is reply prose goes INSIDE."
    );
  }
  if (matched.includes("counter window not dual-TZ")) {
    extras.push(
      "- COUNTER_WINDOW_NOT_DUAL_TZ / COUNTER-PROPOSAL PATTERN rule 3 violation: you proposed a counter window with HH:MM–HH:MM in only ONE timezone (sender-TZ OR user-TZ, not both). The recipient is in their own TZ and shouldn't have to math the offset — that's exactly the burden Steadii is supposed to remove. Re-emit the counter window with BOTH ranges side-by-side, **sender-TZ FIRST**: `<HH:MM–HH:MM <sender-TZ>> (<HH:MM–HH:MM <user-TZ>>)`. Example: 「JST 9:00–13:00 (バンクーバー時間 17:00–21:00) であれば調整しやすく…」. The conversion goes through convert_timezone — do not math TZ offsets in your head, and do not propose a window without first checking the bidirectional intersection of user-hours and sender-hours."
    );
  }
  if (matched.includes("counter window vague")) {
    extras.push(
      "- COUNTER_WINDOW_VAGUE / COUNTER-PROPOSAL PATTERN rule 3 violation: you used counter / push-back language (再度ご調整 / もう少し早い時間 / earlier / different / etc.) but proposed NO concrete HH:MM window. Phrases like 「平日の日中〜夕方」 / 「ご都合の良い時間で」 / 「なるべく早めで」 / \"any weekday afternoon\" / \"sometime next week\" are unactionable — the recipient has no anchor to choose from, and the thread gets stuck in another vague round. Re-emit with a concrete HH:MM–HH:MM range in BOTH TZs (sender-TZ first): 「JST 9:00–13:00 (バンクーバー時間 17:00–21:00) であれば調整しやすく…」. If you genuinely don't have enough information to propose a concrete range, call `infer_sender_norms` first OR fall back to the empty-intersection branch (rule 3e: 「お互いの対応時間が重ならないようで、土日や時間外のご対応もご相談できますでしょうか。」). Never ship a vague counter."
    );
  }
  if (matched.includes("role-flipped greeting")) {
    extras.push(
      "- ROLE_FLIPPED_GREETING / MUST-rule 5b violation: the draft body's greeting addresses the USER, not the recipient. The user's own name appears at the TOP of the draft — but you're drafting a REPLY, so the user is the SENDER and the original sender is the recipient. The user's name belongs ONLY in the sign-off at the bottom. Re-write the greeting line to address the recipient by name — pull from `inbox_item.senderName` / `lookup_entity.displayName` / the sender's org. Shape (JA): 「<recruiter / org / professor> さま」 / 「<姓> 先生」. Shape (EN): \"Dear <recipient name>\" / \"Hi <first name>\". When no recipient name is available, use a generic team-level greeting (「ご担当者さま」 / \"Dear team\") — NEVER substitute the user's name as a fallback. The user's name appeared at the top of the body you READ because the sender was addressing the user there; in your REPLY, that role flips."
    );
  }
  return [
    "PLACEHOLDER_LEAK detected in your previous response.",
    "",
    `Matched forbidden tokens: ${matched.join(", ")}.`,
    "",
    "Your previous output contained placeholder slots — meaning you produced a template instead of grounded text. The OUTPUT GROUNDING rule in your system prompt is non-negotiable: every specific claim must be backed by a tool-call result or a user-fact, NOT by a generic template.",
    ...(extras.length > 0 ? ["", "Mode-specific notes:", ...extras] : []),
    "",
    "Re-do this turn:",
    "1. Identify which specific values are missing (a name, a date, a slot, a course code, etc.).",
    "2. Call the appropriate tool to fetch each — email_get_body for email content, lookup_entity → followed by content fetch for cross-source context, calendar_list_events for schedules, infer_sender_timezone + convert_timezone for time slots, etc.",
    "3. Re-write the response with the fetched values inlined. Do NOT emit any of the forbidden tokens above.",
    "",
    "If a value truly cannot be fetched (tool fails, no record), state that PLAINLY in the response — do NOT substitute a placeholder.",
  ].join("\n");
}
