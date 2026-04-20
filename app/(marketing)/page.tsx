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
          Sign in
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
              Invite-only during α.
            </span>
          </div>
        </header>

        <section className="mb-20 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
          <Screenshot />
        </section>

        <section className="mb-24 grid gap-10 md:grid-cols-3">
          <ValueProp
            title="One conversation"
            body="Ask Steadii anything about your classes. It reads Notion and your calendar, then answers."
          />
          <ValueProp
            title="Notion-native"
            body="Your mistakes, syllabi, and assignments live in your own Notion. Steadii organizes, never locks in."
          />
          <ValueProp
            title="Verbatim by default"
            body="Original PDFs and full source text are kept with every syllabus — no lossy summaries."
          />
        </section>

        <footer className="flex flex-wrap gap-6 pb-12 text-small text-[hsl(var(--muted-foreground))]">
          <Link
            href="/privacy"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            Terms
          </Link>
          <a
            href="mailto:hello@mysteadii.xyz"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            Contact
          </a>
          <span className="ml-auto font-mono text-[11px]">α · subject to change</span>
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

// Dashboard mock that works without images. Renders three cards (schedule,
// due, past week) to give landing visitors a feel for the product. When a
// real screenshot is ready, swap the <Screenshot /> body for an <Image />.
function Screenshot() {
  return (
    <div className="rounded-lg bg-[hsl(var(--background))] p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MockCard title="Today's schedule">
          <MockRow time="09:00 — 10:30" label="CSC108 lecture" />
          <MockRow time="11:00 — 12:00" label="Office hours" />
          <MockRow time="14:00 — 15:30" label="MAT135 tutorial" />
        </MockCard>
        <MockCard title="Due soon">
          <MockRow dot="orange" label="Physics PS 4" right="in 14h" />
          <MockRow dot="blue" label="Essay outline" right="in 2d" />
          <MockRow dot="green" label="MAT135 HW" right="in 3d" />
        </MockCard>
        <MockCard title="Past week">
          <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            4/13 — 4/20
          </p>
          <p className="mt-1.5 text-small">
            <span className="tabular-nums">12</span> chats ·{" "}
            <span className="tabular-nums">7</span> mistakes ·{" "}
            <span className="tabular-nums">2</span> syllabi
          </p>
          <p className="mt-1.5 text-small text-[hsl(var(--muted-foreground))]">
            自由落下問題で3回詰まりました
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
