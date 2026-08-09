import Link from "next/link";
import { notFound } from "next/navigation";

import { allCourses, findCourse } from "@/content/loader";

export function generateStaticParams() {
  return allCourses().map(({ course }) => ({ course: course.id }));
}

/**
 * Everything below the course id is course-scoped, so the sub-navigation and
 * the source attribution both come from the pack rather than from the app.
 */
export default async function CourseLayout(props: LayoutProps<"/[course]">) {
  const { course: courseId } = await props.params;
  const pack = findCourse(courseId);
  if (!pack) notFound();

  const { course } = pack;

  return (
    <div lang={course.langCode} dir={course.direction}>
      <nav className="mb-8 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-rule pb-3 text-sm">
        <Link
          href={`/${course.id}`}
          className="target text-base not-italic hover:underline"
        >
          {course.name}
        </Link>
        <Link
          href={`/${course.id}`}
          className="text-ink-soft hover:text-accent"
        >
          Path
        </Link>
        <Link
          href={`/${course.id}/review`}
          className="text-ink-soft hover:text-accent"
        >
          Review
        </Link>
      </nav>

      {props.children}

      {course.attribution && (
        <footer className="mt-16 border-t border-rule pt-4 text-xs text-ink-faint">
          {course.attribution}
        </footer>
      )}
    </div>
  );
}
