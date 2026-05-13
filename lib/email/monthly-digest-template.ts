import "server-only";
import type { MonthlySynthesis } from "@/lib/agent/digest/monthly-synthesis";

// engineer-50 — HTML + text email for the CoS-mode monthly digest.
//
// Mailpit-style: minimal CSS, accessible on mobile, no external assets.
// Renders the synthesis output (oneLineSummary, themes, recommendations,
// driftCallouts). Subject is bilingual-aware via the `locale` field.
//
// Why not reuse the weekly template: weekly is a stats-grid retrospective.
// Monthly is a narrative digest — themes-with-evidence. Different IA
// would force the weekly renderer into a generic shape that helps neither.

export type MonthlyDigestEmailInput = {
  locale: "en" | "ja";
  monthLabel: string;
  synthesis: MonthlySynthesis;
  appUrl: string;
  digestIndexUrl: string;
};

export type MonthlyDigestEmailPayload = {
  subject: string;
  text: string;
  html: string;
};

export function buildMonthlyDigestEmail(
  input: MonthlyDigestEmailInput
): MonthlyDigestEmailPayload {
  const subject = buildSubject(input);
  const text = buildText(input);
  const html = buildHtml(input);
  return { subject, text, html };
}

function buildSubject(input: MonthlyDigestEmailInput): string {
  if (input.locale === "ja") {
    return `Steadii からの月次レビュー — ${input.monthLabel}`;
  }
  return `Your monthly review from Steadii — ${input.monthLabel}`;
}

function buildText(input: MonthlyDigestEmailInput): string {
  const { synthesis, locale } = input;
  const lines: string[] = [];
  lines.push(
    locale === "ja"
      ? `Steadii Chief of Staff — ${input.monthLabel} の振り返り`
      : `Steadii Chief of Staff — ${input.monthLabel} in review`
  );
  lines.push("");

  if (synthesis.oneLineSummary) {
    lines.push(synthesis.oneLineSummary);
    lines.push("");
  }

  if (synthesis.themes.length > 0) {
    lines.push(locale === "ja" ? "今月のテーマ:" : "Themes this month:");
    for (const t of synthesis.themes) {
      lines.push("");
      lines.push(`■ ${t.title}`);
      lines.push(`  ${t.body}`);
      if (t.evidence.length > 0) {
        lines.push(
          locale === "ja"
            ? "  参照:"
            : "  Evidence:"
        );
        for (const e of t.evidence) {
          lines.push(`    - [${e.kind}] ${e.label}`);
        }
      }
    }
    lines.push("");
  }

  if (synthesis.recommendations.length > 0) {
    lines.push(
      locale === "ja" ? "Steadii からの提案:" : "Steadii recommends:"
    );
    for (const r of synthesis.recommendations) {
      lines.push(`  • ${r.action}`);
      lines.push(`    ${r.why}`);
    }
    lines.push("");
  }

  if (synthesis.driftCallouts.length > 0) {
    lines.push(locale === "ja" ? "気になった点:" : "Worth a look:");
    for (const d of synthesis.driftCallouts) {
      lines.push(`  ${severityChar(d.severity)} ${d.callout}`);
    }
    lines.push("");
  }

  const cta = `${input.digestIndexUrl}?utm_source=monthly_digest`;
  lines.push(
    locale === "ja"
      ? `詳細を見る → ${cta}`
      : `See the full digest → ${cta}`
  );
  return lines.join("\n");
}

