import {
  atomicQuestions,
  isExam,
  sourceSection,
  type AtomicQuestion,
  type Drill,
  type Section,
} from "@/content/schema";

/**
 * JEE Advanced marking scheme.
 *
 *   single    +4 correct, −1 wrong, 0 unattempted
 *   multi     +4 all correct options and nothing else;
 *             +1 per correct option chosen if the selection is a strict,
 *             error-free subset; −2 the moment any wrong option is chosen;
 *             0 unattempted
 *   integer   +4 correct, 0 otherwise — never negative, since there is
 *             nothing to guess between
 *   matching  +4 correct, −1 wrong. The four options are four complete
 *             pairings, so this is a single-correct question in every respect
 *             that marking cares about: there is no credit for getting three
 *             of the four pairs, which is the whole point of the format.
 *
 * A comprehension block is worth the sum of its questions; it carries no marks
 * of its own.
 */
export const MARKS = {
  single: { correct: 4, wrong: -1 },
  multi: { full: 4, perCorrect: 1, wrong: -2 },
  integer: { correct: 4, wrong: 0 },
  matching: { correct: 4, wrong: -1 },
} as const;

export type Response =
  /** A `single` or `multi` selection. `single` carries at most one index. */
  | { kind: "options"; selected: number[] }
  | { kind: "integer"; value: number }
  | { kind: "skipped" };

export type Verdict = "correct" | "partial" | "incorrect" | "skipped";

export interface QuestionResult {
  questionId: string;
  /** The lesson section this question examines. */
  sectionId: string;
  score: number;
  /** Marks available for a perfect answer. */
  max: number;
  verdict: Verdict;
}

export const SKIPPED: Response = { kind: "skipped" };

/** Maximum marks obtainable on a single question. Uniform at +4 across types. */
export function maxMarks(question: AtomicQuestion): number {
  switch (question.type) {
    case "single":
      return MARKS.single.correct;
    case "multi":
      return MARKS.multi.full;
    case "integer":
      return MARKS.integer.correct;
    case "matching":
      return MARKS.matching.correct;
  }
}

function isSkipped(question: AtomicQuestion, response: Response): boolean {
  if (response.kind === "skipped") return true;
  // An empty selection on an options question is an unattempted question, not
  // a wrong one — the learner never committed to anything.
  if (response.kind === "options") return response.selected.length === 0;
  return question.type !== "integer";
}

/** Score one question. Pure; the single place the rubric is expressed. */
export function gradeQuestion(
  question: AtomicQuestion,
  response: Response,
): { score: number; max: number; verdict: Verdict } {
  const max = maxMarks(question);

  if (isSkipped(question, response)) {
    return { score: 0, max, verdict: "skipped" };
  }

  if (question.type === "integer") {
    if (response.kind !== "integer") {
      return { score: 0, max, verdict: "skipped" };
    }
    const ok = response.value === question.answer;
    return {
      score: ok ? MARKS.integer.correct : MARKS.integer.wrong,
      max,
      verdict: ok ? "correct" : "incorrect",
    };
  }

  if (response.kind !== "options") {
    return { score: 0, max, verdict: "skipped" };
  }

  const selected = new Set(response.selected);

  // `matching` presents four complete pairings and marks exactly like a
  // single-correct question: three pairs out of four is worth nothing.
  if (question.type === "single" || question.type === "matching") {
    const rubric =
      question.type === "single" ? MARKS.single : MARKS.matching;
    // More than one choice on a single-correct question is not a valid
    // attempt; treat it as wrong rather than silently taking the first.
    const ok = selected.size === 1 && selected.has(question.correct);
    return {
      score: ok ? rubric.correct : rubric.wrong,
      max,
      verdict: ok ? "correct" : "incorrect",
    };
  }

  const correct = new Set(question.correct);
  const chosenWrong = [...selected].some((i) => !correct.has(i));

  if (chosenWrong) {
    return { score: MARKS.multi.wrong, max, verdict: "incorrect" };
  }
  if (selected.size === correct.size) {
    return { score: MARKS.multi.full, max, verdict: "correct" };
  }
  // Strict, error-free subset: one mark per correct option darkened.
  return {
    score: selected.size * MARKS.multi.perCorrect,
    max,
    verdict: "partial",
  };
}

