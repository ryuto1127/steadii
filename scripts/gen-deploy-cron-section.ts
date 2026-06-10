/**
 * scripts/gen-deploy-cron-section.ts
 *
 * Regenerates the live-schedule table inside DEPLOY.md §11 from the
 * single source of truth (lib/cron/manifest.ts). Run after editing the
 * manifest so the docs never drift from the code.
 *
 * Usage:
 *
 *   pnpm cron:gen-docs            # rewrite the marked block in DEPLOY.md
 *   pnpm cron:gen-docs --check    # exit 1 if DEPLOY.md is out of date
 *
 * The generated block is delimited by HTML comment markers in DEPLOY.md:
 *   <!-- CRON_MANIFEST:BEGIN --> … <!-- CRON_MANIFEST:END -->
 * Everything between them is owned by this script; hand-edits are
 * overwritten. Env loading + server-only shim via scripts/_register.cjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CRON_MANIFEST } from "@/lib/cron/manifest";

const BEGIN = "<!-- CRON_MANIFEST:BEGIN -->";
const END = "<!-- CRON_MANIFEST:END -->";
const DEPLOY_PATH = resolve(process.cwd(), "DEPLOY.md");

function generatedBlock(): string {
  const header =
    "| Endpoint | Schedule | Method | Heartbeat | Notes |\n" +
    "|---|---|---|---|---|";
  const rows = CRON_MANIFEST.map((c) => {
    const url = `https://mysteadii.com${c.route}`;
    // Escape pipes in the description so the markdown table stays intact.
    const notes = c.description.replace(/\|/g, "\\|");
    return `| \`${url}\` | \`${c.cron}\` | POST | \`${c.name}\` | ${notes} |`;
  });
  return [
    BEGIN,
    "",
    "<!-- GENERATED from lib/cron/manifest.ts by scripts/gen-deploy-cron-section.ts.",
    "     Do NOT hand-edit this block — edit the manifest and run `pnpm cron:gen-docs`. -->",
    "",
    "In the QStash console → **Schedules** → **Create** (one per row):",
    "",
    header,
    ...rows,
    "",
    "Body: leave empty — the signing key in headers handles auth. The",
    "consolidated `master-sweep` schedule replaces the standalone pre-brief /",
    "ingest-sweep / draft-superseded / digest / weekly-digest schedules",
    "(PR #305): those routes still exist as manual/rollback triggers but must",
    "NOT have their own QStash schedule. Run `pnpm cron:audit` to diff the",
    "live console against this manifest.",
    "",
    END,
  ].join("\n");
}

function rewrite(check: boolean): void {
  const doc = readFileSync(DEPLOY_PATH, "utf8");
  const begin = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (begin === -1 || end === -1) {
    process.stderr.write(
      `Could not find ${BEGIN} / ${END} markers in DEPLOY.md. Add them around the schedule table first.\n`
    );
    process.exit(1);
  }
  const before = doc.slice(0, begin);
  const after = doc.slice(end + END.length);
  const next = before + generatedBlock() + after;

  if (check) {
    if (next !== doc) {
      process.stderr.write(
        "DEPLOY.md §11 is out of date with lib/cron/manifest.ts. Run `pnpm cron:gen-docs`.\n"
      );
      process.exit(1);
    }
    process.stdout.write("DEPLOY.md §11 is up to date with the manifest.\n");
    return;
  }

  writeFileSync(DEPLOY_PATH, next);
  process.stdout.write("Regenerated DEPLOY.md §11 from lib/cron/manifest.ts.\n");
}

rewrite(process.argv.includes("--check"));