function buildHtml(input: MonthlyDigestEmailInput): string {
  const { synthesis, locale } = input;
  const titleEyebrow = "Steadii · Chief of Staff";
  const titleHeading =
    locale === "ja"
      ? `${input.monthLabel} の振り返り`
      : `${input.monthLabel} in review`;
  const cta = `${input.digestIndexUrl}?utm_source=monthly_digest`;
  const ctaLabel =
    locale === "ja" ? "詳細を見る →" : "See the full digest →";

  const summaryBlock = synthesis.oneLineSummary
    ? `
        <tr>
          <td style="padding: 0 24px 4px 24px;">
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1A1814;">
              ${escapeHtml(synthesis.oneLineSummary)}
            </div>
          </td>
        </tr>`
    : "";

  const themesBlock =
    synthesis.themes.length > 0
      ? `
        <tr>
          <td style="padding: 16px 24px 0 24px;">
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6E6A64;">
              ${escapeHtml(locale === "ja" ? "今月のテーマ" : "Themes this month")}
            </div>
            ${synthesis.themes.map(themeRow).join("")}
          </td>
        </tr>`
      : "";

  const recsBlock =
    synthesis.recommendations.length > 0
      ? `
        <tr>
          <td style="padding: 16px 24px 0 24px;">
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6E6A64;">
              ${escapeHtml(locale === "ja" ? "Steadii からの提案" : "Steadii recommends")}
            </div>
            <ul style="margin: 8px 0 0 0; padding-left: 20px;">
              ${synthesis.recommendations.map(recommendationRow).join("")}
            </ul>
          </td>
        </tr>`
      : "";

  const driftBlock =
    synthesis.driftCallouts.length > 0
      ? `
        <tr>
          <td style="padding: 16px 24px 0 24px;">
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6E6A64;">
              ${escapeHtml(locale === "ja" ? "気になった点" : "Worth a look")}
            </div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              ${synthesis.driftCallouts.map(driftRow).join("")}
            </table>
          </td>
        </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="${locale}">
  <body style="margin: 0; padding: 0; background: #FAFAF9;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; background: #FFFFFF; border: 1px solid #E4E0DB; border-radius: 8px;">
            <tr>
              <td style="padding: 24px 24px 8px 24px;">
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6E6A64;">${escapeHtml(titleEyebrow)}</div>
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 600; color: #1A1814; margin-top: 4px;">${escapeHtml(titleHeading)}</div>
              </td>
            </tr>
            ${summaryBlock}
            ${themesBlock}
            ${recsBlock}
            ${driftBlock}
            <tr>
              <td style="padding: 24px;">
                <a href="${escapeHtmlAttr(cta)}" style="display: inline-block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 600; color: #FFFFFF; background: #1A1814; padding: 10px 16px; border-radius: 6px; text-decoration: none;">${escapeHtml(ctaLabel)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function themeRow(t: MonthlySynthesis["themes"][number]): string {
  const evidenceRows =
    t.evidence.length > 0
      ? `<ul style="margin: 4px 0 0 0; padding-left: 20px;">${t.evidence
          .map(
            (e) => `
              <li style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; color: #6E6A64; line-height: 1.5;">
                <span style="display: inline-block; padding: 0 6px; margin-right: 4px; border: 1px solid #E4E0DB; border-radius: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">${escapeHtml(e.kind)}</span>
                ${escapeHtml(e.label)}
              </li>`
          )
          .join("")}</ul>`
      : "";
  return `
    <div style="padding: 12px 0; border-bottom: 1px solid #F4F2EE;">
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #1A1814; line-height: 1.4;">
        ${escapeHtml(t.title)}
      </div>
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #1A1814; line-height: 1.5; margin-top: 4px;">
        ${escapeHtml(t.body)}
      </div>
      ${evidenceRows}
    </div>
  `;
}

function recommendationRow(
  r: MonthlySynthesis["recommendations"][number]
): string {
  return `
    <li style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #1A1814; line-height: 1.5; margin-bottom: 8px;">
      <strong>${escapeHtml(r.action)}</strong>
      <div style="font-size: 12px; color: #6E6A64; margin-top: 2px;">
        ${escapeHtml(r.why)}
      </div>
    </li>
  `;
}

function driftRow(d: MonthlySynthesis["driftCallouts"][number]): string {
  const color =
    d.severity === "high"
      ? "#B45309"
      : d.severity === "warn"
        ? "#92400E"
        : "#6E6A64";
  return `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #F4F2EE;">
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: ${color}; line-height: 1.5;">
          <span style="display: inline-block; min-width: 18px; font-weight: 600;">${severityChar(d.severity)}</span>
          ${escapeHtml(d.callout)}
        </div>
      </td>
    </tr>
  `;
}

function severityChar(severity: "info" | "warn" | "high"): string {
  if (severity === "high") return "!";
  if (severity === "warn") return "~";
  return "·";
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
