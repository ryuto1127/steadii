import { notFound } from "next/navigation";
import Link from "next/link";
import { Archive, RotateCcw } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { GmailRevokedBanner } from "@/components/layout/gmail-revoked-banner";
import { OnboardingSkipRecoveryBanner } from "@/components/layout/onboarding-skip-recovery-banner";

// Wave 5 verification harness. Bundles every new UI surface so the
// engineer's screenshot sweep at 1440×900 covers EN + JA in two
// captures (locale toggle controls both renders). Hard-gated behind
// NODE_ENV !== "production".

export const dynamic = "force-dynamic";

export default async function Wave5Preview() {
  if (process.env.NODE_ENV === "production") notFound();

  const tInbox = await getTranslations("inbox");
  const tSettings = await getTranslations("settings");
  const tInboxArchive = await getTranslations(
    "settings.inbox_auto_archive"
  );
  const tProfile = await getTranslations("settings.profile_completion");
  const locale = await getLocale();

  const mockHidden = [
    {
      id: "h-1",
      senderName: "Coursera Newsletter",
      senderEmail: "no-reply@e.coursera.org",
      subject: "Top courses this week",
    },
    {
      id: "h-2",
      senderName: "Notion",
      senderEmail: "team@mail.notion.so",
      subject: "Your weekly digest is ready",
    },
    {
      id: "h-3",
      senderName: "Hackathon Club",
      senderEmail: "hackathon@club.example.org",
      subject: "RSVP for Friday's meetup",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header className="border-b border-[hsl(var(--border))] pb-4">
        <h1 className="font-display text-[hsl(var(--foreground))]">
          Wave 5 preview
        </h1>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          Locale: <code>{locale}</code>. Captures the auto-archive,
          banners, settings, and digest surfaces. Mock data only.
        </p>
      </header>

      <Section heading="Layout banners">
        <GmailRevokedBanner />
        <OnboardingSkipRecoveryBanner />
      </Section>

      <Section heading="Inbox — Hidden filter chip + restore row">
        <nav
          aria-label={tInbox("hidden_filter_aria")}
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          <Link
            href="#"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[12px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]"
          >
            {tInbox("filter_all")}
          </Link>
          <Link
            href="#"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))]"
          >
            <Archive size={11} strokeWidth={1.75} />
            {tInbox("filter_hidden", { n: mockHidden.length })}
          </Link>
        </nav>
        <ul className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          {mockHidden.map((m) => (
            <li key={m.id}>
              <div className="flex min-h-[44px] items-start gap-3 px-3 py-3 sm:px-4">
                <span className="mt-0.5 shrink-0 rounded-full bg-[hsl(var(--surface-raised))] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[hsl(var(--muted-foreground))]">
                  {tInbox("tier_low")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="min-w-0 truncate text-[14px] font-normal text-[hsl(var(--muted-foreground))]">
                      {m.senderName}
                    </span>
                    <span className="ml-auto shrink-0 text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
                      2d
                    </span>
                  </div>
                  <div className="truncate text-[13px] font-normal text-[hsl(var(--muted-foreground))]">
                    {m.subject}
                  </div>
                </div>
              </div>
              <div className="border-t border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))] px-3 py-1.5 sm:px-4">
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md text-[12px] font-medium text-[hsl(var(--primary))]"
                >
                  <RotateCcw size={11} strokeWidth={1.75} />
                  {tInbox("restore_button")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section heading="Settings — Inbox auto-archive toggle (default OFF state)">
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <h2 className="mb-2.5 text-h3 text-[hsl(var(--foreground))]">
            {tInboxArchive("section_title")}
          </h2>
          <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
            {tInboxArchive("description")}
          </p>
          <div className="flex items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2.5">
            <span className="text-body">
              {tInboxArchive("toggle_label")}
            </span>
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center rounded-md border border-[hsl(var(--border))] px-4 text-small font-medium hover:bg-[hsl(var(--surface-raised))]"
            >
              {tInboxArchive("off")}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-[hsl(var(--muted-foreground))]">
            {tInboxArchive("safety_ramp_note")}
          </p>
        </div>
      </Section>

      <Section heading="Settings — Profile completion nudge">
        <div className="rounded-md border border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.04)] p-4">
          <h2 className="mb-2 text-h3 text-[hsl(var(--foreground))]">
            {tProfile("heading")}
          </h2>
          <ul className="space-y-1 text-small text-[hsl(var(--muted-foreground))]">
            <li>• {tProfile("missing_name")}</li>
          </ul>
        </div>
      </Section>

      <Section heading="Home — Recent activity (Type D auto-archive)">
        <ul className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          {[
            "Auto-archived: Coursera Newsletter — Top courses this week",
            "Auto-archived: Notion — Your weekly digest is ready",
            "Auto-archived: LinkedIn — Job alerts for you",
          ].map((line, i) => (
            <li
              key={i}
              className="flex items-center gap-2.5 border-b border-[hsl(var(--border)/0.4)] py-1.5 text-[12px] last:border-b-0"
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Auto-archived
              </span>
              <span className="min-w-0 flex-1 truncate text-[hsl(var(--foreground))]">
                {line}
              </span>
              <time className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
                {i + 1}h
              </time>
            </li>
          ))}
        </ul>
      </Section>

      <Section heading="Digest — 'Steadii hid' section preview">
        <div
          className="overflow-hidden rounded-md border border-[hsl(var(--border))] bg-white"
          style={{ fontFamily: "Helvetica, Arial, sans-serif" }}
        >
          <div className="px-6 pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
              Steadii Agent
            </div>
            <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
              {locale === "ja" ? "朝のダイジェスト" : "Morning digest"}
            </div>
          </div>
          <div className="px-6 pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
              {locale === "ja"
                ? `Steadii が今週 ${mockHidden.length} 件を非表示にしました`
                : `Steadii hid ${mockHidden.length} items this week`}
            </div>
            <ul className="mt-2 divide-y divide-[hsl(var(--border))]">
              {mockHidden.map((m) => (
                <li key={m.id} className="py-2 text-[13px]">
                  <strong>{m.senderName}</strong>
                  <span className="text-[hsl(var(--muted-foreground))]">
                    {" "}
                    — {m.subject}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 pb-6">
              <span className="text-[12px] font-medium text-amber-700">
                {locale === "ja"
                  ? "全件を確認 / 復元 →"
                  : "Review / restore all →"}
              </span>
            </div>
          </div>
        </div>
      </Section>

      <p className="pt-6 text-[11px] text-[hsl(var(--muted-foreground))]">
        Settings link target:{" "}
        <Link
          href="/app/settings"
          className="underline"
        >
          {tSettings("title")}
        </Link>
      </p>
    </div>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {heading}
      </h2>
      {children}
    </section>
  );
}
