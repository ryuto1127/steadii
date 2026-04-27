// Registry of all proactive rules. Each rule lives in its own file under
// this directory and is added here. Order doesn't matter — the scanner
// runs them all and dedups by `(issueType + source_record_ids)`.

import type { ProactiveRule } from "../types";
import { timeConflictRule } from "./time-conflict";
import { examConflictRule } from "./exam-conflict";
import { deadlineDuringTravelRule } from "./deadline-during-travel";
import { examUnderPreparedRule } from "./exam-under-prepared";
import { workloadOverCapacityRule } from "./workload-over-capacity";

export const ALL_RULES: ProactiveRule[] = [
  timeConflictRule,
  examConflictRule,
  deadlineDuringTravelRule,
  examUnderPreparedRule,
  workloadOverCapacityRule,
];
