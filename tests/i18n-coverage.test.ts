import { describe, expect, it } from "vitest";
import { auditCodebase } from "@/scripts/i18n-audit";

/**
 * CI regression gate. After polish-19's sweep, the audit must report
 * zero findings; any new hardcoded JSX string introduced in a future PR
 * fails this test before merge.
 *
 * If a legitimate future case can't be wrapped (e.g. a new edge-runtime
 * surface), extend `PATH_WHITELIST` in `scripts/i18n-audit.ts` with a
 * documented rationale rather than disabling this test.
 */
describe("i18n coverage", () => {
  it("audit reports zero findings across app/ and components/", () => {
    const findings = auditCodebase();
    if (findings.length > 0) {
      const sample = findings.slice(0, 20).map((f) =>
        `  ${f.file}:${f.line}:${f.column} [${f.kind}] ${JSON.stringify(f.text)}`
      );
      const more =
        findings.length > 20 ? `\n  … (${findings.length - 20} more)` : "";
      throw new Error(
        `Found ${findings.length} hardcoded JSX string(s):\n${sample.join("\n")}${more}\n\nRun \`pnpm i18n:audit\` for the full list. Wrap each with t() and add the key to en.ts + ja.ts.`
      );
    }
    expect(findings).toEqual([]);
  });
});
