import Link from "next/link";
import { notFound } from "next/navigation";

import { RuleList } from "@/components/RuleList";
import { ScriptTable } from "@/components/ScriptTable";
import { VocabList } from "@/components/VocabList";
import {
  allCourses,
  findCourse,
  getSection,
  nextSection,
} from "@/content/loader";
import { isCheckpoint } from "@/content/schema";

export function generateStaticParams() {
  return allCourses().flatMap(({ course, sections }) =>
    sections
      .filter((s) => !isCheckpoint(s))
      .map((s) => ({ course: course.id, section: s.id })),
  );
}

export default async function LearnPage(
  props: PageProps<"/[course]/learn/[section]">,
) {
  const { course: courseId, section: sectionId } = await props.params;
  const pack = findCourse(courseId);
  const section = getSection(courseId, sectionId);
  if (!pack || !section || isCheckpoint(section)) notFound();

  const next = nextSection(courseId, sectionId);

  return (
    <article>
      <p className="text-xs uppercase tracking-wide text-ink-faint">
        {section.level} · Section {section.order}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {section.title}
      </h1>
      <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
        {section.summary}
      </p>

      <hr className="my-8 border-rule" />

      {section.script && <ScriptTable script={section.script} />}

      <RuleList rules={section.rules} />

      <VocabList vocabulary={section.vocabulary} course={pack.course} />

      <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
        <Link
          href={`/${courseId}/drill/${section.id}`}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-paper"
        >
          Drill this section
        </Link>
        {next && (
          <Link
            href={
              isCheckpoint(next)
                ? `/${courseId}/drill/${next.id}`
                : `/${courseId}/learn/${next.id}`
            }
            className="rounded border border-rule px-4 py-2 text-sm hover:border-accent"
          >
            Next: {next.title}
          </Link>
        )}
      </div>
    </article>
  );
}
