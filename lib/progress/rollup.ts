import { percentOf } from "@/lib/scoring";

import type {
  AttemptRecord,
  MistakeRow,
  ProgressRow,
  RecordedSet,
  SittingInput,
} from "./types";

/**
 * The shape of stored progress, expressed once as pure functions over records.
 *
 * The browser store calls these directly; the SQLite store does the equivalent
 * in SQL. Keeping the definition here is what stops the two implementations
 * drifting apart, and it is these functions the tests pin down.
 */

/** Flatten a graded sitting into one record per question. */
export function attemptsOf(input: SittingInput): AttemptRecord[] {
  return input.result.results.map((r) => ({
    setId: input.setId,
    courseId: input.courseId,
    sectionId: input.sectionId,
    sourceSectionId: r.sectionId,
    questionId: r.questionId,
    questionType: input.questionTypes[r.questionId] ?? "unknown",
    difficulty: input.difficulties[r.questionId] ?? "unknown",
    response: input.responses[r.questionId] ?? { kind: "skipped" },
    score: r.score,
    maxScore: r.max,
    verdict: r.verdict,
    createdAt: input.createdAt,
  }));
}

/** Summarise a graded sitting. */
export function setOf(input: SittingInput): RecordedSet {
  return {
    setId: input.setId,
    courseId: input.courseId,
    sectionId: input.sectionId,
    score: input.result.score,
    max: input.result.max,
    percent: input.result.percent,
    passed: input.isCheckpoint ? (input.result.passed ?? false) : null,
    createdAt: input.createdAt,
  };
}

/**
 * A section's standing across every sitting of it: how many attempts, the best
 * ever, the most recent, and whether its pass mark has ever been reached.
 * Ordered most recently touched first.
 */
export function rollUpProgress(sets: RecordedSet[]): ProgressRow[] {
  const rows = new Map<string, ProgressRow>();

  // Oldest first, so that "last" really is the last.
  const ordered = [...sets].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  for (const s of ordered) {
    const existing = rows.get(s.sectionId);
    if (!existing) {
      rows.set(s.sectionId, {
        sectionId: s.sectionId,
        attemptCount: 1,
        bestScore: s.score,
        bestPercent: s.percent,
        lastPercent: s.percent,
        passed: s.passed === true,
        updatedAt: s.createdAt,
      });
      continue;
    }
    existing.attemptCount += 1;
    existing.bestScore = Math.max(existing.bestScore ?? -Infinity, s.score);
    existing.bestPercent = Math.max(existing.bestPercent ?? 0, s.percent);
    existing.lastPercent = s.percent;
    // A pass is never taken away by a later poorer attempt.
    existing.passed = existing.passed || s.passed === true;
    existing.updatedAt = s.createdAt;
  }

  return [...rows.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

/**
 * The questions still owed work: those whose **most recent** answer was wrong
 * or only partly right. Answering one correctly later drops it off the list.
 */
export function latestMistakes(
  attempts: AttemptRecord[],
  limit = 100,
): MistakeRow[] {
  const latest = new Map<string, AttemptRecord>();

  for (const a of attempts) {
    const seen = latest.get(a.questionId);
    if (!seen || a.createdAt >= seen.createdAt) latest.set(a.questionId, a);
  }

  return [...latest.values()]
    .filter((a) => a.verdict === "incorrect" || a.verdict === "partial")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((a) => ({
      questionId: a.questionId,
      sectionId: a.sectionId,
      sourceSectionId: a.sourceSectionId,
      verdict: a.verdict,
      score: a.score,
      maxScore: a.maxScore,
      createdAt: a.createdAt,
    }));
}

/** Re-exported so stores need only one import for the percentage convention. */
export { percentOf };
