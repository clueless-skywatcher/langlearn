import { describe, expect, it } from "vitest";

import type {
  AtomicQuestion,
  CheckpointSection,
  LessonSection,
} from "@/content/schema";
import {
  MARKS,
  gradeDrillSet,
  gradeQuestion,
  maxScoreOf,
  percentOf,
  weakestSections,
  type Response,
} from "@/lib/scoring";

const base = {
  explanation: "because",
  rulesTested: [],
  vocabUsed: [],
};

function single(id: string, correct: number): AtomicQuestion {
  return {
    ...base,
    id,
    type: "single",
    difficulty: "easy",
    stem: "?",
    options: ["a", "b", "c", "d"],
    correct,
  };
}

function multi(id: string, correct: number[]): AtomicQuestion {
  return {
    ...base,
    id,
    type: "multi",
    difficulty: "medium",
    stem: "?",
    options: ["a", "b", "c", "d"],
    correct,
  };
}

function integer(id: string, answer: number): AtomicQuestion {
  return {
    ...base,
    id,
    type: "integer",
    difficulty: "hard",
    stem: "?",
    answer,
  };
}

const chose = (...selected: number[]): Response => ({
  kind: "options",
  selected,
});
const typed = (value: number): Response => ({ kind: "integer", value });

describe("single-correct", () => {
  it("awards +4 for the right option", () => {
    expect(gradeQuestion(single("q", 2), chose(2))).toMatchObject({
      score: 4,
      verdict: "correct",
    });
  });

  it("deducts 1 for a wrong option", () => {
    expect(gradeQuestion(single("q", 2), chose(0))).toMatchObject({
      score: -1,
      verdict: "incorrect",
    });
  });

  it("treats multiple selections as a wrong answer, not a lucky hit", () => {
    expect(gradeQuestion(single("q", 2), chose(2, 3))).toMatchObject({
      score: -1,
      verdict: "incorrect",
    });
  });

  it("does not penalise an unattempted question", () => {
    expect(gradeQuestion(single("q", 2), chose())).toMatchObject({
      score: 0,
      verdict: "skipped",
    });
    expect(gradeQuestion(single("q", 2), { kind: "skipped" })).toMatchObject({
      score: 0,
      verdict: "skipped",
    });
  });
});

describe("multiple-correct partial credit", () => {
  const q = multi("q", [0, 1, 2]);

  it("awards +4 when every correct option and nothing else is chosen", () => {
    expect(gradeQuestion(q, chose(0, 1, 2))).toMatchObject({
      score: 4,
      verdict: "correct",
    });
  });

  it("awards +1 for a single correct option", () => {
    expect(gradeQuestion(q, chose(1))).toMatchObject({
      score: 1,
      verdict: "partial",
    });
  });

  it("awards +2 for two correct options", () => {
    expect(gradeQuestion(q, chose(0, 2))).toMatchObject({
      score: 2,
      verdict: "partial",
    });
  });

  it("awards +3 when three of four correct options are chosen", () => {
    const wide = multi("wide", [0, 1, 2, 3]);
    expect(gradeQuestion(wide, chose(0, 1, 2))).toMatchObject({
      score: 3,
      verdict: "partial",
    });
  });

  it("deducts 2 as soon as any wrong option is included", () => {
    expect(gradeQuestion(q, chose(0, 1, 2, 3))).toMatchObject({
      score: MARKS.multi.wrong,
      verdict: "incorrect",
    });
    expect(gradeQuestion(q, chose(3))).toMatchObject({ score: -2 });
    // Partial-but-poisoned scores the same as fully wrong — no credit salvaged.
    expect(gradeQuestion(q, chose(0, 3))).toMatchObject({ score: -2 });
  });

  it("scores an empty selection as unattempted", () => {
    expect(gradeQuestion(q, chose())).toMatchObject({
      score: 0,
      verdict: "skipped",
    });
  });

  it("handles a single-correct-answer multi question", () => {
    const narrow = multi("narrow", [3]);
    expect(gradeQuestion(narrow, chose(3))).toMatchObject({
      score: 4,
      verdict: "correct",
    });
  });
});

describe("integer type", () => {
  it("awards +4 for the exact value", () => {
    expect(gradeQuestion(integer("q", 32), typed(32))).toMatchObject({
      score: 4,
      verdict: "correct",
    });
  });

  it("never marks negative for a wrong value", () => {
    expect(gradeQuestion(integer("q", 32), typed(26))).toMatchObject({
      score: 0,
      verdict: "incorrect",
    });
  });

  it("distinguishes a wrong value from no value", () => {
    expect(gradeQuestion(integer("q", 32), { kind: "skipped" })).toMatchObject({
      verdict: "skipped",
    });
    expect(gradeQuestion(integer("q", 0), typed(0))).toMatchObject({
      score: 4,
      verdict: "correct",
    });
  });
});

