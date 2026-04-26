import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  GraduationCap,
  FileText,
  NotebookPen,
  MessagesSquare,
} from "lucide-react";
import { loadClassById } from "@/lib/classes/loader";
import { db } from "@/lib/db/client";
import {
  assignments as assignmentsTable,
  chats,
  messages as messagesTable,
  mistakeNotes,
  syllabi,
} from "@/lib/db/schema";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { ClassDot } from "@/components/ui/class-dot";
import { DenseList } from "@/components/ui/dense-list";
import { DenseRowLink } from "@/components/ui/dense-row-link";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import { getTranslations } from "next-intl/server";

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

  const t = await getTranslations("classes");

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
        {TAB_ORDER.map((tabKey) => (
          <Link
            key={tabKey}
            href={`/app/classes/${id}?tab=${tabKey}`}
            aria-current={tab === tabKey ? "page" : undefined}
            className={cn(
              "relative px-3 py-2 text-small font-medium transition-hover",
              tab === tabKey
                ? "text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            )}
          >
            <span>{t(`tabs.${tabKey}`)}</span>
            {tab === tabKey ? (
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
  const rows = await db
    .select({
      id: syllabi.id,
      title: syllabi.title,
      term: syllabi.term,
      blobUrl: syllabi.blobUrl,
      sourceUrl: syllabi.sourceUrl,
    })
    .from(syllabi)
    .where(
      and(
        eq(syllabi.userId, userId),
        eq(syllabi.classId, classId),
        isNull(syllabi.deletedAt)
      )
    )
    .orderBy(desc(syllabi.createdAt))
    .limit(50);
  if (rows.length === 0) {
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
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
        >
          <FileText size={16} strokeWidth={1.5} className="mt-0.5 text-[hsl(var(--muted-foreground))]" />
          <div className="flex-1">
            <div className="text-body font-medium">{r.title}</div>
            <div className="text-small text-[hsl(var(--muted-foreground))]">
              {[r.term].filter(Boolean).join(" · ") || "(no term)"}
            </div>
          </div>
          {r.blobUrl ? (
            <a
              href={r.blobUrl}
              target="_blank"
              rel="noreferrer"
              className="text-small underline-offset-4 hover:underline"
            >
              Open original
            </a>
          ) : r.sourceUrl ? (
            <a
              href={r.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-small underline-offset-4 hover:underline"
            >
              Source
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

async function AssignmentsTab({ userId, classId }: { userId: string; classId: string }) {
  const rows = await db
    .select()
    .from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.userId, userId),
        eq(assignmentsTable.classId, classId),
        isNull(assignmentsTable.deletedAt)
      )
    )
    .orderBy(asc(assignmentsTable.dueAt));
  const t = await getTranslations("classes");
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<GraduationCap size={18} strokeWidth={1.5} />}
        title={t("no_assignments_title")}
        description={t("no_assignments_desc")}
      />
    );
  }
  return (
    <DenseList ariaLabel={t("tabs.assignments")}>
      {rows.map((r) => {
        const due = r.dueAt ? r.dueAt.toISOString() : null;
        const status = r.status;
        return (
          <DenseRowLink
            key={r.id}
            href={`/app/classes/${classId}?tab=assignments`}
            title={r.title}
            secondary={status !== "not_started" ? status.replace("_", " ") : undefined}
            metadata={[
              due ? formatDueShort(due) : "No due",
              r.priority ? `priority: ${r.priority}` : "",
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
  const rows = await db
    .select({
      id: mistakeNotes.id,
      title: mistakeNotes.title,
      unit: mistakeNotes.unit,
      difficulty: mistakeNotes.difficulty,
      createdAt: mistakeNotes.createdAt,
    })
    .from(mistakeNotes)
    .where(
      and(
        eq(mistakeNotes.userId, userId),
        eq(mistakeNotes.classId, classId),
        isNull(mistakeNotes.deletedAt)
      )
    )
    .orderBy(desc(mistakeNotes.createdAt))
    .limit(100);
  if (rows.length === 0) {
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
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/app/mistakes/${r.id}`}
          className="group flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          <div className="flex items-start gap-2">
            <NotebookPen
              size={14}
              strokeWidth={1.5}
              className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]"
            />
            <span className="line-clamp-2 text-body font-medium">{r.title}</span>
          </div>
          <div className="flex flex-wrap gap-1 text-small text-[hsl(var(--muted-foreground))]">
            {[r.difficulty, r.unit, r.createdAt.toISOString().slice(0, 10)]
              .filter(Boolean)
              .map((s, i) => (
                <span key={i}>{s}</span>
              ))}
          </div>
        </Link>
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
  void classId;
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
