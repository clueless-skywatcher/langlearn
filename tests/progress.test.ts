import { beforeEach, describe, expect, it } from "vitest";

import type { CheckpointSection, LessonSection } from "@/content/schema";
import { browserStore } from "@/lib/progress/browser";
import {
  attemptsOf,
  latestMistakes,
  rollUpProgress,
  setOf,
} from "@/lib/progress/rollup";
import type { RecordedSet, SittingInput } from "@/lib/progress/types";
import { gradeDrillSet, type Response } from "@/lib/scoring";

/* ------------------------------------------------ a minimal course to sit */

const base = { explanation: "because", rulesTested: [], vocabUsed: [] };

const lesson: LessonSection = {
  id: "s1",
  kind: "lesson",
  level: "A1",
  order: 1,
  title: "One",
  summary: "…",
  sources: [{ kind: "composed" as const, citation: "Fixture." }],
  rules: [],
  vocabulary: [],
  drills: [
    {
      ...base,
      id: "q1",
      type: "single",
      difficulty: "easy",
      stem: "?",
      options: ["a", "b", "c", "d"],
      correct: 0,
    },
    {
      ...base,
      id: "q2",
      type: "multi",
      difficulty: "medium",
      stem: "?",
      options: ["a", "b", "c", "d"],
      correct: [0, 1],
    },
  ],
};

const checkpoint: CheckpointSection = {
  id: "cp1",
  kind: "checkpoint",
  level: "A1",
  order: 4,
  title: "Checkpoint",
  summary: "…",
  sources: [{ kind: "composed" as const, citation: "Fixture." }],
  covers: ["s1", "s2", "s3"],
  passThreshold: 60,
  drills: [
    {
      ...base,
      id: "c1",
      type: "single",
      difficulty: "easy",
      stem: "?",
      options: ["a", "b", "c", "d"],
      correct: 0,
      fromSection: "s1",
    },
    {
      ...base,
      id: "c2",
      type: "single",
      difficulty: "easy",
      stem: "?",
      options: ["a", "b", "c", "d"],
      correct: 0,
      fromSection: "s2",
    },
  ],
};

const chose = (...selected: number[]): Response => ({
  kind: "options",
  selected,
});

function sitting(
  section: LessonSection | CheckpointSection,
  responses: Record<string, Response>,
  createdAt: string,
  setId = `set-${createdAt}`,
): SittingInput {
  return {
    setId,
    courseId: "xx",
    sectionId: section.id,
    isCheckpoint: section.kind === "checkpoint",
    questionTypes: Object.fromEntries(
      section.drills.map((d) => [d.id, d.type]),
    ),
    difficulties: Object.fromEntries(
      section.drills.map((d) => [d.id, d.difficulty]),
    ),
    result: gradeDrillSet(section, responses),
    responses,
    createdAt,
  };
}

/* ------------------------------------------------------------- pure rollup */

describe("attemptsOf", () => {
  it("produces one record per question, attributed to its source section", () => {
    const input = sitting(checkpoint, { c1: chose(0), c2: chose(1) }, "2026-01-01T00:00:00Z");
    const attempts = attemptsOf(input);

    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.sourceSectionId)).toEqual(["s1", "s2"]);
    expect(attempts.every((a) => a.sectionId === "cp1")).toBe(true);
    expect(attempts[0]).toMatchObject({
      questionId: "c1",
      questionType: "single",
      difficulty: "easy",
      score: 4,
      maxScore: 4,
      verdict: "correct",
    });
    expect(attempts[1]).toMatchObject({ verdict: "incorrect", score: -1 });
  });

  it("records an unanswered question as skipped rather than dropping it", () => {
    const attempts = attemptsOf(
      sitting(lesson, { q1: chose(0) }, "2026-01-01T00:00:00Z"),
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({
      questionId: "q2",
      verdict: "skipped",
      response: { kind: "skipped" },
    });
  });
});

describe("setOf", () => {
  it("marks a lesson's pass state as null, having no pass mark", () => {
    expect(setOf(sitting(lesson, { q1: chose(0) }, "t"))).toMatchObject({
      passed: null,
      score: 4,
      max: 8,
    });
  });

  it("carries a checkpoint's verdict", () => {
    const passed = setOf(
      sitting(checkpoint, { c1: chose(0), c2: chose(0) }, "t"),
    );
    expect(passed).toMatchObject({ passed: true, percent: 100 });

    const failed = setOf(
      sitting(checkpoint, { c1: chose(1), c2: chose(1) }, "t"),
    );
    expect(failed).toMatchObject({ passed: false, percent: 0 });
  });
});

describe("rollUpProgress", () => {
  const sets: RecordedSet[] = [
    {
      setId: "a",
      courseId: "xx",
      sectionId: "cp1",
      score: 4,
      max: 8,
      percent: 50,
      passed: false,
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      setId: "b",
      courseId: "xx",
      sectionId: "cp1",
      score: 8,
      max: 8,
      percent: 100,
      passed: true,
      createdAt: "2026-01-02T00:00:00Z",
    },
    {
      setId: "c",
      courseId: "xx",
      sectionId: "cp1",
      score: 2,
      max: 8,
      percent: 25,
      passed: false,
      createdAt: "2026-01-03T00:00:00Z",
    },
  ];

  it("keeps the best and the latest separately, and never revokes a pass", () => {
    const [row] = rollUpProgress(sets);
    expect(row).toMatchObject({
      sectionId: "cp1",
      attemptCount: 3,
      bestScore: 8,
      bestPercent: 100,
      lastPercent: 25,
      passed: true,
      updatedAt: "2026-01-03T00:00:00Z",
    });
  });

  it("is insensitive to the order it is given the sittings in", () => {
    const shuffled = [sets[2], sets[0], sets[1]];
    expect(rollUpProgress(shuffled)).toEqual(rollUpProgress(sets));
  });

  it("orders sections by when they were last touched", () => {
    const rows = rollUpProgress([
      { ...sets[0], sectionId: "old", createdAt: "2026-01-01T00:00:00Z" },
      { ...sets[0], sectionId: "new", createdAt: "2026-06-01T00:00:00Z" },
    ]);
    expect(rows.map((r) => r.sectionId)).toEqual(["new", "old"]);
  });

  it("returns nothing for a learner who has sat nothing", () => {
    expect(rollUpProgress([])).toEqual([]);
  });
});

