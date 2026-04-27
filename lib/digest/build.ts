import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { PENDING_ACTIONS } from "@/lib/agent/email/pending-queries";

// ---------------------------------------------------------------------------
// Digest renderer. Pure enough to unit-test with a mocked db.
//
// Contract (memory):
// - Scope: pending drafts only (drafts with status='pending' AND
//   action in PENDING_ACTIONS — draft_reply / ask_clarifying / notify_only).
// - Never include body preview — deep-linking to Steadii is the point.
// - Subject is dynamic (assembled from pending count + risk distribution).
// - Skip sending when pending = 0; return null.
// - From-name: "Steadii Agent".
// ---------------------------------------------------------------------------

export type DigestItem = {
  agentDraftId: string;
  inboxItemId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  riskTier: "low" | "medium" | "high";
  action: "draft_reply" | "ask_clarifying" | "notify_only";
};

export type DigestPayload = {
  userEmail: string;
  subject: string;
  text: string;
  html: string;
  items: DigestItem[];
  highCount: number;
  mediumCount: number;
  lowCount: number;
};

// Pick up pending drafts for the user. Ordered by risk (high first) then
// most-recent. Caps at 10 items per digest so the email stays scannable;
// the "N more" overflow is rendered as a plain line.
export async function loadPendingDigestItems(
  userId: string,
  limit: number = 10
): Promise<DigestItem[]> {
  const rows = await db
    .select({
      agentDraftId: agentDrafts.id,
      inboxItemId: agentDrafts.inboxItemId,
      riskTier: agentDrafts.riskTier,
      action: agentDrafts.action,
      createdAt: agentDrafts.createdAt,
      senderEmail: inboxItems.senderEmail,
      senderName: inboxItems.senderName,
      subject: inboxItems.subject,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(
      and(
        eq(agentDrafts.userId, userId),
        eq(agentDrafts.status, "pending"),
        inArray(agentDrafts.action, [...PENDING_ACTIONS])
      )
    )
    .orderBy(desc(agentDrafts.createdAt))
    .limit(limit * 3);

  const sorted = [...rows].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as const;
    const ar = order[a.riskTier] ?? 3;
    const br = order[b.riskTier] ?? 3;
    if (ar !== br) return ar - br;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return sorted.slice(0, limit).map((r) => ({
    agentDraftId: r.agentDraftId,
    inboxItemId: r.inboxItemId,
    senderName: r.senderName ?? r.senderEmail,
    senderEmail: r.senderEmail,
    subject: r.subject ?? "(no subject)",
    riskTier: r.riskTier,
    action: r.action as "draft_reply" | "ask_clarifying" | "notify_only",
  }));
}

export type DigestLocale = "en" | "ja";

// Build a subject line from the counts. Memory: content-aware, never
// templated — "3 drafts ready — 1 urgent, 2 routine", "Light day: 2
// drafts", "⚠️ High-risk item needs attention".
//
// JP α: locale-aware. EN remains the canonical wording; JA mirrors the
// same content/tone shifts. Both share the same logic so a switch from
// 'high present' to 'light day' fires identically.
export function buildDigestSubject(
  items: DigestItem[],
  locale: DigestLocale = "en"
): string {
  const high = items.filter((i) => i.riskTier === "high").length;
  const medium = items.filter((i) => i.riskTier === "medium").length;
  const low = items.filter((i) => i.riskTier === "low").length;
  const total = items.length;
  if (locale === "ja") {
    if (total === 0) return "今日は軽め: 0 件";
    if (total === 1 && high === 1) {
      return "⚠️ 要確認の重要項目があります";
    }
    if (high > 0 && total > 1) {
      const routine = medium + low;
      return `緊急 ${high} 件、通常 ${routine} 件 — 登校前にチェック`;
    }
    if (total <= 2) {
      return `今日は軽め: ${total} 件`;
    }
    return `${total} 件の下書きが準備できました`;
  }
  if (total === 0) return "Light day: 0 drafts";
  if (total === 1 && high === 1) {
    return "⚠️ High-risk item needs attention";
  }
  if (high > 0 && total > 1) {
    const routine = medium + low;
    const routineLabel = routine === 1 ? "1 routine" : `${routine} routine`;
    const urgentLabel = high === 1 ? "1 urgent" : `${high} urgent`;
    return `${total} drafts ready — ${urgentLabel}, ${routineLabel}`;
  }
  if (total <= 2) {
    return `Light day: ${total} draft${total === 1 ? "" : "s"}`;
  }
  return `${total} drafts ready`;
}

function riskLabel(tier: "low" | "medium" | "high", locale: DigestLocale): string {
  if (locale === "ja") {
    switch (tier) {
      case "high":
        return "重要";
      case "medium":
        return "通常";
      case "low":
        return "軽め";
    }
  }
  switch (tier) {
    case "high":
      return "HIGH";
    case "medium":
      return "MED";
    case "low":
      return "LOW";
  }
}

export function buildDigestText(args: {
  items: DigestItem[];
  appUrl: string;
  locale?: DigestLocale;
}): string {
  const locale = args.locale ?? "en";
  const lines: string[] = [];
  lines.push(
    locale === "ja"
      ? "Steadii Agent — 朝のダイジェスト"
      : "Steadii Agent — morning digest"
  );
  lines.push("");
  for (const item of args.items) {
    const link = `${args.appUrl}/app/inbox/${item.agentDraftId}?utm_source=digest`;
    lines.push(
      `[${riskLabel(item.riskTier, locale)}] ${item.senderName} — ${item.subject}`
    );
    lines.push(`  → ${link}`);
    lines.push("");
  }
  lines.push(
    locale === "ja"
      ? "Steadiiで内容を確認し、各ドラフトを承認してください。あなたのタップなしには何も送信されません。"
      : "Review + confirm each draft in Steadii. Nothing sends without your tap."
  );
  return lines.join("\n");
}

// Plain-enough HTML. No frameworks; no tracking pixel (memory says "open
// rate" matters but α users are pre-aware of metrics collection — tracking
// pixel lands post-W3 when the dogfood metrics task arrives).
export function buildDigestHtml(args: {
  items: DigestItem[];
  appUrl: string;
  locale?: DigestLocale;
}): string {
  const locale = args.locale ?? "en";
  const reviewLabel = locale === "ja" ? "ドラフトを確認 →" : "Review draft →";
  const titleEyebrow = "Steadii Agent";
  const titleHeading = locale === "ja" ? "朝のダイジェスト" : "Morning digest";
  const footerCopy =
    locale === "ja"
      ? "Steadiiで内容を確認し、各ドラフトを承認してください。あなたのタップなしには何も送信されません。"
      : "Review + confirm each draft in Steadii. Nothing sends without your tap.";

  const rows = args.items
    .map((item) => {
      const link = `${args.appUrl}/app/inbox/${item.agentDraftId}?utm_source=digest`;
      const color =
        item.riskTier === "high"
          ? "#DC2626"
          : item.riskTier === "medium"
          ? "#D97706"
          : "#6E6A64";
      return `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #E4E0DB;">
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; color: #1A1814;">
              <span style="display: inline-block; min-width: 44px; padding: 2px 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.05em; color: #FFFFFF; background: ${color}; border-radius: 3px; margin-right: 8px;">${escapeHtml(
                riskLabel(item.riskTier, locale)
              )}</span>
              <strong>${escapeHtml(item.senderName)}</strong>
            </div>
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #1A1814; margin-top: 4px; margin-left: 52px;">
              ${escapeHtml(item.subject)}
            </div>
            <div style="margin-top: 6px; margin-left: 52px;">
              <a href="${escapeHtmlAttr(link)}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #D97706; text-decoration: none;">${escapeHtml(reviewLabel)}</a>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  return `<!DOCTYPE html>
<html lang="${locale}">
  <body style="margin: 0; padding: 0; background: #FAFAF9;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width: 560px; background: #FFFFFF; border: 1px solid #E4E0DB; border-radius: 8px;">
            <tr>
              <td style="padding: 24px 24px 8px 24px;">
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6E6A64;">${escapeHtml(titleEyebrow)}</div>
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 600; color: #1A1814; margin-top: 4px;">${escapeHtml(titleHeading)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 24px 24px 24px;">
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; color: #6E6A64;">${escapeHtml(footerCopy)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s);
}

// Load the user row + digest items + build subject/body. Returns null when
// there's nothing to send (pending = 0 OR digest_enabled = false).
export async function buildDigestPayload(
  userId: string
): Promise<DigestPayload | null> {
  const [user] = await db
    .select({
      email: users.email,
      digestEnabled: users.digestEnabled,
      preferences: users.preferences,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  if (!user.digestEnabled) return null;

  const items = await loadPendingDigestItems(userId);
  if (items.length === 0) return null;

  const e = env();
  const appUrl = e.APP_URL;
  const locale: DigestLocale =
    user.preferences?.locale === "ja" ? "ja" : "en";
  const subject = buildDigestSubject(items, locale);
  const text = buildDigestText({ items, appUrl, locale });
  const html = buildDigestHtml({ items, appUrl, locale });
  return {
    userEmail: user.email,
    subject,
    text,
    html,
    items,
    highCount: items.filter((i) => i.riskTier === "high").length,
    mediumCount: items.filter((i) => i.riskTier === "medium").length,
    lowCount: items.filter((i) => i.riskTier === "low").length,
  };
}
