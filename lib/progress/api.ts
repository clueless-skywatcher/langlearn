import type {
  MistakeRow,
  ProgressRow,
  ProgressStore,
  RecordedSet,
  SittingInput,
} from "./types";

/**
 * The client half of the SQLite store: the browser cannot open a database
 * file, so it reaches the server's one over HTTP. Recording happens as a side
 * effect of grading — `/api/attempts` grades and, in this mode, persists — so
 * `record` here only has to return what the server already sent back.
 */
async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const apiStore: ProgressStore = {
  kind: "sqlite",

  async record(input: SittingInput): Promise<RecordedSet> {
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
  },

  async progress(courseId: string): Promise<ProgressRow[]> {
    const body = (await getJson(
      `/api/progress?courseId=${encodeURIComponent(courseId)}`,
    )) as { progress: ProgressRow[] };
    return body.progress;
  },

  async mistakes(courseId: string, limit = 100): Promise<MistakeRow[]> {
    const body = (await getJson(
      `/api/progress?courseId=${encodeURIComponent(courseId)}&mistakes=1&limit=${limit}`,
    )) as { mistakes: MistakeRow[] };
    return body.mistakes ?? [];
  },

  async clear(courseId?: string): Promise<void> {
    await fetch(
      `/api/progress${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ""}`,
      { method: "DELETE" },
    );
  },
};
