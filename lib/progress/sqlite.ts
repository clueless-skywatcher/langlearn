import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { attemptsOf, setOf } from "./rollup";
import type {
  MistakeRow,
  ProgressRow,
  ProgressStore,
  RecordedSet,
  SittingInput,
} from "./types";

/**
 * Progress in a SQLite file on the server.
 *
 * Requires a writable disk and a process that outlives a request, so it is for
 * local development and for hosts with real filesystems — not for serverless.
 * `node:sqlite` is therefore **imported lazily**: on a platform where it is
 * unavailable (Node before 23.4, where it sits behind a flag) nothing breaks
 * unless this store is actually selected.
 */

export const DB_PATH =
  process.env.LANGLEARN_DB ?? path.join(process.cwd(), "db", "app.db");

let handle: DatabaseSync | null = null;

async function getDb(): Promise<DatabaseSync> {
  if (handle) return handle;

  const { DatabaseSync: Database } = await import("node:sqlite");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  handle = db;
  return db;
}

/** Close the handle. Used by tests; the app keeps one open per process. */
export function closeDb(): void {
  handle?.close();
  handle = null;
}

export const sqliteStore: ProgressStore = {
  kind: "sqlite",

  /**
   * Persist one sitting and roll it into `section_progress`, in a transaction
   * so a half-written paper can never skew the rolled-up totals.
   */
  async record(input: SittingInput): Promise<RecordedSet> {
    const db = await getDb();
    const summary = setOf(input);

    const insert = db.prepare(`
      INSERT INTO attempts (
        set_id, course_id, section_id, source_section_id, question_id,
        question_type, difficulty, response, score, max_score, verdict, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsert = db.prepare(`
      INSERT INTO section_progress (
        course_id, section_id, attempt_count, best_score, best_percent,
        last_percent, passed, first_seen_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (course_id, section_id) DO UPDATE SET
        attempt_count = attempt_count + 1,
        best_score    = MAX(COALESCE(best_score, -1e9), excluded.best_score),
        best_percent  = MAX(COALESCE(best_percent, 0), excluded.best_percent),
        last_percent  = excluded.last_percent,
        passed        = MAX(passed, excluded.passed),
        updated_at    = excluded.updated_at
    `);

    db.exec("BEGIN");
    try {
      for (const a of attemptsOf(input)) {
        insert.run(
          a.setId,
          a.courseId,
          a.sectionId,
          a.sourceSectionId,
          a.questionId,
          a.questionType,
          a.difficulty,
          JSON.stringify(a.response),
          a.score,
          a.maxScore,
          a.verdict,
          a.createdAt,
        );
      }

      upsert.run(
        summary.courseId,
        summary.sectionId,
        summary.score,
        summary.percent,
        summary.percent,
        summary.passed ? 1 : 0,
        summary.createdAt,
        summary.createdAt,
      );
      db.exec("COMMIT");
    } catch (cause) {
      db.exec("ROLLBACK");
      throw cause;
    }

    return summary;
  },

  async progress(courseId: string): Promise<ProgressRow[]> {
    const db = await getDb();
    const rows = db
      .prepare(
        `SELECT section_id, attempt_count, best_score, best_percent,
                last_percent, passed, updated_at
           FROM section_progress
          WHERE course_id = ?
          ORDER BY updated_at DESC`,
      )
      .all(courseId) as Record<string, unknown>[];

    return rows.map((r) => ({
      sectionId: r.section_id as string,
      attemptCount: Number(r.attempt_count),
      bestScore: r.best_score === null ? null : Number(r.best_score),
      bestPercent: r.best_percent === null ? null : Number(r.best_percent),
      lastPercent: r.last_percent === null ? null : Number(r.last_percent),
      passed: Number(r.passed) === 1,
      updatedAt: r.updated_at as string,
    }));
  },

  /** The most recent verdict per question, keeping only those not yet right. */
  async mistakes(courseId: string, limit = 100): Promise<MistakeRow[]> {
    const db = await getDb();
    const rows = db
      .prepare(
        `SELECT a.question_id, a.section_id, a.source_section_id,
                a.verdict, a.score, a.max_score, a.created_at
           FROM attempts a
           JOIN (
             SELECT question_id, MAX(id) AS latest
               FROM attempts
              WHERE course_id = ?
              GROUP BY question_id
           ) last ON last.latest = a.id
          WHERE a.verdict IN ('incorrect', 'partial')
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ?`,
      )
      .all(courseId, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      questionId: r.question_id as string,
      sectionId: r.section_id as string,
      sourceSectionId: r.source_section_id as string,
      verdict: r.verdict as MistakeRow["verdict"],
      score: Number(r.score),
      maxScore: Number(r.max_score),
      createdAt: r.created_at as string,
    }));
  },

  async clear(courseId?: string): Promise<void> {
    const db = await getDb();
    if (courseId) {
      db.prepare("DELETE FROM attempts WHERE course_id = ?").run(courseId);
      db.prepare("DELETE FROM section_progress WHERE course_id = ?").run(
        courseId,
      );
      return;
    }
    db.exec("DELETE FROM attempts; DELETE FROM section_progress;");
  },
};
