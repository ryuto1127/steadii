/**
 * scripts/cost-audit.ts
 *
 * Reads usage_events to surface where token spend actually goes. The output
 * is meant to drive Parts 2-7 of engineer-59 by hard-prioritizing the
 * biggest cost drivers instead of optimizing from intuition.
 *
 * Usage:
 *
 *   pnpm db:cost-audit                  # 24h / 7d / 30d windows, all users
 *   pnpm db:cost-audit --user=UUID      # restrict to one user
 *   pnpm db:cost-audit --days=14        # add a 14-day window in addition to 24h/7d/30d defaults
 *   pnpm db:cost-audit --top=20         # show top-N expensive runs (default 10)
 *
 * Output shape per window:
 *   - total USD + total credits + call count
 *   - per-taskType (spend, calls, avg/p50/p95 input+output tokens)
 *   - per-model (rolled to pricing tier; spend, calls, share)
 *   - per-user (top spenders by USD)
 *   - per-route proxy (groups taskTypes into chat / cron / email / other)
 *   - top-N most expensive single calls (one row per usage_events row,
 *     with chatId + messageId so we can trace runaways back to a chat)
 *
 * Env loading + server-only shim are handled by scripts/_register.cjs.
 */
import { db } from "@/lib/db/client";
import { usageEvents, users, chats, messages } from "@/lib/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { estimateUsdCost, pricingTierFor } from "@/lib/agent/models";

type Row = {
  id: string;
  userId: string;
  chatId: string | null;
  messageId: string | null;
  model: string;
  taskType: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  creditsUsed: number;
  createdAt: Date;
};

