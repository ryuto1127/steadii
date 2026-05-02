import { describe, expect, it } from "vitest";
import { detectTutorScope } from "@/lib/chat/scope-detection";

// Wave 1 secretary-pivot: heuristic boundary tests for the chat scope
// detector. Per `project_secretary_pivot.md` § "CRITICAL distinction:
// TEACHING vs LOOKUP" — the line between tutor (out of scope) and
// secretary work (in scope) is *whose data the answer comes from*. The
// detector biases toward LOOKUP: false positives on tutor detection
// lock the secretary out of real work, while false negatives just mean
// the user re-asks in ChatGPT.

describe("detectTutorScope — TEACHING patterns (must flag)", () => {
  // Pure-knowledge: no possessive, no class code, no user-context. The
  // model would answer the same way for any user.
  const tutorCases = [
    "What is the Pythagorean theorem?",
    "What is a derivative?",
    "Explain integration by parts",
    "How does photosynthesis work?",
    "What's the difference between mitosis and meiosis?",
    "Define entropy",
  ];
  for (const text of tutorCases) {
    it(`flags: "${text}"`, () => {
      expect(detectTutorScope(text).isTutor).toBe(true);
    });
  }
});

describe("detectTutorScope — TEACHING patterns JA (must flag)", () => {
  const tutorCases = [
    "matrix multiplication とは",
    "微分とは何ですか？",
    "光合成の仕組みを説明して",
    "等速円運動と等加速度運動の違いは？",
    "フェルマーの小定理の証明を教えて",
    "微分の公式は何ですか",
  ];
  for (const text of tutorCases) {
    it(`flags: "${text}"`, () => {
      expect(detectTutorScope(text).isTutor).toBe(true);
    });
  }
});

describe("detectTutorScope — LOOKUP patterns EN (must NOT flag)", () => {
  // Each query has at least one LOOKUP signal: possessive, class code,
  // named professor, time/scope reference, or data action verb.
  const lookupCases = [
    // Action-verb command lead.
    "Draft a reply to Prof. Tanaka",
    "Add a chemistry task for Friday",
    "Email my TA — I'll miss the lab tomorrow",
    "Reschedule my Friday meeting to Monday",
    "Snooze the office-hours email till tomorrow",
    // Possessive + question.
    "What's due in my classes this week?",
    "When's my next class?",
    "Who haven't I emailed in 3+ weeks?",
    // Class code in a question that *looks* like tutor.
    "What's covered on the MAT223 midterm?",
    "Explain my MAT223 syllabus structure",
    // Named professor in a question that *looks* like tutor.
    "Show me what Prof Tanaka emailed last week",
    "Summarize my reading list for this week",
    // Time references.
    "What's on Friday's calendar?",
    "Anything due tomorrow?",
  ];
  for (const text of lookupCases) {
    it(`does NOT flag: "${text}"`, () => {
      expect(detectTutorScope(text).isTutor).toBe(false);
    });
  }
});

describe("detectTutorScope — LOOKUP patterns JA (must NOT flag)", () => {
  const lookupCases = [
    "田中先生にメール送って",
    "金曜のミーティングを月曜に動かして",
    "今週の私の予定を教えてもらえますか",
    "明日の授業を欠席するメールを TA に送信して",
    // Spec examples (project_secretary_pivot.md § "CRITICAL distinction").
    "数学 II の試験範囲どこ?",
    "私の MAT223 の reading list 何?",
    "Prof Tanaka との直近のメール内容まとめて",
    "今週の workload 見せて",
  ];
  for (const text of lookupCases) {
    it(`does NOT flag: "${text}"`, () => {
      expect(detectTutorScope(text).isTutor).toBe(false);
    });
  }
});

describe("detectTutorScope — empty / whitespace", () => {
  it("does not flag empty string", () => {
    expect(detectTutorScope("").isTutor).toBe(false);
  });
  it("does not flag whitespace-only", () => {
    expect(detectTutorScope("   \n  ").isTutor).toBe(false);
  });
});

describe("detectTutorScope — LOOKUP override beats tutor lead", () => {
  it("'my' wins over 'what is' tutor lead", () => {
    expect(detectTutorScope("What is my next class?").isTutor).toBe(false);
  });
  it("class code wins over 'what is on' tutor lead", () => {
    expect(detectTutorScope("What is on the PHY205 syllabus?").isTutor).toBe(
      false
    );
  });
  it("named professor wins over generic phrasing", () => {
    expect(
      detectTutorScope("How does Prof Tanaka grade midterms?").isTutor
    ).toBe(false);
  });
  it("JA: 私の wins over 教えて", () => {
    expect(detectTutorScope("私の今週の予定を教えて").isTutor).toBe(false);
  });
  it("JA: 試験範囲 (data keyword) wins over question shape", () => {
    expect(detectTutorScope("数学 II の試験範囲どこ?").isTutor).toBe(false);
  });
});

describe("detectTutorScope — exposes a reason for debugging", () => {
  it("returns lookup-override reason when a LOOKUP signal fires", () => {
    expect(detectTutorScope("What is my next class?").reason).toBe(
      "lookup-override"
    );
  });
  it("returns tutor-pattern reason when only tutor patterns fire", () => {
    expect(detectTutorScope("What is the Pythagorean theorem?").reason).toBe(
      "tutor-pattern"
    );
  });
});
