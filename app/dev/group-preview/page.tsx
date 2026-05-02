import { notFound } from "next/navigation";
import { GroupDetailClient } from "@/app/app/groups/[id]/client";

// Wave 3.2 verification harness — renders the group detail page with
// hardcoded mock data so engineer-side screenshots can capture every
// member-status / draft-flow variant in one sweep at 1440×900.
//
// Hard-gated behind NODE_ENV !== "production" so this route never leaks.

export const dynamic = "force-dynamic";

const NOW = new Date();
const D = (mins: number) =>
  new Date(NOW.getTime() - mins * 60 * 1000).toISOString();

export default async function GroupPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 md:px-10 md:py-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          PSY100 · Group project
        </p>
        <h1 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-[hsl(var(--foreground))] md:text-[28px]">
          PSY100 group thread
        </h1>
        <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
          Deadline: Fri, May 16
        </p>
      </header>
      <GroupDetailClient
        userId="00000000-0000-0000-0000-000000000001"
        groupId="00000000-0000-0000-0000-000000000010"
        groupTitle="PSY100 group thread"
        className="PSY100 — Foundations of Psychology"
        members={[
          {
            email: "jane.smith@u.toronto.ca",
            name: "Jane Smith",
            role: "lead",
            status: "silent",
            lastMessageAt: D(60 * 24 * 14),
            lastRespondedAt: D(60 * 24 * 14),
          },
          {
            email: "bob.lee@u.toronto.ca",
            name: "Bob Lee",
            role: "researcher",
            status: "active",
            lastMessageAt: D(60 * 24 * 2),
            lastRespondedAt: D(60 * 24 * 1),
          },
          {
            email: "carlos.r@u.toronto.ca",
            name: "Carlos R.",
            role: "writer",
            status: "active",
            lastMessageAt: D(60 * 24 * 4),
            lastRespondedAt: D(60 * 24 * 3),
          },
        ]}
        tasks={[
          {
            id: "t1",
            title: "Draft chapter 4 case study outline",
            assigneeEmail: "jane.smith@u.toronto.ca",
            due: D(-60 * 48),
            doneAt: null,
          },
          {
            id: "t2",
            title: "Compile reading list",
            assigneeEmail: "bob.lee@u.toronto.ca",
            due: null,
            doneAt: D(60 * 24),
          },
          {
            id: "t3",
            title: "Review Carlos's draft introduction",
            assigneeEmail: null,
            due: null,
            doneAt: null,
          },
        ]}
        sourceThreadIds={["thread:18a2c0...", "thread:18b1e9..."]}
      />
    </div>
  );
}
