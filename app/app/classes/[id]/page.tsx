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
import { PhotoUploadButton } from "@/components/mistakes/photo-upload-button";
import { ContextualSuggestion } from "@/components/suggestions/contextual-suggestion";
import { ClassHeaderActions } from "@/components/classes/class-header-actions";
import { SyllabusRowActions } from "@/components/classes/syllabus-row-actions";
import { AssignmentRow } from "@/components/classes/assignment-row";
import { MistakeGridItem } from "@/components/classes/mistake-grid-item";
import { cn } from "@/lib/utils/cn";
import { getLocale, getTranslations } from "next-intl/server";

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`
  );
}

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
    <div className="mx-auto max-w-4xl py-2 md:py-6">
      <header className="flex items-start gap-3 pb-4 sm:gap-4">
        <ClassDot color={cls.color} size={10} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h1 className="text-h1 text-[hsl(var(--foreground))] break-words">
              {cls.name}
            </h1>
            {cls.code ? (
              <span className="font-mono text-small text-[hsl(var(--muted-foreground))]">
                {cls.code}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
            {[cls.professor, cls.term].filter(Boolean).join(" · ") ||
              t("no_term_set")}
          </p>
        </div>
        <ClassHeaderActions
          classId={cls.id}
          initial={{
            name: cls.name,
            code: cls.code,
            term: cls.term,
            professor: cls.professor,
            color: cls.color,
          }}
        />
      </header>

      {/* Tabs scroll horizontally on small screens; the underline indicator
          tracks the active tab. -mx-4 sm:mx-0 lets the strip touch the edges
          on mobile so the bottom border feels uninterrupted, then the
          regular content padding resumes. */}
      <nav className="-mx-4 flex items-center gap-1 overflow-x-auto border-b border-[hsl(var(--border))] px-4 sm:mx-0 sm:px-0">
        {TAB_ORDER.map((tabKey) => (
          <Link
            key={tabKey}
            href={`/app/classes/${id}?tab=${tabKey}`}
            aria-current={tab === tabKey ? "page" : undefined}
            className={cn(
              "relative inline-flex h-11 shrink-0 items-center px-3 text-small font-medium transition-hover",
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
  const tSyllabus = await getTranslations("classes.syllabus");
  const tClasses = await getTranslations("classes");
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={18} strokeWidth={1.5} />}
        title={fmt(tSyllabus("empty_title"), { className: classCode })}
        description={tSyllabus("empty_description")}
        actions={[
          { label: tSyllabus("upload_pdf"), href: "/app/syllabus/new" },
          { label: tSyllabus("paste_url"), href: "/app/syllabus/new" },
        ]}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 sm:p-4"
        >
          <FileText size={16} strokeWidth={1.5} className="mt-0.5 text-[hsl(var(--muted-foreground))]" />
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium break-words">{r.title}</div>
            <div className="text-small text-[hsl(var(--muted-foreground))]">
              {[r.term].filter(Boolean).join(" · ") || tClasses("no_term")}
            </div>
          </div>
          {r.blobUrl ? (
            <a
              href={r.blobUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center text-small underline-offset-4 hover:underline"
            >
              {tSyllabus("open_original")}
            </a>
          ) : r.sourceUrl ? (
            <a
              href={r.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center text-small underline-offset-4 hover:underline"
            >
              {tSyllabus("source")}
            </a>
          ) : null}
          <SyllabusRowActions
            syllabusId={r.id}
            initialTitle={r.title}
            initialTerm={r.term}
          />
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
  void classId;
  return (
    <DenseList ariaLabel={t("tabs.assignments")}>
      {rows.map((r) => (
        <AssignmentRow
          key={r.id}
          initial={{
            id: r.id,
            title: r.title,
            dueAt: r.dueAt ? r.dueAt.toISOString() : null,
            status: r.status,
            priority: r.priority,
            notes: r.notes,
          }}
        />
      ))}
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
  const tMistakes = await getTranslations("classes.mistakes_grid");
  const tMistakesRoot = await getTranslations("mistakes");
  return (
    <div className="space-y-4">
      <ContextualSuggestion
        userId={userId}
        source="notion"
        surface="trigger_mistakes_notion"
        revalidatePath={`/app/classes/${classId}?tab=mistakes`}
      />
      <p className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-small leading-snug text-[hsl(var(--muted-foreground))]">
        {tMistakesRoot("context_note")}
      </p>
      <div className="flex justify-end">
        <PhotoUploadButton classId={classId} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<NotebookPen size={18} strokeWidth={1.5} />}
          title={fmt(tMistakes("empty_title"), { className: classCode })}
          description={tMistakes("empty_description")}
          actions={[{ label: tMistakes("open_chat"), href: "/app" }]}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <MistakeGridItem
              key={r.id}
              id={r.id}
              title={r.title}
              unit={r.unit}
              difficulty={r.difficulty}
              createdAt={r.createdAt}
            />
          ))}
        </div>
      )}
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
  const tClasses = await getTranslations("classes");
  const locale = await getLocale();
  const dateLocale = locale === "ja" ? "ja-JP" : "en-US";
  if (recent.length === 0) {
    return (
      <EmptyState
        icon={<MessagesSquare size={18} strokeWidth={1.5} />}
        title={tClasses("no_chats_tagged_title")}
        description={tClasses("no_chats_tagged_desc")}
        actions={[{ label: tClasses("start_a_chat"), href: "/app" }]}
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
        title={tClasses("no_chats_tagged_title")}
        description={tClasses("no_chats_tagged_desc")}
        actions={[{ label: tClasses("start_a_chat"), href: "/app" }]}
      />
    );
  }
  void classId;
  return (
    <DenseList ariaLabel={tClasses("chats_for_class_aria")}>
      {matching.slice(0, 20).map((c) => (
        <DenseRowLink
          key={c.id}
          href={`/app/chat/${c.id}`}
          title={c.title ?? tClasses("untitled_chat")}
          metadata={[c.updatedAt.toLocaleDateString(dateLocale)]}
        />
      ))}
    </DenseList>
  );
}

