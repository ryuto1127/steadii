import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, GraduationCap, FileText, NotebookPen, MessagesSquare } from "lucide-react";
import { loadClassById } from "@/lib/classes/loader";
import {
  listFromDatabase,
  getTitle,
  getRichText,
  getSelect,
  getDate,
  getRelationIds,
} from "@/lib/views/notion-list";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { ClassDot } from "@/components/ui/class-dot";
import { DenseList } from "@/components/ui/dense-list";
import { DenseRowLink } from "@/components/ui/dense-row-link";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

type Tab = "syllabus" | "assignments" | "mistakes" | "chats";

const TAB_ORDER: Tab[] = ["syllabus", "assignments", "mistakes", "chats"];

function toTab(v: string | undefined): Tab {
  if (v && (TAB_ORDER as string[]).includes(v)) return v as Tab;
  return "syllabus";
}

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = toTab(tabParam);

  const cls = await loadClassById(userId, id);
  if (!cls) notFound();

  return (
    <div className="mx-auto max-w-4xl py-6">
      <header className="flex items-start gap-4 pb-4">
        <ClassDot color={cls.color} size={10} />
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-h1 text-[hsl(var(--foreground))]">{cls.name}</h1>
            {cls.code ? (
              <span className="font-mono text-small text-[hsl(var(--muted-foreground))]">
                {cls.code}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
            {[cls.professor, cls.term].filter(Boolean).join(" · ") || "No term set"}
          </p>
        </div>
      </header>

      <nav className="flex items-center gap-1 border-b border-[hsl(var(--border))]">
        {TAB_ORDER.map((t) => (
          <Link
            key={t}
            href={`/app/classes/${id}?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "relative px-3 py-2 text-small font-medium transition-hover",
              tab === t
                ? "text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            )}
          >
            <span className="capitalize">{t}</span>
            {tab === t ? (
              <span
                aria-hidden
                className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-[hsl(var(--primary))]"
              />
            ) : null}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "syllabus" ? (
          <SyllabusTab userId={userId} classId={id} classCode={cls.code ?? cls.name} />
        ) : tab === "assignments" ? (
          <AssignmentsTab userId={userId} classId={id} />
        ) : tab === "mistakes" ? (
          <MistakesTab userId={userId} classId={id} classCode={cls.code ?? cls.name} />
        ) : (
          <ChatsTab userId={userId} classId={id} />
        )}
      </div>
    </div>
  );
}

async function SyllabusTab({
  userId,
  classId,
  classCode,
}: {
  userId: string;
  classId: string;
  classCode: string;
}) {
  const rows = await listFromDatabase({
    userId,
    databaseSelector: "syllabiDbId",
    limit: 50,
  });
  const scoped = rows.filter((r) => getRelationIds(r, "Class").includes(classId));
  if (scoped.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={18} strokeWidth={1.5} />}
        title={`No syllabus saved for ${classCode}.`}
        description="Drop a PDF, paste a URL, or upload an image and Steadii will extract the structure."
        actions={[
          { label: "Upload PDF", href: "/app/syllabus/new" },
          { label: "Paste URL", href: "/app/syllabus/new" },
        ]}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {scoped.map((r) => (
        <a
          key={r.id}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          <FileText size={16} strokeWidth={1.5} className="mt-0.5 text-[hsl(var(--muted-foreground))]" />
          <div className="flex-1">
            <div className="text-body font-medium">{getTitle(r)}</div>
            <div className="text-small text-[hsl(var(--muted-foreground))]">
              {[getRichText(r, "Term")].filter(Boolean).join(" · ") || "(no term)"}
            </div>
          </div>
          <ExternalLink size={14} strokeWidth={1.5} className="text-[hsl(var(--muted-foreground))]" />
        </a>
      ))}
    </div>
  );
}

async function AssignmentsTab({ userId, classId }: { userId: string; classId: string }) {
  const rows = await listFromDatabase({
    userId,
    databaseSelector: "assignmentsDbId",
    limit: 100,
  });
  const scoped = rows.filter((r) => getRelationIds(r, "Class").includes(classId));
  if (scoped.length === 0) {
    return (
      <EmptyState
        icon={<GraduationCap size={18} strokeWidth={1.5} />}
        title="No assignments yet."
        description="Ask Steadii to add one from chat, e.g. '物理の課題を追加して'."
      />
    );
  }
  const sorted = scoped.sort((a, b) => {
    const ad = getDate(a, "Due") ?? "";
    const bd = getDate(b, "Due") ?? "";
    return ad.localeCompare(bd);
  });
  return (
    <DenseList ariaLabel="Assignments">
      {sorted.map((r) => {
        const due = getDate(r, "Due");
        const status = getSelect(r, "Status") ?? "Not started";
        const priority = getSelect(r, "Priority");
        return (
          <DenseRowLink
            key={r.id}
            href={r.url}
            title={getTitle(r)}
            secondary={status !== "Not started" ? status : undefined}
            metadata={[
              due ? formatDueShort(due) : "No due",
              priority ? `priority: ${priority}` : "",
            ].filter(Boolean)}
          />
        );
      })}
    </DenseList>
  );
}

async function MistakesTab({
  userId,
  classId,
  classCode,
}: {
  userId: string;
  classId: string;
  classCode: string;
}) {
  const rows = await listFromDatabase({
    userId,
    databaseSelector: "mistakesDbId",
    limit: 100,
  });
  const scoped = rows.filter((r) => getRelationIds(r, "Class").includes(classId));
  if (scoped.length === 0) {
    return (
      <EmptyState
        icon={<NotebookPen size={18} strokeWidth={1.5} />}
        title={`No mistake notes for ${classCode} yet.`}
        description="Paste a problem image in chat and ask for an explanation to start your mistake notebook."
        actions={[{ label: "Open chat", href: "/app" }]}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {scoped.map((r) => (
        <a
          key={r.id}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="group flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          <div className="flex items-start gap-2">
            <NotebookPen
              size={14}
              strokeWidth={1.5}
              className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]"
            />
            <span className="line-clamp-2 text-body font-medium">{getTitle(r)}</span>
          </div>
          <div className="flex flex-wrap gap-1 text-small text-[hsl(var(--muted-foreground))]">
            {[
              getSelect(r, "Difficulty"),
              getRichText(r, "Unit"),
              getDate(r, "Date"),
            ]
              .filter(Boolean)
              .map((s, i) => (
                <span key={i}>{s}</span>
              ))}
          </div>
        </a>
      ))}
    </div>
  );
}

async function ChatsTab({ userId, classId }: { userId: string; classId: string }) {
  // Heuristic: chat is "tagged with a class" if its first user message mentions
  // the class id, or any assistant tool call references this classId. For α we
  // approximate by surfacing chats that contain the classId substring in any
  // message content.
  const recent = await db
    .select()
    .from(chats)
    .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)))
    .orderBy(desc(chats.updatedAt))
    .limit(200);
  if (recent.length === 0) {
    return (
      <EmptyState
        icon={<MessagesSquare size={18} strokeWidth={1.5} />}
        title="No chats tagged to this class yet."
        description="Start a chat and Steadii will auto-tag when you mention the class."
        actions={[{ label: "Start a chat", href: "/app" }]}
      />
    );
  }
  const ids = recent.map((c) => c.id);
  const tagged = await db
    .select({ chatId: messagesTable.chatId })
    .from(messagesTable)
    .where(inArray(messagesTable.chatId, ids));
  const chatIdsWithClass = new Set(
    tagged
      .filter((m) => (m as unknown as { chatId: string }).chatId)
      .map((m) => m.chatId)
  );
  const matching = recent.filter((c) => chatIdsWithClass.has(c.id));
  if (matching.length === 0) {
    return (
      <EmptyState
        icon={<MessagesSquare size={18} strokeWidth={1.5} />}
        title="No chats tagged to this class yet."
        description="Start a chat and Steadii will auto-tag when you mention the class."
        actions={[{ label: "Start a chat", href: "/app" }]}
      />
    );
  }
  return (
    <DenseList ariaLabel="Chats for this class">
      {matching.slice(0, 20).map((c) => (
        <DenseRowLink
          key={c.id}
          href={`/app/chat/${c.id}`}
          title={c.title ?? "Untitled chat"}
          metadata={[c.updatedAt.toLocaleDateString()]}
        />
      ))}
    </DenseList>
  );
}

function formatDueShort(iso: string): string {
  try {
    const d = new Date(iso);
    return `due ${d.toLocaleDateString()}`;
  } catch {
    return iso;
  }
}
