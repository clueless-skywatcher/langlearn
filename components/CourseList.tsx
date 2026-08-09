"use client";

import Link from "next/link";

import { useCourseTotals } from "@/lib/progress/useProgress";

export interface CourseCard {
  id: string;
  name: string;
  englishName: string;
  description: string;
  sections: number;
  lessons: number;
  checkpoints: number;
  questions: number;
  levels: string[];
}

/**
 * The course index. Everything but the "started" count is fixed content passed
 * down from the server; only the count needs the learner's own progress.
 */
export function CourseList({ courses }: { courses: CourseCard[] }) {
  const { data: started, loaded } = useCourseTotals(courses.map((c) => c.id));

  return (
    <ul className="mt-8 space-y-4">
      {courses.map((course) => {
        const attempted = started.get(course.id) ?? 0;

        return (
          <li
            key={course.id}
            className="rounded border border-rule bg-raised p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-xl tracking-tight">
                <Link href={`/${course.id}`} className="hover:text-accent">
                  <span className="target not-italic">{course.name}</span>
                  {course.englishName !== course.name && (
                    <span className="ml-2 text-base text-ink-faint">
                      {course.englishName}
                    </span>
                  )}
                </Link>
              </h2>
              {loaded && attempted > 0 && (
                <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                  {attempted}/{course.sections} started
                </span>
              )}
            </div>

            <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
              {course.description}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <Link
                href={`/${course.id}`}
                className="rounded bg-accent px-3 py-1.5 font-medium text-paper"
              >
                Open
              </Link>
              <span className="text-xs text-ink-faint">
                {course.lessons} sections · {course.checkpoints} checkpoint
                {course.checkpoints === 1 ? "" : "s"} · {course.questions}{" "}
                questions · {course.levels.join("–")}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
