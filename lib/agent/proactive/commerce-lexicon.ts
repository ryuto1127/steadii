// 2026-06-07 — Shared commerce / marketing lexicon for the proactive
// detectors. Single source of truth for "does this text smell like a
// promotional blast" so the two detectors that suppress on commerce
// intent can NEVER drift apart.
//
// Why this module exists. Two detectors independently grew their own
// promo lexicons:
//   - event-detector  (PROMO_STRUCTURED_BLOCK_BYPASS): a sales
//     livestream with a real Date:/Time: block must NOT become a
//     calendar event.
//   - deadline-detector (MARKETING_URGENCY_AS_OBLIGATION): "order by
//     Friday for 20% off" must NOT become a deadline reminder.
// The lists overlapped heavily but had already diverged (one had
// `free shipping`/`today only`/`送料無料`, the other had `今だけ`/
// `お買い得`), so a future promo could slip one detector but not the
// other. This module is the union of what both used.
//
// CRITICAL — this is a LEXICON, not a gate. The two detectors keep their
// DISTINCT gate shapes and compose these building blocks themselves:
//   - event-detector ORs them   (looksPromotional = imperative OR marker)
//     — single match suppresses, so it errs toward catching promos.
//   - deadline-detector ANDs them (isCommercialDeadlineContext =
//     imperative AND marker) — precision over recall, so a bare buy verb
//     ("Order your official transcript by 3/1") or a bare marker alone
//     does NOT suppress a legit deadline.
// Do not add gate/combination logic here — keep it in each detector.
//
// Pure leaf module: no DB, LLM, or I/O, and it imports nothing. Both
// detectors depend on it; it depends on neither.

// (A) Purchase imperative — high-intent buy verbs only (EN + JA). \b on
// the short EN tokens keeps "order"/"buy"/"shop" from matching inside
// unrelated words. The bare verbs subsume the event detector's old
// verb+"now" CTA forms (`shop now` ⊂ `\bshop\b`) and `購入はこちら`
// (⊂ `ご?購入`), so this single set is the union of both detectors'
// purchase tokens. We deliberately EXCLUDE ambiguous verbs (`reserve`,
// `register`, `申し込み`) — those routinely appear in legit deadlines
// (course registration, RSVP).
export const PURCHASE_IMPERATIVE_RE =
  /(\border\b|\bbuy\b|\bshop\b|\bpurchase\b|\bcheckout\b|add\s*to\s*cart|place\s*your\s*order|ご?注文|ご?購入|お買い物|カート)/i;

// (B) Commercial marker — discount / sale / scarcity lexicon (EN + JA).
// Union of both detectors' marker sets: the deadline set contributed
// `free shipping`/`today only`/`guaranteed delivery`/`送料無料`/
// `本日限り`/`お得` etc.; the event set contributed `今だけ`/`お買い得`.
// "% off" / "N% off" anchors the discount shape; the rest are scarcity /
// sale phrases. The weaker "$NN near a discount word" case is handled
// additively by PRICE_TOKEN_RE + DISCOUNT_WORD_RE — see hasCommercialMarker.
export const COMMERCIAL_MARKER_RE =
  /(\d+%\s*off|%\s*off|\bsale\b|\bdiscount\b|\bcoupon\b|\bdeals?\b|\bpromo\b|limited[\s-]time|free\s*shipping|today\s*only|guaranteed\s*delivery|セール|割引|クーポン|今だけ|お買い得|送料無料|限定|期間限定|本日限り|％オフ|オフ|お得)/i;

// A "$NN" price token. On its own it is NOT a commercial marker (a legit
// mail can quote a fee); it only counts when co-occurring with a discount
// word — see hasCommercialMarker.
export const PRICE_TOKEN_RE = /\$\s*\d/;

// Discount words that, when a price token is ALSO present, lift a weaker
// signal to a commercial marker. Includes bare "off"/"save" — kept OUT of
// the standalone COMMERCIAL_MARKER_RE to avoid false positives ("hands
// off"), but safe to count alongside a "$NN" price.
export const DISCOUNT_WORD_RE =
  /(\d+%\s*off|%\s*off|\boff\b|\bsave\b|\bdiscount\b|\bsale\b|\bdeals?\b|\bcoupon\b|割引|セール|お得|オフ)/i;

// True when the text carries a purchase imperative (building block A).
export function hasPurchaseImperative(text: string): boolean {
  return PURCHASE_IMPERATIVE_RE.test(text);
}

// True when the text carries a commercial marker — either a direct marker
// (building block B) OR a "$NN" price co-occurring with a discount word.
// Both detectors share this exact notion of "commercial marker"; they
// differ only in how they COMBINE it with the purchase imperative.
export function hasCommercialMarker(text: string): boolean {
  return (
    COMMERCIAL_MARKER_RE.test(text) ||
    (PRICE_TOKEN_RE.test(text) && DISCOUNT_WORD_RE.test(text))
  );
}
