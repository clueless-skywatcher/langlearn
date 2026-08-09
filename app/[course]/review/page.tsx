import { notFound } from "next/navigation";

import { ReviewList, type ReviewQuestion } from "@/components/ReviewList";
import { allCourses, findCourse } from "@/content/loader";
import { atomicQuestions } from "@/content/schema";

export function generateStaticParams() {
  return allCourses().map(({ course }) => ({ course: course.id }));
}

export default async function ReviewPage(
  props: PageProps<"/[course]/review">,
) {
  const { course: courseId } = await props.params;
  const pack = findCourse(courseId);
  if (!pack) notFound();

  const titles = Object.fromEntries(pack.sections.map((s) => [s.id, s.title]));

  // Which questions the learner got wrong is private to their machine, so the
  // lookup table travels to the client and the matching happens there.
  const questions: Record<string, ReviewQuestion> = Object.fromEntries(
    pack.sections.flatMap((s) =>
      atomicQuestions(s.drills).map((q) => [
        q.id,
        { stem: q.stem, explanation: q.explanation },
      ]),
    ),
  );

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
      <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
        Every question in {pack.course.englishName} whose most recent answer was
        wrong or only partly right. Answering one correctly on a later attempt
        removes it from this list.
      </p>

      <ReviewList courseId={courseId} questions={questions} titles={titles} />
    </div>
  );
}
