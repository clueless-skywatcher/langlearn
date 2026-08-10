"use client";

import Link from "next/link";

import { useProgress } from "@/lib/progress/useProgress";
import type { ProgressRow } from "@/lib/progress/types";

export interface PathEntry {
  id: string;
  title: string;
  summary: string;
  level: string;
  kind: "lesson" | "checkpoint" | "boundary";
  questions: number;
  marks: number;
  covers: number;
}

/** What each kind is called, and what its button offers to do. */
const KIND = {
  lesson: { badge: null, cta: "Drill" },
  checkpoint: { badge: "Checkpoint", cta: "Sit the checkpoint" },
  boundary: {
    badge: "Boundary examination",
    cta: "Sit the boundary examination",
  },
} as const;

function ProgressBadge({
  row,
  loaded,
}: {
  row: ProgressRow | undefined;
  loaded: boolean;
}) {
  // Hold the space until the store has been read, rather than telling a
  // returning learner they have never attempted anything.
  if (!loaded) return <span className="text-xs text-transparent">—</span>;
  if (!row) return <span className="text-xs text-ink-faint">not attempted</span>;

  const pct = (row.bestPercent ?? 0).toFixed(0);
  const tone = row.passed
    ? "bg-correct-soft text-correct"
    : (row.bestPercent ?? 0) >= 60
      ? "bg-accent-soft text-accent"
      : "bg-partial-soft text-partial";

  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      best {pct}%
      {row.attemptCount > 1 ? ` · ${row.attemptCount} attempts` : ""}
    </span>
  );
}

/** One CEFR level's worth of the path, with the learner's standing on each section. */
export function PathList({
  courseId,
  groups,
}: {
  courseId: string;
  groups: { level: string; sections: PathEntry[] }[];
}) {
  const { data: progress, loaded } = useProgress(courseId);

  return (
    <>
      {groups.map(({ level, sections }) => (
        <section key={level} className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            {level}
          </h2>

          <ol className="space-y-3">
            {sections.map((section) => {
              const kind = KIND[section.kind];
              const isExam = section.kind !== "lesson";
              return (
              <li
                key={section.id}
                className={`rounded border bg-raised p-4 ${
                  section.kind === "boundary"
                    ? "border-accent"
                    : isExam
                      ? "border-accent/50"
                      : "border-rule"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <h3 className="text-lg tracking-tight">
                    {kind.badge && (
                      <span className="mr-2 text-xs uppercase tracking-wide text-accent">
                        {kind.badge}
                      </span>
                    )}
                    {section.title}
                  </h3>
                  <ProgressBadge
                    row={progress.get(section.id)}
                    loaded={loaded}
                  />
                </div>

                <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
                  {section.summary}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  {/* Only a lesson has anything to study; an exam teaches
                      nothing of its own and has no /learn/ page. */}
                  {!isExam && (
                    <Link
                      href={`/${courseId}/learn/${section.id}`}
                      className="rounded border border-rule px-3 py-1.5 hover:border-accent"
                    >
                      Study
                    </Link>
                  )}
                  <Link
                    href={`/${courseId}/drill/${section.id}`}
                    className="rounded bg-accent px-3 py-1.5 font-medium text-paper"
                  >
                    {kind.cta}
                  </Link>
                  <span className="text-xs text-ink-faint">
                    {section.questions} questions · {section.marks} marks
                    {isExam && ` · covers ${section.covers} sections`}
                  </span>
                </div>
              </li>
              );
            })}
          </ol>
        </section>
      ))}
    </>
  );
}
