"use client";

import { useEffect, useState } from "react";

import { progressStore } from "./index";
import type { MistakeRow, ProgressRow } from "./types";

/**
 * Progress is read after mount, never during render: with the browser store it
 * lives in localStorage, which does not exist on the server, and rendering it
 * during the first pass would mismatch the prerendered HTML.
 *
 * `loaded` distinguishes "no progress yet" from "not read yet", so the UI can
 * hold its space instead of flashing "not attempted" at a returning learner.
 */
export interface Loaded<T> {
  data: T;
  loaded: boolean;
  error: string | null;
  reload: () => void;
}

function useStoreRead<T>(
  read: () => Promise<T>,
  fallback: T,
  deps: unknown[],
): Loaded<T> {
  const [data, setData] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    read()
      .then((value) => {
        if (!live) return;
        setData(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loaded, error, reload: () => setNonce((n) => n + 1) };
}

/** Every section's standing in one course, keyed by section id. */
export function useProgress(courseId: string): Loaded<Map<string, ProgressRow>> {
  return useStoreRead(
    async () =>
      new Map(
        (await progressStore().progress(courseId)).map((r) => [r.sectionId, r]),
      ),
    new Map<string, ProgressRow>(),
    [courseId],
  );
}

/** Progress across several courses at once, for the course index. */
export function useCourseTotals(
  courseIds: string[],
): Loaded<Map<string, number>> {
  const key = courseIds.join(",");
  return useStoreRead(
    async () => {
      const store = progressStore();
      const entries = await Promise.all(
        courseIds.map(async (id) => {
          try {
            return [id, (await store.progress(id)).length] as const;
          } catch {
            // One unreadable course should not blank out the whole index.
            return [id, 0] as const;
          }
        }),
      );
      return new Map(entries);
    },
    new Map<string, number>(),
    [key],
  );
}

export function useMistakes(courseId: string): Loaded<MistakeRow[]> {
  return useStoreRead(
    () => progressStore().mistakes(courseId),
    [] as MistakeRow[],
    [courseId],
  );
}
