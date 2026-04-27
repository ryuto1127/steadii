// Registry of all proactive rules. Each rule lives in its own file under
// this directory and is added here. Order doesn't matter — the scanner
// runs them all and dedups by `(issueType + source_record_ids)`.
//
// PR 1 lands the registry empty; PR 2 fills in the five rule modules.

import type { ProactiveRule } from "../types";

export const ALL_RULES: ProactiveRule[] = [];
