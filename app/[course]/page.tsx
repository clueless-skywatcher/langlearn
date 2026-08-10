import { notFound } from "next/navigation";

import { PathList, type PathEntry } from "@/components/PathList";
import { allCourses, findCourse, sectionsByLevel } from "@/content/loader";
import { atomicQuestions, isExam } from "@/content/schema";
import { maxScoreOf } from "@/lib/scoring";

export function generateStaticParams() {
  return allCourses().map(({ course }) => ({ course: course.id }));
}

export default async function CoursePath(props: PageProps<"/[course]">) {
  const { course: courseId } = await props.params;
  const pack = findCourse(courseId);
  if (!pack) notFound();

  const groups = sectionsByLevel(courseId).map(({ level, sections }) => ({
    level,
    sections: sections.map(
      (section): PathEntry => ({
        id: section.id,
        title: section.title,
        summary: section.summary,
        level: section.level,
        // The three kinds are handled separately: only a lesson has a page to
        // study, and a boundary exam is announced differently from a
        // checkpoint. Collapsing them into one boolean is what sent the
        // boundary exam to /learn/, which 404s.
        kind: section.kind,
        questions: atomicQuestions(section.drills).length,
        marks: maxScoreOf(section.drills),
        covers: isExam(section) ? section.covers.length : 0,
      }),
    ),
  }));

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">
        {pack.course.englishName}
      </h1>
      <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
        {pack.course.description}
      </p>

      <PathList courseId={courseId} groups={groups} />
    </div>
  );
}
