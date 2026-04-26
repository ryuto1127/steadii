import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { waitlistRequests } from "@/lib/db/schema";
import { isUnlimitedPlan } from "@/lib/billing/effective-plan";
import { SyncCard } from "./sync-card";
import { WaitlistTable, type Tab, type WaitlistRow } from "./waitlist-table";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ tab?: string }>;

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved_unsynced", label: "Approved (not synced)" },
  { key: "approved_synced", label: "Approved (synced)" },
  { key: "denied", label: "Denied" },
  { key: "all", label: "All" },
];

export default async function AdminWaitlistPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = await isUnlimitedPlan(session.user.id);
  if (!isAdmin) notFound();

  const { tab: rawTab } = await searchParams;
  const tab: Tab = isTab(rawTab) ? rawTab : "pending";

  const counts = await loadCounts();
  const rows = await loadRows(tab);
  const approvedUnsyncedEmails = await loadApprovedUnsyncedEmails();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-baseline justify-between">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">
          α access waitlist
        </h1>
        <Link
          href="/app/admin"
          className="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
        >
          ← Admin home
        </Link>
      </div>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Public form lives at{" "}
        <Link href="/request-access" className="underline">
          /request-access
        </Link>
        . Approval generates a Stripe Promotion Code under{" "}
        <code className="rounded bg-[hsl(var(--surface-raised))] px-1 font-mono text-xs">
          STEADII_FRIEND_3MO
        </code>{" "}
        and emails the invite URL via Resend.
      </p>

      <section className="mt-6">
        <SyncCard emails={approvedUnsyncedEmails} />
      </section>

      <nav className="mt-8 flex flex-wrap gap-1 border-b border-[hsl(var(--border))]">
        {TABS.map((t) => {
          const active = t.key === tab;
          const count = counts[t.key];
          return (
            <Link
              key={t.key}
              href={`/app/admin/waitlist?tab=${t.key}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-hover ${
                active
                  ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]"
                  : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              }`}
            >
              {t.label}
              <span className="ml-2 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      <section className="mt-6">
        <WaitlistTable rows={rows} tab={tab} />
      </section>
    </div>
  );
}

function isTab(value: string | undefined): value is Tab {
  return (
    value === "pending" ||
    value === "approved_unsynced" ||
    value === "approved_synced" ||
    value === "denied" ||
    value === "all"
  );
}

async function loadCounts(): Promise<Record<Tab, number>> {
  const all = await db
    .select({
      status: waitlistRequests.status,
      googleTestUserAddedAt: waitlistRequests.googleTestUserAddedAt,
    })
    .from(waitlistRequests);

  const counts: Record<Tab, number> = {
    pending: 0,
    approved_unsynced: 0,
    approved_synced: 0,
    denied: 0,
    all: all.length,
  };
  for (const r of all) {
    if (r.status === "pending") counts.pending++;
    else if (r.status === "denied") counts.denied++;
    else if (r.status === "approved") {
      if (r.googleTestUserAddedAt) counts.approved_synced++;
      else counts.approved_unsynced++;
    }
  }
  return counts;
}

async function loadRows(tab: Tab): Promise<WaitlistRow[]> {
  const base = db
    .select()
    .from(waitlistRequests)
    .orderBy(desc(waitlistRequests.requestedAt));

  let rows;
  if (tab === "pending") {
    rows = await base
      .where(eq(waitlistRequests.status, "pending"))
      .limit(200);
  } else if (tab === "denied") {
    rows = await base.where(eq(waitlistRequests.status, "denied")).limit(200);
  } else if (tab === "approved_unsynced") {
    rows = await base
      .where(
        and(
          eq(waitlistRequests.status, "approved"),
          isNull(waitlistRequests.googleTestUserAddedAt)
        )
      )
      .limit(200);
  } else if (tab === "approved_synced") {
    rows = await base
      .where(
        and(
          eq(waitlistRequests.status, "approved"),
          isNotNull(waitlistRequests.googleTestUserAddedAt)
        )
      )
      .limit(200);
  } else {
    rows = await base.limit(200);
  }

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    university: r.university,
    reason: r.reason,
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    emailSentAt: r.emailSentAt ? r.emailSentAt.toISOString() : null,
    googleTestUserAddedAt: r.googleTestUserAddedAt
      ? r.googleTestUserAddedAt.toISOString()
      : null,
    inviteUrl: r.inviteUrl,
    stripePromotionCode: r.stripePromotionCode,
  }));
}

async function loadApprovedUnsyncedEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: waitlistRequests.email })
    .from(waitlistRequests)
    .where(
      and(
        eq(waitlistRequests.status, "approved"),
        isNull(waitlistRequests.googleTestUserAddedAt)
      )
    )
    .orderBy(desc(waitlistRequests.approvedAt));
  return rows.map((r) => r.email);
}
