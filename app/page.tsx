import { CourseList, type CourseCard } from "@/components/CourseList";
import { allCourses } from "@/content/loader";
import { atomicQuestions, isLesson } from "@/content/schema";

/**
 * Fully static: the content is fixed at build time, and the learner's progress
 * is fetched by the client from whichever store this build uses.
 */
export default function CourseIndex() {
  const courses: CourseCard[] = allCourses().map(({ course, sections }) => {
    const lessons = sections.filter(isLesson).length;
    return {
      id: course.id,
      name: course.name,
      englishName: course.englishName,
      description: course.description,
      sections: sections.length,
      lessons,
      checkpoints: sections.length - lessons,
      questions: sections.reduce(
        (n, s) => n + atomicQuestions(s.drills).length,
        0,
      ),
      levels: course.levels,
    };
  });

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Courses</h1>
      <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
        Each course is a graded path from the writing system to near-native
        command: numbered grammar rules and vocabulary, then examination drills,
        with a cumulative checkpoint after every block of sections.
      </p>

      <CourseList courses={courses} />
    </div>
  );
}
