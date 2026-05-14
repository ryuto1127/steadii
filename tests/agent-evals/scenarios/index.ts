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
// engineer-53 — three real-world reply-hardening scenarios derived
// from the 2026-05-13 dogfood failure.
import emailReplyTerseTypo from "./email-reply-terse-typo";
import subjectLineFabricated from "./subject-line-fabricated";
import trailingActionNarration from "./trailing-action-narration";
// engineer-54 — secretary push-back: SLOT FEASIBILITY CHECK +
// COUNTER-PROPOSAL PATTERN + working-hours onboarding ask.
import lateNightSlotPushback from "./late-night-slot-pushback";
import feasibleAndInfeasibleMix from "./feasible-and-infeasible-mix";
import workingHoursUnsetAsksOnce from "./working-hours-unset-asks-once";
// engineer-56 — bidirectional norms: sender-norms respected even when
// the user is permissive, + empty-intersection weekend / out-of-hours
// fallback path.
import senderNormsRespected from "./sender-norms-respected";
import emptyIntersectionWindow from "./empty-intersection-window";

export const ALL_SCENARIOS: EvalScenario[] = [
  placeholderLeakEmailReply,
  wrongTzDirection,
  silentAutocorrectDisclosure,
  metadataConfusedForContent,
  actionCommitmentFollowthrough,
  rangeAsSlotPool,
  happyPathWeekSummary,
  happyPathAbsenceMail,
  emailReplyTerseTypo,
  subjectLineFabricated,
  trailingActionNarration,
  lateNightSlotPushback,
  feasibleAndInfeasibleMix,
  workingHoursUnsetAsksOnce,
  senderNormsRespected,
  emptyIntersectionWindow,
];
