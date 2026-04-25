/* eslint-disable @typescript-eslint/no-floating-promises */
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { importNotionWorkspace } from "@/lib/integrations/notion/import-to-postgres";

async function resolveUserId(arg: string): Promise<string> {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)
  ) {
    return arg;
  }
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, arg))
    .limit(1);
  if (!row) throw new Error(`No user with email ${arg}`);
  return row.id;
}

function parseArgs(argv: string[]): { userArg: string; dryRun: boolean } {
  const args = argv.slice(2);
  const userIdx = args.indexOf("--user");
  if (userIdx === -1 || !args[userIdx + 1]) {
    throw new Error(
      "Usage: pnpm tsx scripts/import-notion-to-postgres.ts --user <userId|email> [--dry-run]"
    );
  }
  return {
    userArg: args[userIdx + 1],
    dryRun: args.includes("--dry-run"),
  };
}

async function main() {
  const { userArg, dryRun } = parseArgs(process.argv);
  const userId = await resolveUserId(userArg);
  console.log(
    `[import-notion] user=${userId} dryRun=${dryRun}. Walking Notion workspace…`
  );

  const summary = await importNotionWorkspace({
    userId,
    dryRun,
    onProgress: (m) => console.log(`  ${m}`),
  });

  console.log("\nSummary:");
  console.log(`  classes:    ${JSON.stringify(summary.classes)}`);
  console.log(`  assignments:${JSON.stringify(summary.assignments)}`);
  console.log(`  mistakes:   ${JSON.stringify(summary.mistakes)}`);
  console.log(`  syllabi:    ${JSON.stringify(summary.syllabi)}`);
  console.log(`  duration:   ${summary.durationMs}ms`);
  if (dryRun) {
    console.log("\n(dry run — no rows inserted)");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[import-notion] failed:", err);
  process.exit(1);
});
