// engineer-52 — CLI runner for the agent eval suite.
//
// Reads ALL_SCENARIOS, executes each via runScenario (low-concurrency
// to stay under OpenAI rate limits), and prints a per-scenario report.
// Exit code 0 if all pass; 1 if any fail. Writes a JSON report to
// `tests/agent-evals/last-run.json` for CI to upload as an artifact.
//
// Usage (requires explicit opt-in — this harness calls the REAL paid OpenAI
// API and is NOT tracked by cost-audit; a bare run refuses, see cost-guard.ts):
//   ALLOW_REAL_LLM=1 pnpm eval:agent                    — run everything
//   ALLOW_REAL_LLM=1 pnpm eval:agent -- --scenario NAME — run one scenario
//   ALLOW_REAL_LLM=1 pnpm eval:agent -- --concurrency N — worker count (def 3)
//   EVAL_MAX_USD=5 ALLOW_REAL_LLM=1 pnpm eval:agent     — raise budget cap

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  evaluateScenario,
  getModelForHarness,
  type EvalReport,
  type EvalScenario,
} from "./harness";
import { ALL_SCENARIOS } from "./scenarios";
import {
  ALLOW_REAL_LLM_REFUSAL,
  emptyUsage,
  estimateUsageUsd,
  formatUsageSummary,
  isOverBudget,
  isRealLlmAllowed,
  resolveMaxRunUsd,
} from "./cost-guard";

type CliOptions = {
  scenarioFilter: string | null;
  concurrency: number;
  reportPath: string;
};

function parseArgs(argv: string[]): CliOptions {
  let scenarioFilter: string | null = null;
  let concurrency = 3;
  let reportPath = path.resolve(
    process.cwd(),
    "tests/agent-evals/last-run.json"
  );
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario") {
      scenarioFilter = argv[++i] ?? null;
    } else if (a === "--concurrency") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n >= 1) concurrency = n;
    } else if (a === "--report") {
      reportPath = path.resolve(process.cwd(), argv[++i] ?? reportPath);
    }
  }
  return { scenarioFilter, concurrency, reportPath };
}

// Runs `worker` over `items` with bounded concurrency. `shouldStop` is checked
// before each item is picked up; once it returns true no further items are
// dispatched (in-flight ones finish). Used to enforce the per-run budget cap.
// Returns only the results actually produced.
async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  shouldStop: () => boolean = () => false
): Promise<{ results: R[]; ran: number }> {
  const results: R[] = [];
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }).map(
    async () => {
      while (true) {
        if (shouldStop()) break;
        const i = next++;
        if (i >= items.length) break;
        results.push(await worker(items[i]));
      }
    }
  );
  await Promise.all(runners);
  return { results, ran: results.length };
}

function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  const header = report.failureMode
    ? `Scenario: ${report.scenarioName} (${report.failureMode})`
    : `Scenario: ${report.scenarioName}`;
  lines.push(header);
  for (const a of report.assertions) {
    const icon = a.pass ? "✅" : "❌";
    lines.push(`  ${icon} ${a.label}`);
    if (!a.pass && a.message) {
      const indented = a.message
        .split("\n")
        .map((l) => "     " + l)
        .join("\n");
      lines.push(indented);
    }
  }
  lines.push(
    `  Duration: ${(report.result.durationMs / 1000).toFixed(1)}s, ${
      report.result.toolCalls.length
    } tool call(s), ${report.result.iterations} iteration(s)`
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  let scenarios: EvalScenario[] = ALL_SCENARIOS;
  if (opts.scenarioFilter) {
    scenarios = scenarios.filter((s) => s.name === opts.scenarioFilter);
    if (scenarios.length === 0) {
      console.error(
        `No scenario named "${opts.scenarioFilter}". Available: ${ALL_SCENARIOS.map(
          (s) => s.name
        ).join(", ")}`
      );
      process.exit(2);
    }
  }

  // Explicit opt-in. This harness hits the REAL paid OpenAI API and is not
  // tracked by cost-audit, so it must never run by accident — that is exactly
  // what caused the 2026-06-01 billing spike. A bare `pnpm eval:agent` refuses.
  if (!isRealLlmAllowed()) {
    console.error(ALLOW_REAL_LLM_REFUSAL);
    process.exit(2);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY is not set. Aborting before any OpenAI call would happen."
    );
    process.exit(2);
  }

  const model = getModelForHarness();
  const maxRunUsd = resolveMaxRunUsd();
  const usage = emptyUsage();

  console.error(
    `Running ${scenarios.length} scenario(s) with concurrency ${opts.concurrency} ` +
      `(model=${model}, budget cap=$${maxRunUsd.toFixed(2)})…`
  );
  const startedAt = Date.now();

  let budgetAborted = false;
  const { results: reports, ran } = await runWithConcurrency(
    scenarios,
    async (s) => {
      try {
        return await evaluateScenario(s, usage);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          scenarioName: s.name,
          failureMode: s.failureMode,
          passed: false,
          assertions: [
            {
              label: "runScenario threw",
              pass: false,
              message,
            },
          ],
          result: {
            finalText: "",
            toolCalls: [],
            iterations: 0,
            durationMs: 0,
          },
        } satisfies EvalReport;
      }
    },
    opts.concurrency,
    // Hard cost ceiling: once estimated spend crosses the cap, stop
    // dispatching new scenarios (in-flight ones finish). Prevents a runaway
    // loop from burning unbounded budget.
    () => {
      const spent = estimateUsageUsd(usage, model);
      if (!budgetAborted && isOverBudget(spent, maxRunUsd)) {
        budgetAborted = true;
        console.error(
          `Budget cap reached: estimated $${spent.toFixed(4)} >= $${maxRunUsd.toFixed(
            2
          )}. Stopping; not dispatching remaining scenarios.`
        );
      }
      return budgetAborted;
    }
  );

  const totalMs = Date.now() - startedAt;

  for (const r of reports) {
    console.log(formatReport(r));
    console.log("");
  }

  const passed = reports.filter((r) => r.passed).length;
  const failed = reports.length - passed;
  const skipped = scenarios.length - ran;
  console.log(
    `==> ${passed}/${reports.length} scenarios passed (${(totalMs / 1000).toFixed(
      1
    )}s)`
  );

  // Attribution: print the run's total tokens + estimated USD so this harness's
  // spend is no longer invisible (it does not go through recordUsage). Uses the
  // same pricing helper as cost-audit.
  const estUsd = estimateUsageUsd(usage, model);
  console.log(formatUsageSummary(usage, model));
  if (budgetAborted) {
    console.log(
      `==> Budget cap aborted the run: ${skipped} scenario(s) skipped.`
    );
  }

  // Write JSON report for CI artifact upload + history-row writeback.
  try {
    await fs.mkdir(path.dirname(opts.reportPath), { recursive: true });
    await fs.writeFile(
      opts.reportPath,
      JSON.stringify(
        {
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: totalMs,
          totalScenarios: scenarios.length,
          ran,
          skipped,
          budgetAborted,
          usage: { ...usage, model, estimatedUsd: estUsd },
          passed,
          failed,
          reports,
        },
        null,
        2
      )
    );
    console.error(`Wrote report to ${opts.reportPath}`);
  } catch (err) {
    console.error(
      `Failed to write report: ${err instanceof Error ? err.message : err}`
    );
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("eval runner crashed:", err);
  process.exit(1);
});