export interface SectionBreakdown {
  sectionId: string;
  score: number;
  max: number;
  /** Share of the available marks, 0–100. */
  percent: number;
  counts: Record<Verdict, number>;
}

export interface DrillSetResult {
  results: QuestionResult[];
  score: number;
  max: number;
  /** Share of available marks, 0–100, floored at 0 so negative totals read as 0%. */
  percent: number;
  counts: Record<Verdict, number>;
  /** Per covered section — meaningful on exams, single-entry on lessons. */
  breakdown: SectionBreakdown[];
  /** Present only on exams: checkpoints and boundary papers. */
  passed?: boolean;
  passThreshold?: number;
}

function emptyCounts(): Record<Verdict, number> {
  return { correct: 0, partial: 0, incorrect: 0, skipped: 0 };
}

/**
 * Grade a whole drill set. `responses` is keyed by question id; questions
 * missing from it count as unattempted.
 *
 * For an exam the breakdown is grouped by each question's `fromSection`,
 * which is what turns a failed paper into a list of sections to revisit.
 */
export function gradeDrillSet(
  section: Section,
  responses: Record<string, Response>,
): DrillSetResult {
  const results: QuestionResult[] = [];

  for (const drill of section.drills) {
    const children: AtomicQuestion[] =
      drill.type === "comprehension" ? drill.questions : [drill];
    for (const question of children) {
      const graded = gradeQuestion(
        question,
        responses[question.id] ?? SKIPPED,
      );
      results.push({
        questionId: question.id,
        sectionId: sourceSection(drill, question, section.id),
        ...graded,
      });
    }
  }

  const counts = emptyCounts();
  let score = 0;
  let max = 0;
  const bySection = new Map<string, SectionBreakdown>();

  for (const r of results) {
    score += r.score;
    max += r.max;
    counts[r.verdict] += 1;

    let bucket = bySection.get(r.sectionId);
    if (!bucket) {
      bucket = {
        sectionId: r.sectionId,
        score: 0,
        max: 0,
        percent: 0,
        counts: emptyCounts(),
      };
      bySection.set(r.sectionId, bucket);
    }
    bucket.score += r.score;
    bucket.max += r.max;
    bucket.counts[r.verdict] += 1;
  }

  for (const bucket of bySection.values()) {
    bucket.percent = percentOf(bucket.score, bucket.max);
  }

  // Preserve the order the checkpoint declares, so the weakest-section list
  // reads in curriculum order rather than in whatever order questions appear.
  const order = isExam(section) ? section.covers : [section.id];
  const breakdown = [...bySection.values()].sort((a, b) => {
    const ia = order.indexOf(a.sectionId);
    const ib = order.indexOf(b.sectionId);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });

  const percent = percentOf(score, max);

  const result: DrillSetResult = {
    results,
    score,
    max,
    percent,
    counts,
    breakdown,
  };

  if (isExam(section)) {
    result.passThreshold = section.passThreshold;
    result.passed = percent >= section.passThreshold;
  }

  return result;
}

/**
 * Marks are negative-capable, so a bad attempt can total below zero. Reporting
 * a negative percentage helps nobody; floor it.
 */
export function percentOf(score: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, (score / max) * 100);
}

/** Total marks available in a drill list, without needing a full grading pass. */
export function maxScoreOf(drills: Drill[]): number {
  return atomicQuestions(drills).reduce((sum, q) => sum + maxMarks(q), 0);
}

/** Covered sections a learner should revisit, weakest first. */
export function weakestSections(
  result: DrillSetResult,
  threshold: number,
): SectionBreakdown[] {
  return result.breakdown
    .filter((b) => b.percent < threshold)
    .sort((a, b) => a.percent - b.percent);
}