function parseFlag(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function usd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(5)}`;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a";
}

// p50 / p95 over an unsorted array.
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(q * (sorted.length - 1)))
  );
  return sorted[idx];
}

// Task type → coarse route bucket. The mapping is rule-of-thumb; primary use
// is high-level "is most spend in chat vs cron vs email pipeline" framing.
function routeBucket(taskType: string): string {
  if (taskType === "chat" || taskType === "tool_call" || taskType === "rerank")
    return "chat";
  if (taskType === "chat_title" || taskType === "tag_suggest") return "chat-meta";
  if (
    taskType === "email_classify_risk" ||
    taskType === "email_classify_deep" ||
    taskType === "email_draft" ||
    taskType === "email_embed"
  )
    return "email-pipeline";
  if (taskType === "proactive_proposal") return "proactive-cron";
  if (
    taskType === "mistake_explain" ||
    taskType === "syllabus_extract" ||
    taskType === "notes_extract"
  )
    return "manual-extract";
  if (taskType === "voice_cleanup") return "voice";
  return "other";
}

async function main() {
  const userFilter = parseFlag("user");
  const extraDays = Number(parseFlag("days", "0"));
  const topN = Number(parseFlag("top", "10"));

  // Standard windows: 24h, 7d, 30d. Extra optional window via --days.
  const windows: Array<{ label: string; days: number }> = [
    { label: "24h", days: 1 },
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
  ];
  if (extraDays > 0 && ![1, 7, 30].includes(extraDays)) {
    windows.push({ label: `${extraDays}d`, days: extraDays });
  }

  // Pull the full 30d window once (or extraDays if larger) into memory so we
  // can compute quantiles + top-N without N separate scans. usage_events at α
  // scale is small enough (<100k rows even at hundreds of users). If this
  // grows past a few million rows the script should chunk by window.
  const maxDays = Math.max(...windows.map((w) => w.days));
  const since = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000);
  const whereClause = userFilter
    ? and(gte(usageEvents.createdAt, since), eq(usageEvents.userId, userFilter))
    : gte(usageEvents.createdAt, since);

  const all: Row[] = (await db
    .select({
      id: usageEvents.id,
      userId: usageEvents.userId,
      chatId: usageEvents.chatId,
      messageId: usageEvents.messageId,
      model: usageEvents.model,
      taskType: usageEvents.taskType,
      inputTokens: usageEvents.inputTokens,
      outputTokens: usageEvents.outputTokens,
      cachedTokens: usageEvents.cachedTokens,
      creditsUsed: usageEvents.creditsUsed,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(whereClause)
    .orderBy(desc(usageEvents.createdAt))) as Row[];

  // Resolve user emails for the top-spender table — one cheap lookup over a
  // small set, no N+1.
  const distinctUserIds = Array.from(new Set(all.map((r) => r.userId)));
  const userRows = distinctUserIds.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
    : [];
  const userEmail = new Map<string, string>(
    userRows
      .filter((u) => distinctUserIds.includes(u.id))
      .map((u) => [u.id, u.email ?? "(no-email)"])
  );

  // ----- Render -----
  const line = "─".repeat(78);
  console.log("");
  console.log(line);
  console.log(
    `  Steadii cost audit · ${new Date().toISOString().slice(0, 16).replace("T", " ")}${
      userFilter ? ` · user=${userFilter}` : ""
    }`
  );
  console.log(`  Source: usage_events (recordUsage); ${all.length} rows in last ${maxDays}d`);
  console.log(line);

  for (const w of windows) {
    const cutoff = new Date(Date.now() - w.days * 24 * 60 * 60 * 1000);
    const rows = all.filter((r) => r.createdAt >= cutoff);
    renderWindow(w.label, rows, userEmail, topN);
  }

  console.log(line);
  console.log("  Done.");
  console.log(line);
  console.log("");
}

function renderWindow(
  label: string,
  rows: Row[],
  userEmail: Map<string, string>,
  topN: number
) {
  const totalUsd = rows.reduce(
    (s, r) =>
      s +
      estimateUsdCost(r.model, {
        input: r.inputTokens,
        output: r.outputTokens,
        cached: r.cachedTokens,
      }),
    0
  );
  const totalCredits = rows.reduce((s, r) => s + r.creditsUsed, 0);
  const totalCalls = rows.length;

  console.log("");
  console.log(`  ━ Window: last ${label}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(
    `    Total: ${usd(totalUsd)}  ·  ${totalCredits} credits  ·  ${totalCalls} calls`
  );
  if (totalCalls === 0) {
    console.log("    (no usage_events rows in this window)");
    return;
  }

  // ----- By taskType -----
  const byTask = new Map<
    string,
    {
      calls: number;
      usd: number;
      input: number[];
      output: number[];
      cached: number;
    }
  >();
  for (const r of rows) {
    const u = estimateUsdCost(r.model, {
      input: r.inputTokens,
      output: r.outputTokens,
      cached: r.cachedTokens,
    });
    const entry =
      byTask.get(r.taskType) ??
      { calls: 0, usd: 0, input: [], output: [], cached: 0 };
    entry.calls += 1;
    entry.usd += u;
    entry.input.push(r.inputTokens);
    entry.output.push(r.outputTokens);
    entry.cached += r.cachedTokens;
    byTask.set(r.taskType, entry);
  }
  const taskRows = [...byTask.entries()]
    .map(([taskType, v]) => ({
      taskType,
      calls: v.calls,
      usd: v.usd,
      cached: v.cached,
      inputAvg: v.input.reduce((s, n) => s + n, 0) / v.input.length,
      inputP95: quantile(v.input, 0.95),
      outputAvg: v.output.reduce((s, n) => s + n, 0) / v.output.length,
      outputP95: quantile(v.output, 0.95),
    }))
    .sort((a, b) => b.usd - a.usd);

  console.log("");
  console.log("    By taskType (sorted by spend)");
  console.log(
    `      ${"taskType".padEnd(22)} ${"calls".padStart(6)} ${"usd".padStart(9)} ${"share".padStart(7)} ${"in avg/p95".padStart(13)} ${"out avg/p95".padStart(13)}  cached`
  );
  for (const r of taskRows) {
    console.log(
      `      ${r.taskType.padEnd(22)} ${String(r.calls).padStart(6)} ${usd(
        r.usd
      ).padStart(9)} ${pct(r.usd, totalUsd).padStart(7)} ${`${Math.round(
        r.inputAvg
      )}/${Math.round(r.inputP95)}`.padStart(13)} ${`${Math.round(
        r.outputAvg
      )}/${Math.round(r.outputP95)}`.padStart(13)}  ${String(r.cached).padStart(8)}`
    );
  }

  // ----- By pricing tier (model) -----
  const byModel = new Map<string, { calls: number; usd: number }>();
  for (const r of rows) {
    const tier = pricingTierFor(r.model);
    const u = estimateUsdCost(r.model, {
      input: r.inputTokens,
      output: r.outputTokens,
      cached: r.cachedTokens,
    });
    const entry = byModel.get(tier) ?? { calls: 0, usd: 0 };
    entry.calls += 1;
    entry.usd += u;
    byModel.set(tier, entry);
  }
  console.log("");
  console.log("    By pricing tier");
  console.log(
    `      ${"tier".padEnd(28)} ${"calls".padStart(6)} ${"usd".padStart(9)} ${"share".padStart(7)}`
  );
  for (const [tier, v] of [...byModel.entries()].sort((a, b) => b[1].usd - a[1].usd)) {
    console.log(
      `      ${tier.padEnd(28)} ${String(v.calls).padStart(6)} ${usd(v.usd).padStart(
        9
      )} ${pct(v.usd, totalUsd).padStart(7)}`
    );
  }

  // ----- By route bucket -----
  const byRoute = new Map<string, { calls: number; usd: number }>();
  for (const r of rows) {
    const bucket = routeBucket(r.taskType);
    const u = estimateUsdCost(r.model, {
      input: r.inputTokens,
      output: r.outputTokens,
      cached: r.cachedTokens,
    });
    const entry = byRoute.get(bucket) ?? { calls: 0, usd: 0 };
    entry.calls += 1;
    entry.usd += u;
    byRoute.set(bucket, entry);
  }
  console.log("");
  console.log("    By route bucket (taskType → coarse route)");
  console.log(
    `      ${"bucket".padEnd(28)} ${"calls".padStart(6)} ${"usd".padStart(9)} ${"share".padStart(7)}`
  );
  for (const [bucket, v] of [...byRoute.entries()].sort((a, b) => b[1].usd - a[1].usd)) {
    console.log(
      `      ${bucket.padEnd(28)} ${String(v.calls).padStart(6)} ${usd(v.usd).padStart(
        9
      )} ${pct(v.usd, totalUsd).padStart(7)}`
    );
  }

  // ----- By user -----
  const byUser = new Map<string, { calls: number; usd: number }>();
  for (const r of rows) {
    const u = estimateUsdCost(r.model, {
      input: r.inputTokens,
      output: r.outputTokens,
      cached: r.cachedTokens,
    });
    const entry = byUser.get(r.userId) ?? { calls: 0, usd: 0 };
    entry.calls += 1;
    entry.usd += u;
    byUser.set(r.userId, entry);
  }
  const topUsers = [...byUser.entries()]
    .sort((a, b) => b[1].usd - a[1].usd)
    .slice(0, 10);
  console.log("");
  console.log(`    Top ${topUsers.length} users by spend (${byUser.size} unique users in window)`);
  console.log(
    `      ${"email".padEnd(40)} ${"calls".padStart(6)} ${"usd".padStart(9)} ${"per-user/mo*".padStart(13)}`
  );
  // Project a per-user/mo number by scaling the windowed spend up to 30 days.
  // Useful sanity check against the $5/mo paying / $1.50/mo Free targets.
  const scaleTo30d = (windowLabel: string): number => {
    if (windowLabel === "24h") return 30;
    if (windowLabel === "7d") return 30 / 7;
    if (windowLabel === "30d") return 1;
    const m = /^(\d+)d$/.exec(windowLabel);
    return m ? 30 / Number(m[1]) : 1;
  };
  const scale = scaleTo30d(label);
  for (const [userId, v] of topUsers) {
    const email = userEmail.get(userId) ?? userId;
    console.log(
      `      ${email.padEnd(40).slice(0, 40)} ${String(v.calls).padStart(6)} ${usd(
        v.usd
      ).padStart(9)} ${usd(v.usd * scale).padStart(13)}`
    );
  }

  // ----- Top N expensive single calls -----
  const ranked = rows
    .map((r) => ({
      ...r,
      callUsd: estimateUsdCost(r.model, {
        input: r.inputTokens,
        output: r.outputTokens,
        cached: r.cachedTokens,
      }),
    }))
    .sort((a, b) => b.callUsd - a.callUsd)
    .slice(0, topN);

  console.log("");
  console.log(`    Top ${ranked.length} most expensive single calls`);
  console.log(
    `      ${"taskType".padEnd(22)} ${"model".padEnd(28)} ${"in".padStart(7)} ${"out".padStart(7)} ${"usd".padStart(9)}  chatId`
  );
  for (const r of ranked) {
    console.log(
      `      ${r.taskType.padEnd(22)} ${pricingTierFor(r.model)
        .padEnd(28)
        .slice(0, 28)} ${String(r.inputTokens).padStart(7)} ${String(
        r.outputTokens
      ).padStart(7)} ${usd(r.callUsd).padStart(9)}  ${
        r.chatId ? r.chatId.slice(0, 8) : "—"
      }`
    );
  }

  // Defensive — keep chats / messages imports referenced for future
  // per-chat correlation queries.
  void chats;
  void messages;
  void sql;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
