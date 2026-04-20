import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function LandingPage() {
  const t = await getTranslations();

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-[15px] font-semibold tracking-tight">
          Steadii
        </span>
        <Link
          href="/login"
          className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          {t("landing.sign_in")}
        </Link>
      </nav>

      <main className="mx-auto max-w-5xl px-6">
        <header className="flex flex-col items-start gap-6 pt-16 pb-24 md:pt-24">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            {t("landing.alpha")}
          </p>
          <h1 className="font-display text-[44px] leading-[1.05] tracking-tight text-[hsl(var(--foreground))] md:text-[56px]">
            {t("landing.headline")}
          </h1>
          <p className="max-w-xl text-body text-[hsl(var(--muted-foreground))]">
            {t("landing.subhead")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <Link
              href="/login"
              className="inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
            >
              {t("landing.cta")}
            </Link>
            <span className="text-small text-[hsl(var(--muted-foreground))]">
              {t("landing.invite_hint")}
            </span>
          </div>
        </header>

        <section className="mb-20 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
          <Screenshot
            labels={{
              todaySchedule: t("landing.mock.today_schedule"),
              dueSoon: t("landing.mock.due_soon"),
              pastWeek: t("landing.mock.past_week"),
              pastWeekWindow: t("landing.mock.past_week_window"),
              pastWeekCounts: t("landing.mock.past_week_counts", {
                chats: "12",
                mistakes: "7",
                syllabi: "2",
              }),
              pastWeekPattern: t("landing.mock.past_week_pattern"),
              csc108: t("landing.mock.csc108_lecture"),
              officeHours: t("landing.mock.office_hours"),
              mat135Tut: t("landing.mock.mat135_tutorial"),
              physicsPs4: t("landing.mock.physics_ps4"),
              essay: t("landing.mock.essay_outline"),
              mat135Hw: t("landing.mock.mat135_hw"),
              in14h: t("landing.mock.in_14h"),
              in2d: t("landing.mock.in_2d"),
              in3d: t("landing.mock.in_3d"),
            }}
          />
        </section>

        <section className="mb-24 grid gap-10 md:grid-cols-3">
          <ValueProp
            title={t("landing.value_props.conversation.title")}
            body={t("landing.value_props.conversation.body")}
          />
          <ValueProp
            title={t("landing.value_props.notion.title")}
            body={t("landing.value_props.notion.body")}
          />
          <ValueProp
            title={t("landing.value_props.verbatim.title")}
            body={t("landing.value_props.verbatim.body")}
          />
        </section>

        <footer className="flex flex-wrap gap-6 pb-12 text-small text-[hsl(var(--muted-foreground))]">
          <Link
            href="/privacy"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("landing.footer.privacy")}
          </Link>
          <Link
            href="/terms"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("landing.footer.terms")}
          </Link>
          <a
            href="mailto:hello@mysteadii.xyz"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("landing.footer.contact")}
          </a>
          <span className="ml-auto font-mono text-[11px]">
            {t("landing.footer.subject_to_change")}
          </span>
        </footer>
      </main>
    </div>
  );
}

function ValueProp({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-h3 text-[hsl(var(--foreground))]">{title}</h3>
      <p className="mt-1.5 text-small text-[hsl(var(--muted-foreground))]">
        {body}
      </p>
    </div>
  );
}

type ScreenshotLabels = {
  todaySchedule: string;
  dueSoon: string;
  pastWeek: string;
  pastWeekWindow: string;
  pastWeekCounts: string;
  pastWeekPattern: string;
  csc108: string;
  officeHours: string;
  mat135Tut: string;
  physicsPs4: string;
  essay: string;
  mat135Hw: string;
  in14h: string;
  in2d: string;
  in3d: string;
};

function Screenshot({ labels }: { labels: ScreenshotLabels }) {
  return (
    <div className="rounded-lg bg-[hsl(var(--background))] p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MockCard title={labels.todaySchedule}>
          <MockRow time="09:00 — 10:30" label={labels.csc108} />
          <MockRow time="11:00 — 12:00" label={labels.officeHours} />
          <MockRow time="14:00 — 15:30" label={labels.mat135Tut} />
        </MockCard>
        <MockCard title={labels.dueSoon}>
          <MockRow dot="orange" label={labels.physicsPs4} right={labels.in14h} />
          <MockRow dot="blue" label={labels.essay} right={labels.in2d} />
          <MockRow dot="green" label={labels.mat135Hw} right={labels.in3d} />
        </MockCard>
        <MockCard title={labels.pastWeek}>
          <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {labels.pastWeekWindow}
          </p>
          <p className="mt-1.5 text-small">{labels.pastWeekCounts}</p>
          <p className="mt-1.5 text-small text-[hsl(var(--muted-foreground))]">
            {labels.pastWeekPattern}
          </p>
        </MockCard>
      </div>
    </div>
  );
}

function MockCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <p className="mb-2 text-h3 text-[hsl(var(--foreground))]">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function MockRow({
  time,
  label,
  dot,
  right,
}: {
  time?: string;
  label: string;
  dot?: "orange" | "blue" | "green";
  right?: string;
}) {
  const dotHex = dot === "orange" ? "#F97316" : dot === "blue" ? "#3B82F6" : "#10B981";
  return (
    <div className="flex items-baseline gap-2 text-small">
      {dot ? (
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotHex }}
        />
      ) : null}
      {time ? (
        <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
          {time}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right ? (
        <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
          {right}
        </span>
      ) : null}
    </div>
  );
}
