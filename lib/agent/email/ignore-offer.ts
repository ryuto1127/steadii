// Pure gate logic for the contextual "ignore this sender?" nudge that
// surfaces on the 2nd+ dismiss of an email card. Kept dependency-free
// (no "server-only", no DB) so it's trivially unit-testable and importable
// from both the server action and tests.

// Offer the nudge once a sender has been dismissed at least this many
// times (this dismiss included). 1st dismiss → no offer (don't nag a
// first-timer); 2nd dismiss → offer. Named so the threshold lives in one
// place and the test asserts against the same constant.
export const IGNORE_OFFER_DISMISS_THRESHOLD = 2;

// Decide whether to surface the ignore-sender offer after a dismiss.
//   dismissCountIncludingThis — total times the user has dismissed/snoozed
//     this sender, INCLUDING the dismiss that just happened.
//   alreadyIgnored — true when the sender is already on the ignore list
//     (don't offer to ignore something already ignored).
//
// Returns true only when the count has reached the threshold and the
// sender isn't already ignored.
export function shouldOfferIgnoreSender(args: {
  dismissCountIncludingThis: number;
  alreadyIgnored: boolean;
}): boolean {
  if (args.alreadyIgnored) return false;
  return args.dismissCountIncludingThis >= IGNORE_OFFER_DISMISS_THRESHOLD;
}
