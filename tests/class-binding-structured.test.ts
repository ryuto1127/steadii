import { describe, expect, it, vi, beforeEach } from "vitest";

// Stub the DB client so the structured-branch tests can run without
// Postgres. The vector-branch tests need a live DB and live in a
// separate (post-α) integration suite.
vi.mock("@/lib/db/client", () => {
  const empty = { rows: [] };
  return {
    db: {
      select: vi.fn(),
      execute: vi.fn(async () => empty),
      update: vi.fn(),
    },
  };
});

import { bindEmailToClass } from "@/lib/agent/email/class-binding";
import { db } from "@/lib/db/client";

type ClassRow = {
  id: string;
  name: string;
  code: string | null;
  professor: string | null;
};

function mockUserClasses(rows: ClassRow[]) {
  // The module calls db.select(...).from(classes).where(and(...))
  // We mock the chain to return rows directly.
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    from: () => ({
      where: async () => rows,
    }),
  }));
}

const NO_EMBEDDING = null;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bindEmailToClass — structured methods", () => {
  it("returns 'none' when the user has no classes", async () => {
    mockUserClasses([]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "CSC108 — assignment",
      bodySnippet: "see attached",
      senderEmail: "prof@u.sample-univ.example.edu",
      senderName: "Prof Smith",
      senderRole: "professor",
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("none");
    expect(r.classId).toBeNull();
  });

  it("binds via subject_code when class.code matches a word in the subject", async () => {
    mockUserClasses([
      { id: "cls-1", name: "Computer Science", code: "CSC108", professor: null },
      { id: "cls-2", name: "Linear Algebra", code: "MAT223", professor: null },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "CSC108 — Assignment 2 reminder",
      bodySnippet: "see attached",
      senderEmail: "prof@u.sample-univ.example.edu",
      senderName: null,
      senderRole: null,
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("subject_code");
    expect(r.classId).toBe("cls-1");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("does not bind when the code is a substring of an unrelated word", async () => {
    mockUserClasses([
      { id: "cls-1", name: "Computer Science", code: "CSC", professor: null },
    ]);
    // "DISCSCIENCE" contains 'CSC' as a substring but not on word boundaries.
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "DISCSCIENCE colloquium next week",
      bodySnippet: "",
      senderEmail: "info@u.sample-univ.example.edu",
      senderName: null,
      senderRole: null,
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).not.toBe("subject_code");
  });

  it("binds via subject_name when the class name appears verbatim in the subject", async () => {
    mockUserClasses([
      { id: "cls-1", name: "Linear Algebra", code: null, professor: null },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "Linear Algebra office hours moved",
      bodySnippet: "",
      senderEmail: "ta@u.sample-univ.example.edu",
      senderName: null,
      senderRole: null,
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("subject_name");
    expect(r.classId).toBe("cls-1");
  });

  it("binds via subject_name when a JA kanji course name matches and class.code/name overlaps", async () => {
    mockUserClasses([
      {
        id: "cls-1",
        name: "線形代数学",
        code: "21130200",
        professor: null,
      },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "【線形代数】レポート提出のお知らせ",
      bodySnippet: "",
      senderEmail: "info@example.ac.jp",
      senderName: null,
      senderRole: null,
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("subject_name");
    expect(r.classId).toBe("cls-1");
  });

  it("binds via subject_code when a JA UTAS-style 8-digit code matches class.code", async () => {
    mockUserClasses([
      {
        id: "cls-1",
        name: "情報科学概論",
        code: "21130200",
        professor: null,
      },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "【21130200】試験範囲のお知らせ",
      bodySnippet: "",
      senderEmail: "info@example.ac.jp",
      senderName: null,
      senderRole: null,
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("subject_code");
    expect(r.classId).toBe("cls-1");
  });

  it("binds via sender_professor when the sender's name appears in classes.professor", async () => {
    mockUserClasses([
      {
        id: "cls-1",
        name: "Computer Science",
        code: "CSC108",
        professor: "Smith",
      },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "Re: question",
      bodySnippet: "",
      senderEmail: "smith@u.sample-univ.example.edu",
      senderName: "Smith",
      senderRole: "professor",
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("sender_professor");
    expect(r.classId).toBe("cls-1");
  });

  it("does not use sender_professor when the role is not professor/ta", async () => {
    mockUserClasses([
      {
        id: "cls-1",
        name: "Computer Science",
        code: "CSC108",
        professor: "Smith",
      },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "Re: question",
      bodySnippet: "",
      senderEmail: "smith@u.sample-univ.example.edu",
      senderName: "Smith",
      senderRole: "classmate",
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("none");
  });

  it("binds via ja_sensei_pattern when 〇〇先生 matches classes.professor", async () => {
    mockUserClasses([
      {
        id: "cls-1",
        name: "情報科学概論",
        code: null,
        professor: "田中",
      },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "ご相談です",
      bodySnippet: "田中先生、レポートの件でご相談があります。",
      senderEmail: "student@example.ac.jp",
      senderName: null,
      senderRole: null,
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("ja_sensei_pattern");
    expect(r.classId).toBe("cls-1");
  });

  it("prefers subject_code over sender_professor when both fire", async () => {
    mockUserClasses([
      {
        id: "cls-1",
        name: "Computer Science",
        code: "CSC108",
        professor: "Smith",
      },
      {
        id: "cls-2",
        name: "Linear Algebra",
        code: "MAT223",
        professor: "Smith",
      },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "MAT223 — A2 grading question",
      bodySnippet: "",
      senderEmail: "smith@u.sample-univ.example.edu",
      senderName: "Smith",
      senderRole: "professor",
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("subject_code");
    expect(r.classId).toBe("cls-2");
    // The sender_professor candidate should appear in alternates.
    expect(
      r.alternates.some((a) => a.method === "sender_professor")
    ).toBe(true);
  });

  it("returns 'none' when no method clears MIN_CONFIDENCE", async () => {
    mockUserClasses([
      {
        id: "cls-1",
        name: "Computer Science",
        code: "CSC108",
        professor: null,
      },
    ]);
    const r = await bindEmailToClass({
      userId: "u1",
      subject: "Lunch tomorrow?",
      bodySnippet: "Want to grab a coffee?",
      senderEmail: "friend@example.com",
      senderName: "Friend",
      senderRole: null,
      queryEmbedding: NO_EMBEDDING,
    });
    expect(r.method).toBe("none");
    expect(r.classId).toBeNull();
  });
});
