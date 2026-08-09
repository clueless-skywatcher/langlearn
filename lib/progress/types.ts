import type { DrillSetResult, Response, Verdict } from "@/lib/scoring";

/**
 * Where a learner's progress lives.
 *
 * Grading is always done by the server, so the rubric has one implementation
 * and a recorded score is one the server computed. Only *persistence* varies:
 *
 *   browser  localStorage in the learner's browser. No database, no service,
 *            nothing to provision — the mode a static deployment uses.
 *   sqlite   a SQLite file on the server, reached from the client through
 *            /api/progress. Needs a writable disk and a long-lived process,
 *            which rules out most serverless hosts.
 */
export type StoreKind = "browser" | "sqlite";

/** One question answered, in one sitting. */
export interface AttemptRecord {
  setId: string;
  courseId: string;
  /** The section that was sat: a lesson, or a checkpoint. */
  sectionId: string;
  /** The lesson the question examines. Equal to sectionId outside checkpoints. */
  sourceSectionId: string;
  questionId: string;
  questionType: string;
  difficulty: string;
  response: Response;
  score: number;
  maxScore: number;
  verdict: Verdict;
  createdAt: string;
}

/** One whole sitting, summarised. */
export interface RecordedSet {
  setId: string;
  courseId: string;
  sectionId: string;
  score: number;
  max: number;
  percent: number;
  /** Null for lessons, which have no pass mark. */
  passed: boolean | null;
  createdAt: string;
}

/** A section's standing, rolled up from every sitting of it. */
export interface ProgressRow {
  sectionId: string;
  attemptCount: number;
  bestScore: number | null;
  bestPercent: number | null;
  lastPercent: number | null;
  passed: boolean;
  updatedAt: string;
}

export interface MistakeRow {
  questionId: string;
  sectionId: string;
  sourceSectionId: string;
  verdict: Verdict;
  score: number;
  maxScore: number;
  createdAt: string;
}

/** Everything needed to turn a graded result into stored records. */
export interface SittingInput {
  setId: string;
  courseId: string;
  sectionId: string;
  isCheckpoint: boolean;
  questionTypes: Record<string, string>;
  difficulties: Record<string, string>;
  result: DrillSetResult;
  responses: Record<string, Response>;
  createdAt: string;
}

export interface ProgressStore {
  readonly kind: StoreKind;
  record(input: SittingInput): Promise<RecordedSet>;
  progress(courseId: string): Promise<ProgressRow[]>;
  mistakes(courseId: string, limit?: number): Promise<MistakeRow[]>;
  /** Forget everything, for one course or for all of them. */
  clear(courseId?: string): Promise<void>;
}
