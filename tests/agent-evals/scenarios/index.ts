// engineer-52 — explicit scenario index. We list scenarios by hand
// instead of glob-importing because:
// (a) tsx + ESM doesn't expose `import.meta.glob` (that's a Vite-only
//     feature),
// (b) explicit imports give type-checked ordering for the CI report,
// (c) adding a new scenario should be a single-line append here —
//     the friction is fine for the size of the suite.

import type { EvalScenario } from "../harness";

import placeholderLeakEmailReply from "./placeholder-leak-email-reply";
import wrongTzDirection from "./wrong-tz-direction";
import silentAutocorrectDisclosure from "./silent-autocorrect-disclosure";
import metadataConfusedForContent from "./metadata-confused-for-content";
import actionCommitmentFollowthrough from "./action-commitment-followthrough";
import rangeAsSlotPool from "./range-as-slot-pool";
import happyPathWeekSummary from "./happy-path-week-summary";
import happyPathAbsenceMail from "./happy-path-absence-mail";

export const ALL_SCENARIOS: EvalScenario[] = [
  placeholderLeakEmailReply,
  wrongTzDirection,
  silentAutocorrectDisclosure,
  metadataConfusedForContent,
  actionCommitmentFollowthrough,
  rangeAsSlotPool,
  happyPathWeekSummary,
  happyPathAbsenceMail,
];
