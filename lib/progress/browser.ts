import {
  attemptsOf,
  latestMistakes,
  rollUpProgress,
  setOf,
} from "./rollup";
import type {
  AttemptRecord,
  MistakeRow,
  ProgressRow,
  ProgressStore,
  RecordedSet,
  SittingInput,
} from "./types";

/**
 * Progress kept in the learner's own browser.
 *
 * localStorage rather than IndexedDB: the whole record is a few kilobytes even
 * after hundreds of sittings, and a synchronous read keeps the store trivial.
 * The interface is async all the same, so the SQLite store can satisfy it.
 *
 * The consequence to be honest about: progress is per-browser and per-device,
 * and clearing site data clears it.
 */
const KEY = "langlearn:progress:v1";

/** Enough for years of daily practice; the oldest are dropped beyond it. */
const MAX_ATTEMPTS = 5000;
const MAX_SETS = 1000;

interface Document {
  version: 1;
  attempts: AttemptRecord[];
  sets: RecordedSet[];
}

/**
 * A fresh document every time. This must never be a shared constant: callers
 * build the next document from what they read, and a shared empty would be
 * mutated by the first sitting and returned polluted ever after — including
 * after `clear()`.
 */
function empty(): Document {
  return { version: 1, attempts: [], sets: [] };
}

function available(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function read(): Document {
  if (!available()) return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Document>;
    if (parsed.version !== 1) return empty();
    return {
      version: 1,
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      sets: Array.isArray(parsed.sets) ? parsed.sets : [],
    };
  } catch {
    // Corrupt or unreadable storage is not worth failing a drill over.
    return empty();
  }
}

function write(doc: Document): void {
  if (!available()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    // Quota exceeded, or storage disabled. The sitting was still graded and
    // shown; losing the record is the lesser failure.
  }
}

export const browserStore: ProgressStore = {
  kind: "browser",

  async record(input: SittingInput): Promise<RecordedSet> {
    const doc = read();
    const summary = setOf(input);

    write({
      version: 1,
      attempts: [...doc.attempts, ...attemptsOf(input)].slice(-MAX_ATTEMPTS),
      sets: [...doc.sets, summary].slice(-MAX_SETS),
    });

    return summary;
  },

  async progress(courseId: string): Promise<ProgressRow[]> {
    return rollUpProgress(read().sets.filter((s) => s.courseId === courseId));
  },

  async mistakes(courseId: string, limit = 100): Promise<MistakeRow[]> {
    return latestMistakes(
      read().attempts.filter((a) => a.courseId === courseId),
      limit,
    );
  },

  async clear(courseId?: string): Promise<void> {
    if (!courseId) {
      if (available()) window.localStorage.removeItem(KEY);
      return;
    }
    const doc = read();
    write({
      version: 1,
      attempts: doc.attempts.filter((a) => a.courseId !== courseId),
      sets: doc.sets.filter((s) => s.courseId !== courseId),
    });
  },
};