describe("latestMistakes", () => {
  it("drops a question once it has been answered correctly", () => {
    const wrong = attemptsOf(sitting(lesson, { q1: chose(3) }, "2026-01-01T00:00:00Z"));
    const right = attemptsOf(sitting(lesson, { q1: chose(0) }, "2026-01-02T00:00:00Z"));

    expect(latestMistakes(wrong).map((m) => m.questionId)).toContain("q1");
    expect(latestMistakes([...wrong, ...right]).map((m) => m.questionId)).not.toContain("q1");
  });

  it("keeps partial credit on the list", () => {
    const attempts = attemptsOf(
      sitting(lesson, { q1: chose(0), q2: chose(0) }, "2026-01-01T00:00:00Z"),
    );
    expect(latestMistakes(attempts).map((m) => m.questionId)).toEqual(["q2"]);
  });

  it("honours the limit", () => {
    const attempts = attemptsOf(sitting(lesson, {}, "2026-01-01T00:00:00Z")).map(
      (a) => ({ ...a, verdict: "incorrect" as const }),
    );
    expect(latestMistakes(attempts, 1)).toHaveLength(1);
  });
});

/* ---------------------------------------------------------- browser store */

/** A localStorage good enough to exercise the store under Node. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe("the browser store", () => {
  beforeEach(() => {
    // @ts-expect-error — a stand-in for the browser global.
    globalThis.window = { localStorage: new MemoryStorage() };
  });

  it("round-trips a sitting into progress", async () => {
    await browserStore.record(
      sitting(lesson, { q1: chose(0), q2: chose(0, 1) }, "2026-01-01T00:00:00Z"),
    );

    const rows = await browserStore.progress("xx");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sectionId: "s1",
      attemptCount: 1,
      bestScore: 8,
      bestPercent: 100,
      passed: false,
    });
    expect(await browserStore.mistakes("xx")).toEqual([]);
  });

  it("does not let one sitting leak into a later empty store", async () => {
    // A regression guard: an earlier version read a shared module-level empty
    // document and then assigned onto it, so the first sitting polluted every
    // subsequent "empty" read — cleared progress came back from the dead.
    await browserStore.record(
      sitting(lesson, { q1: chose(0) }, "2026-01-01T00:00:00Z"),
    );
    await browserStore.clear();
    expect(await browserStore.progress("xx")).toEqual([]);
    expect(await browserStore.mistakes("xx")).toEqual([]);

    // And a fresh store in a new browser must also start empty.
    // @ts-expect-error — the stand-in defined above.
    globalThis.window = { localStorage: new MemoryStorage() };
    expect(await browserStore.progress("xx")).toEqual([]);
  });

  it("accumulates attempts across sittings", async () => {
    expect(await browserStore.progress("xx")).toEqual([]);
    await browserStore.record(sitting(lesson, { q1: chose(3) }, "2026-01-01T00:00:00Z", "a"));
    await browserStore.record(sitting(lesson, { q1: chose(0) }, "2026-01-02T00:00:00Z", "b"));

    const [row] = await browserStore.progress("xx");
    expect(row.attemptCount).toBe(2);
    expect(row.bestScore).toBe(4);
    expect(row.lastPercent).toBeGreaterThan(row.bestPercent! - 100);
  });

  it("keeps courses apart", async () => {
    await browserStore.record(sitting(lesson, { q1: chose(0) }, "2026-01-01T00:00:00Z"));
    expect(await browserStore.progress("yy")).toEqual([]);
    expect(await browserStore.mistakes("yy")).toEqual([]);
  });

  it("clears one course without touching another", async () => {
    const one = sitting(lesson, { q1: chose(3) }, "2026-01-01T00:00:00Z", "a");
    const two = { ...sitting(lesson, { q1: chose(3) }, "2026-01-02T00:00:00Z", "b"), courseId: "yy" };
    await browserStore.record(one);
    await browserStore.record(two);

    await browserStore.clear("xx");
    expect(await browserStore.progress("xx")).toEqual([]);
    expect(await browserStore.progress("yy")).toHaveLength(1);

    await browserStore.clear();
    expect(await browserStore.progress("yy")).toEqual([]);
  });

  it("survives corrupt storage rather than throwing", async () => {
    window.localStorage.setItem("langlearn:progress:v1", "{ not json");
    expect(await browserStore.progress("xx")).toEqual([]);
    await expect(
      browserStore.record(sitting(lesson, { q1: chose(0) }, "2026-01-01T00:00:00Z")),
    ).resolves.toMatchObject({ sectionId: "s1" });
  });

  it("reports empty progress when there is no window at all", async () => {
    // @ts-expect-error — simulate the server, where localStorage does not exist.
    delete globalThis.window;
    expect(await browserStore.progress("xx")).toEqual([]);
  });
});
