import { describe, expect, it } from "vitest";

import { detectScheduledEvent } from "@/lib/agent/proactive/event-detector";

// 2026-05-27 — one-sided scheduled-event detector. STRUCTURED-SIGNAL-
// ONLY (high precision). Must fire on registration/confirmation mails
// with a labeled Date/Time block OR a confirmation phrase + a TIMED
// date; must NOT fire on date-only mails (deadline territory), promos,
// or past-dated recaps. All fixtures SYNTHETIC.

// A fixed "now" well before the synthetic October 2026 events so they
// read as upcoming. Use the email's received instant for past-date math.
const RECEIVED_MS = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01

describe("detectScheduledEvent — positive cases", () => {
  it("fires on a webinar confirmation with a labeled Date/Time block", () => {
    const body = [
      "Thanks for signing up — you've registered for our session.",
      "",
      "Date: Thursday, October 8, 2026",
      "Time: 4:00 PM - 5:00 PM Eastern Time",
      "",
      "A join link will follow closer to the date.",
    ].join("\n");
    const r = detectScheduledEvent({
      body,
      subject: "Intro to Systems webinar — registration",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(true);
    expect(r.event?.date).toBe("2026-10-08");
    expect(r.event?.startTime).toBe("16:00");
    expect(r.event?.timezone).toBe("America/New_York");
    expect(r.event?.durationMin).toBe(60);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("fires on an appointment confirmation phrase + inline date/time", () => {
    const body =
      "Your appointment is confirmed for October 9, 2026 at 10:30 AM. See you then.";
    const r = detectScheduledEvent({
      body,
      subject: "Advising appointment confirmation",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(true);
    expect(r.event?.date).toBe("2026-10-09");
    expect(r.event?.startTime).toBe("10:30");
    expect(r.event?.durationMin).toBe(60); // no range → default 60
  });

  it("uses the subject as the event topic", () => {
    const body =
      "Your booking is confirmed for October 9, 2026 at 9:00 AM EST.";
    const r = detectScheduledEvent({
      body,
      subject: "Re: Campus tour booking",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.event?.topic).toBe("Campus tour booking");
  });

  it("fires on a JA registration-complete confirmation", () => {
    const body = [
      "登録完了のお知らせです。",
      "日時: 2026/10/8 16:00",
      "オンラインで実施します。",
    ].join("\n");
    const r = detectScheduledEvent({
      body,
      subject: "セミナー登録",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(true);
    expect(r.event?.date).toBe("2026-10-08");
    expect(r.event?.startTime).toBe("16:00");
    expect(r.event?.timezone).toBe("Asia/Tokyo");
  });

  // REGRESSION (PROMO_STRUCTURED_BLOCK_BYPASS): a legit bulk event
  // confirmation that carries an unsubscribe footer must STILL fire. The
  // distinguishing signal is commerce intent, not bulk-send — suppressing
  // on the unsubscribe footer alone would kill the exact mails this
  // feature exists to catch. No commerce lexicon here, so it fires.
  it("STILL fires on a bulk event confirmation that has an unsubscribe footer", () => {
    const body = [
      "You're registered for the Intro to Systems webinar.",
      "",
      "Date: Thursday, October 8, 2026",
      "Time: 4:00 PM - 5:00 PM Eastern Time",
      "",
      "We look forward to seeing you there.",
      "Unsubscribe from event emails.",
    ].join("\n");
    const r = detectScheduledEvent({
      body,
      subject: "Campus Events — webinar registration confirmed",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(true);
    expect(r.signals.looksPromotional).toBe(false);
    expect(r.event?.date).toBe("2026-10-08");
    expect(r.event?.startTime).toBe("16:00");
    expect(r.event?.timezone).toBe("America/New_York");
    expect(r.event?.durationMin).toBe(60);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe("detectScheduledEvent — suppression cases (precision)", () => {
  it("does NOT fire when there's a date but NO time (deadline territory)", () => {
    const body =
      "You've registered for our session, which takes place on October 8, 2026.";
    const r = detectScheduledEvent({
      body,
      subject: "Registration confirmed",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/no parseable date paired with a start time/);
  });

  it("does NOT fire on a promo/newsletter with date+time but no structured block", () => {
    const body = [
      "Don't miss our biggest sale of the year on October 8, 2026 at 9:00 AM!",
      "Shop early for the best deals.",
      "",
      "To stop receiving these emails, unsubscribe here.",
    ].join("\n");
    const r = detectScheduledEvent({
      body,
      subject: "Mega Sale starts soon",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(false);
  });

  // Hole #1 (PROMO_STRUCTURED_BLOCK_BYPASS): a marketing email that
  // carries a real labeled Date:/Time: block (a sales livestream / product
  // launch) used to bypass the old guard, which was ANDed with
  // !hasLabeledBlock. Commerce intent now suppresses regardless of the
  // block.
  it("does NOT fire on a promo that HAS a labeled Date/Time block + commerce lexicon", () => {
    const body = [
      "Mega Sale livestream — our biggest event of the year!",
      "",
      "Date: Thursday, October 8, 2026",
      "Time: 9:00 AM - 10:00 AM Eastern Time",
      "",
      "50% off everything — shop now before it's gone.",
      "Unsubscribe here.",
    ].join("\n");
    const r = detectScheduledEvent({
      body,
      subject: "Mega Sale livestream",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(false);
    expect(r.signals.looksPromotional).toBe(true);
    expect(r.reasoning).toMatch(/commerce\/purchase intent/);
  });

  // Hole #2 (PROMO_STRUCTURED_BLOCK_BYPASS): a promo with a bare "join the
  // webinar" CTA — no registration context, no labeled block, no
  // unsubscribe footer — used to fire at ~0.8 because the generic CTA was
  // in CONFIRMATION_PHRASE_RE and the old promo guard needed an
  // unsubscribe footer. The CTA is now dropped from the phrase set, so the
  // mail carries no structured signal at all.
  it("does NOT fire on a bare 'join the webinar' CTA promo (no registration context)", () => {
    const body = [
      "Big ideas await — join the webinar on October 8, 2026 at 9:00 AM Eastern Time!",
      "Reserve your spot today.",
    ].join("\n");
    const r = detectScheduledEvent({
      body,
      subject: "You won't want to miss this webinar",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/no structured signal/);
  });

  it("does NOT fire on a plain mail with neither labeled block nor confirmation phrase", () => {
    const body =
      "Hope you're doing well. Let's grab coffee October 8, 2026 around 4:00 PM if you're free?";
    const r = detectScheduledEvent({
      body,
      subject: "Catching up",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/no structured signal/);
  });

  it("does NOT fire on a past-dated event (recap/receipt)", () => {
    const body = [
      "Thanks for attending — your appointment is confirmed below.",
      "Date: September 2, 2026",
      "Time: 4:00 PM Eastern Time",
    ].join("\n");
    const r = detectScheduledEvent({
      body,
      subject: "Visit summary",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS, // received 2026-10-01, event 2026-09-02 → past
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/before the email's received date/);
  });

  it("does NOT fire when the date/time appears only in quoted history", () => {
    const body = [
      "Thanks for the note below.",
      "",
      "> Your appointment is confirmed for October 8, 2026 at 4:00 PM.",
      "",
      "I'll follow up separately.",
    ].join("\n");
    const r = detectScheduledEvent({
      body,
      subject: "Re: Appointment",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/quoted history/);
  });

  it("returns confirmed=false on empty body", () => {
    const r = detectScheduledEvent({
      body: "",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      nowMs: RECEIVED_MS,
    });
    expect(r.confirmed).toBe(false);
  });
});
