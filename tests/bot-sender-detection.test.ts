import { describe, expect, it } from "vitest";
import {
  isBotSender,
  isNoreplySender,
} from "@/lib/agent/email/rules-global";

// Engineer-32 — broader bot-sender detection. Augments isNoreplySender
// with display-name suffixes ([bot], -bot, (bot)), known SaaS bot-relay
// hostnames, and the RFC 3834 Auto-Submitted / legacy Precedence
// headers. The L1 IGNORE rule pairs this with `containsActionVerb` so
// OTP / password-reset bot mail still surfaces; that integration is
// covered in agent-email-rules.test.ts.

describe("isBotSender", () => {
  it("flags noreply local-parts (back-compat with isNoreplySender)", () => {
    // Sanity check that the broader predicate still matches everything
    // the legacy predicate did. isNoreplySender stays exported because
    // existing call-sites + downstream consumers may still depend on
    // the narrow signal.
    const email = "noreply@news.linear.app";
    expect(isNoreplySender(email)).toBe(true);
    expect(
      isBotSender({
        fromEmail: email,
        fromName: "Linear Updates",
      })
    ).toBe(true);
  });

  it("flags GitHub-style [bot] local-parts", () => {
    expect(
      isBotSender({
        fromEmail: "vercel[bot]@somewhere.com",
        fromName: "vercel[bot]",
      })
    ).toBe(true);
    expect(
      isBotSender({
        fromEmail: "dependabot[bot]@some-host.example",
        fromName: null,
      })
    ).toBe(true);
  });

  it("flags known bot-relay hostnames (notifications.github.com)", () => {
    // Display name is human (the comment author); domain is the only
    // signal. This is the false-positive that drove engineer-32.
    expect(
      isBotSender({
        fromEmail: "notifications@github.com",
        fromName: "Sample Sender",
      })
    ).toBe(true);
    expect(
      isBotSender({
        fromEmail: "alert@notifications.slack.com",
        fromName: "Slack",
      })
    ).toBe(true);
  });

  it("flags a human display name when paired with a bot-host domain", () => {
    // The PR-comment relay case: human-looking sender + bot-relay domain
    // → bot. Without the host hint this would slip through.
    expect(
      isBotSender({
        fromEmail: "ryuto@notifications.github.com",
        fromName: "Ryuto Sato",
      })
    ).toBe(true);
  });

  it("flags Auto-Submitted: auto-generated (RFC 3834)", () => {
    expect(
      isBotSender({
        fromEmail: "real.person@startup.com",
        fromName: "Real Person",
        autoSubmittedHeader: "auto-generated",
      })
    ).toBe(true);
    // RFC says only "no" means human-sent — anything else flags.
    expect(
      isBotSender({
        fromEmail: "real.person@startup.com",
        fromName: "Real Person",
        autoSubmittedHeader: "auto-replied",
      })
    ).toBe(true);
    // Header-value matching is case-insensitive + whitespace-tolerant.
    expect(
      isBotSender({
        fromEmail: "real.person@startup.com",
        fromName: "Real Person",
        autoSubmittedHeader: "  Auto-Generated  ",
      })
    ).toBe(true);
  });

  it("flags Precedence: bulk / auto_reply / junk", () => {
    expect(
      isBotSender({
        fromEmail: "newsletter@weeklydigest.com",
        fromName: "Weekly Digest",
        precedenceHeader: "bulk",
      })
    ).toBe(true);
    expect(
      isBotSender({
        fromEmail: "ooo@startup.com",
        fromName: "Out of Office",
        precedenceHeader: "auto_reply",
      })
    ).toBe(true);
  });

  it("does NOT flag a regular human sender", () => {
    expect(
      isBotSender({
        fromEmail: "prof.tanaka@known.edu",
        fromName: "Tanaka Sensei",
        autoSubmittedHeader: "no", // RFC: explicit human-sent
        precedenceHeader: null,
      })
    ).toBe(false);
    expect(
      isBotSender({
        fromEmail: "classmate@example.com",
        fromName: "Classmate",
      })
    ).toBe(false);
  });
});
