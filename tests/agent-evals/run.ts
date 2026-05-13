// engineer-52 — CLI runner for the agent eval suite.
//
// Reads ALL_SCENARIOS, executes each via runScenario (low-concurrency
// to stay under OpenAI rate limits), and prints a per-scenario report.
// Exit code 0 if all pass; 1 if any fail. Writes a JSON report to
// `tests/agent-evals/last-run.json` for CI to upload as an artifact.
//
// Usage:
//   pnpm eval:agent                       — run everything
//   pnpm eval:agent -- --scenario NAME    — run a single scenario by name
//   pnpm eval:agent -- --concurrency N    — adjust worker count (default 3)

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  evaluateScenario,
  type EvalReport,
  type EvalScenario,
} from "./harness";
import { ALL_SCENARIOS } from "./scenarios";

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

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }).map(
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await worker(items[i]);
      }
    }
  );
  await Promise.all(runners);
  return results;
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

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY is not set. Aborting before any OpenAI call would happen."
    );
    process.exit(2);
  }

  console.error(
    `Running ${scenarios.length} scenario(s) with concurrency ${opts.concurrency}…`
  );
  const startedAt = Date.now();

  const reports = await runWithConcurrency(
    scenarios,
    async (s) => {
      try {
        return await evaluateScenario(s);
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
    opts.concurrency
  );

  const totalMs = Date.now() - startedAt;

  for (const r of reports) {
    console.log(formatReport(r));
    console.log("");
  }

  const passed = reports.filter((r) => r.passed).length;
  const failed = reports.length - passed;
  console.log(
    `==> ${passed}/${reports.length} scenarios passed (${(totalMs / 1000).toFixed(
      1
    )}s)`
  );

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
          totalScenarios: reports.length,
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
