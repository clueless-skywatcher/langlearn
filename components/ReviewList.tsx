"use client";

import Link from "next/link";

import { inline } from "@/lib/markdown";
import { useMistakes } from "@/lib/progress/useProgress";

/** Just enough of each question to render it in the review list. */
export interface ReviewQuestion {
  stem: string;
  explanation: string;
}

export function ReviewList({
  courseId,
  questions,
  titles,
}: {
  courseId: string;
  questions: Record<string, ReviewQuestion>;
  titles: Record<string, string>;
}) {
  const { data: mistakes, loaded, error } = useMistakes(courseId);

  if (error) {
    return (
      <p className="mt-8 rounded border border-wrong/40 bg-wrong-soft px-4 py-4 text-sm text-wrong">
        Could not read your progress: {error}
      </p>
    );
  }

  if (!loaded) {
    return (
      <p className="mt-8 text-sm text-ink-faint">Reading your progress…</p>
    );
  }

  if (mistakes.length === 0) {
    return (
      <p className="mt-8 rounded border border-rule bg-raised px-4 py-6 text-center text-sm text-ink-faint">
        Nothing to review. Sit a drill and this fills itself.
      </p>
    );
  }

  return (
    <ul className="mt-8 space-y-4">
      {mistakes.map((m) => {
        const q = questions[m.questionId];
        return (
          <li
            key={m.questionId}
            className="rounded border border-rule bg-raised p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-ink-faint">
              <span>
                <Link
                  href={`/${courseId}/learn/${m.sourceSectionId}`}
                  className="hover:text-accent"
                >
                  {titles[m.sourceSectionId] ?? m.sourceSectionId}
                </Link>
                {m.sectionId !== m.sourceSectionId && (
                  <> · asked in {titles[m.sectionId] ?? m.sectionId}</>
                )}
              </span>
              <span
                className={
                  m.verdict === "partial" ? "text-partial" : "text-wrong"
                }
              >
                {m.verdict} · {m.score}/{m.maxScore}
              </span>
            </div>

            <p className="mt-2 leading-relaxed">
              {q ? inline(q.stem) : <em>{m.questionId}</em>}
            </p>

            {q && (
              <p className="mt-2 text-sm text-ink-soft">
                {inline(q.explanation)}
              </p>
            )}

            <Link
              href={`/${courseId}/drill/${m.sectionId}`}
              className="mt-3 inline-block text-sm text-accent hover:underline"
            >
              Retake {titles[m.sectionId] ?? m.sectionId} →
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
