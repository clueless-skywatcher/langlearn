import Link from "next/link";
import { notFound } from "next/navigation";

import { DrillRunner } from "@/components/DrillRunner";
import { SourceFooter } from "@/components/SourceFooter";
import { allSectionParams, findCourse, getSection } from "@/content/loader";
import { atomicQuestions, isExam } from "@/content/schema";
import { maxScoreOf } from "@/lib/scoring";

export function generateStaticParams() {
  return allSectionParams();
}

export default async function DrillPage(
  props: PageProps<"/[course]/drill/[section]">,
) {
  const { course: courseId, section: sectionId } = await props.params;
  const pack = findCourse(courseId);
  const section = getSection(courseId, sectionId);
  if (!pack || !section) notFound();

  const titles = Object.fromEntries(pack.sections.map((s) => [s.id, s.title]));
  const exam = isExam(section);
  const count = atomicQuestions(section.drills).length;

  const kindLabel =
    section.kind === "boundary"
      ? "Boundary examination"
      : section.kind === "checkpoint"
        ? "Checkpoint"
        : "Drill";

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-faint">
        {kindLabel} · {section.level}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {section.title}
      </h1>

      <p className="mt-2 text-sm text-ink-soft">
        {count} questions · {maxScoreOf(section.drills)} marks available ·{" "}
        {exam
          ? `pass mark ${section.passThreshold}%`
          : "practice, with answers as you go"}
      </p>

      {exam && (
        <p className="mt-4 rounded border border-accent/50 bg-accent-soft/50 px-4 py-3 text-sm text-ink-soft">
          {section.kind === "boundary"
            ? `This paper examines the whole of ${section.level} and admits you to ${section.admitsTo}. It covers `
            : "This paper covers "}
          {section.covers.map((id, i) => (
            <span key={id}>
              {i > 0 && (i === section.covers.length - 1 ? " and " : ", ")}
              <Link
                href={`/${courseId}/learn/${id}`}
                className="text-accent hover:underline"
              >
                {titles[id] ?? id}
              </Link>
            </span>
          ))}
          . Marks follow the JEE scheme: <strong>+4</strong> for a correct
          answer, <strong>−1</strong> for a wrong single-correct or matching
          answer, partial credit on multiple-correct questions, and{" "}
          <strong>−2</strong> there if any wrong option is chosen. Integer
          answers are never marked negative.
        </p>
      )}

      <hr className="my-8 border-rule" />

      <DrillRunner
        section={section}
        courseId={courseId}
        sectionTitles={titles}
      />

      <SourceFooter sources={section.sources} />
    </div>
  );
}