describe("lesson drill sets", () => {
  const lesson: LessonSection = {
    id: "a1-02",
    kind: "lesson",
    level: "A1",
    order: 2,
    title: "Nouns",
    summary: "…",
    rules: [],
    vocabulary: [],
    drills: [single("q1", 0), multi("q2", [1, 2]), integer("q3", 7)],
  };

  it("sums marks and reports a single-section breakdown", () => {
    const result = gradeDrillSet(lesson, {
      q1: chose(0), // +4
      q2: chose(1), // +1
      q3: typed(9), // 0
    });

    expect(result.score).toBe(5);
    expect(result.max).toBe(12);
    expect(result.counts).toEqual({
      correct: 1,
      partial: 1,
      incorrect: 1,
      skipped: 0,
    });
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].sectionId).toBe("a1-02");
    expect(result.passed).toBeUndefined();
  });

  it("counts absent responses as unattempted", () => {
    const result = gradeDrillSet(lesson, {});
    expect(result.score).toBe(0);
    expect(result.counts.skipped).toBe(3);
  });

  it("floors a negative total at 0%", () => {
    const result = gradeDrillSet(lesson, {
      q1: chose(3), // −1
      q2: chose(0), // −2
      q3: typed(1), // 0
    });
    expect(result.score).toBe(-3);
    expect(result.percent).toBe(0);
  });
});

describe("checkpoint aggregation", () => {
  const checkpoint: CheckpointSection = {
    id: "a1-cp-01",
    kind: "checkpoint",
    level: "A1",
    order: 4,
    title: "Checkpoint",
    summary: "…",
    covers: ["a1-01", "a1-02", "a1-03"],
    passThreshold: 60,
    drills: [
      { ...single("c1", 0), fromSection: "a1-01" },
      { ...single("c2", 1), fromSection: "a1-01" },
      { ...single("c3", 2), fromSection: "a1-02" },
      {
        id: "p1",
        type: "comprehension",
        difficulty: "medium",
        title: "Passage",
        passage: "…",
        glossary: {},
        fromSection: "a1-03",
        questions: [single("c4", 0), integer("c5", 3)],
      },
    ],
  };

  it("attributes comprehension children to the passage's section", () => {
    const result = gradeDrillSet(checkpoint, {
      c1: chose(0),
      c2: chose(1),
      c3: chose(2),
      c4: chose(0),
      c5: typed(3),
    });

    expect(result.score).toBe(20);
    expect(result.percent).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.breakdown.map((b) => b.sectionId)).toEqual([
      "a1-01",
      "a1-02",
      "a1-03",
    ]);
    expect(result.breakdown[2].max).toBe(8);
  });

  it("lets a child question override the passage's section", () => {
    const mixed: CheckpointSection = {
      ...checkpoint,
      drills: [
        {
          id: "p2",
          type: "comprehension",
          difficulty: "medium",
          title: "Passage",
          passage: "…",
          glossary: {},
          fromSection: "a1-03",
          questions: [
            { ...single("m1", 0), fromSection: "a1-02" },
            integer("m2", 1),
          ],
        },
      ],
    };
    const result = gradeDrillSet(mixed, { m1: chose(0), m2: typed(1) });
    expect(result.breakdown.map((b) => b.sectionId)).toEqual([
      "a1-02",
      "a1-03",
    ]);
  });

  it("orders the breakdown by the checkpoint's covers list, not by question order", () => {
    const result = gradeDrillSet(checkpoint, {});
    expect(result.breakdown.map((b) => b.sectionId)).toEqual([
      "a1-01",
      "a1-02",
      "a1-03",
    ]);
  });

  it("fails an attempt below the threshold and names the weak sections", () => {
    const result = gradeDrillSet(checkpoint, {
      c1: chose(0), // a1-01 +4
      c2: chose(1), // a1-01 +4
      c3: chose(0), // a1-02 −1
      c4: chose(3), // a1-03 −1
      c5: typed(0), // a1-03  0
    });

    expect(result.score).toBe(6);
    expect(result.passed).toBe(false);
    expect(result.passThreshold).toBe(60);

    const weak = weakestSections(result, 60);
    expect(weak.map((b) => b.sectionId)).toEqual(["a1-02", "a1-03"]);
    expect(weak[0].percent).toBe(0);
  });

  it("passes exactly at the threshold", () => {
    // 12 of 20 marks is 60%.
    const result = gradeDrillSet(checkpoint, {
      c1: chose(0),
      c2: chose(1),
      c3: chose(2),
    });
    expect(result.score).toBe(12);
    expect(result.percent).toBe(60);
    expect(result.passed).toBe(true);
  });
});

describe("helpers", () => {
  it("computes the maximum score of a drill list", () => {
    expect(
      maxScoreOf([
        single("a", 0),
        {
          id: "p",
          type: "comprehension",
          difficulty: "easy",
          title: "t",
          passage: "…",
          glossary: {},
          questions: [single("b", 0), multi("c", [1])],
        },
      ]),
    ).toBe(12);
  });

  it("returns 0% when nothing is available to score", () => {
    expect(percentOf(0, 0)).toBe(0);
  });
});
