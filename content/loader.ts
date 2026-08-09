import fs from "node:fs";
import path from "node:path";

import {
  CEFR_LEVELS,
  Course,
  Section,
  type CefrLevel,
  type Course as CourseType,
  type Section as SectionType,
} from "./schema";

export const CONTENT_ROOT = path.join(process.cwd(), "content");

export interface CoursePack {
  course: CourseType;
  /** Every section, in path order: by level, then by `order` within the level. */
  sections: SectionType[];
}

export class ContentError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "ContentError";
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (cause) {
    throw new ContentError(
      cause instanceof Error ? cause.message : String(cause),
      path.relative(process.cwd(), file),
    );
  }
}

/** Path order: level first, then the `order` field within the level. */
export function comparePathOrder(a: SectionType, b: SectionType): number {
  const byLevel =
    CEFR_LEVELS.indexOf(a.level) - CEFR_LEVELS.indexOf(b.level);
  return byLevel !== 0 ? byLevel : a.order - b.order;
}

/** Read and validate one course pack from `content/<id>/`. Throws on any error. */
export function loadCoursePack(courseId: string): CoursePack {
  const dir = path.join(CONTENT_ROOT, courseId);
  const courseFile = path.join(dir, "course.json");

  const courseParsed = Course.safeParse(readJson(courseFile));
  if (!courseParsed.success) {
    throw new ContentError(
      formatZodError(courseParsed.error),
      path.relative(process.cwd(), courseFile),
    );
  }

  const sectionsDir = path.join(dir, "sections");
  const files = fs
    .readdirSync(sectionsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const sections: SectionType[] = [];
  for (const name of files) {
    const file = path.join(sectionsDir, name);
    const parsed = Section.safeParse(readJson(file));
    if (!parsed.success) {
      throw new ContentError(
        formatZodError(parsed.error),
        path.relative(process.cwd(), file),
      );
    }
    sections.push(parsed.data);
  }

  sections.sort(comparePathOrder);
  return { course: courseParsed.data, sections };
}

function formatZodError(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"} — ${i.message}`)
    .join("; ");
}

/** Course ids available under `content/`, i.e. directories with a course.json. */
export function listCourseIds(): string[] {
  return fs
    .readdirSync(CONTENT_ROOT, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        fs.existsSync(path.join(CONTENT_ROOT, e.name, "course.json")),
    )
    .map((e) => e.name)
    .sort();
}

/* --------------------------------------------------------------- accessors */

let cached: Map<string, CoursePack> | null = null;

/**
 * Packs are read once per process. Content is static at runtime — it is
 * committed to the repository, not edited through the app — so there is
 * nothing to invalidate.
 */
function packs(): Map<string, CoursePack> {
  if (!cached) {
    cached = new Map(
      listCourseIds().map((id) => [id, loadCoursePack(id)] as const),
    );
  }
  return cached;
}

/**
 * Every pack, in the order the course index should list them. There is no
 * default course: a course id is part of every route, so that adding a pack
 * under content/ is the whole of adding a language.
 */
export function allCourses(): CoursePack[] {
  return [...packs().values()].sort((a, b) =>
    a.course.englishName.localeCompare(b.course.englishName),
  );
}

export function findCourse(courseId: string): CoursePack | undefined {
  return packs().get(courseId);
}

export function getCourse(courseId: string): CoursePack {
  const pack = findCourse(courseId);
  if (!pack) throw new Error(`no such course: ${courseId}`);
  return pack;
}

export function getSection(
  courseId: string,
  sectionId: string,
): SectionType | undefined {
  return findCourse(courseId)?.sections.find((s) => s.id === sectionId);
}

/** Sections grouped by level, each group already in path order. */
export function sectionsByLevel(
  courseId: string,
): { level: CefrLevel; sections: SectionType[] }[] {
  const { course, sections } = getCourse(courseId);
  return course.levels
    .map((level) => ({
      level,
      sections: sections.filter((s) => s.level === level),
    }))
    .filter((g) => g.sections.length > 0);
}

/** The section a learner reaches next after this one, in path order. */
export function nextSection(
  courseId: string,
  sectionId: string,
): SectionType | undefined {
  const { sections } = getCourse(courseId);
  const i = sections.findIndex((s) => s.id === sectionId);
  return i >= 0 ? sections[i + 1] : undefined;
}

/** `{ courseId, sectionId }` for every section of every pack — for generateStaticParams. */
export function allSectionParams(): { course: string; section: string }[] {
  return allCourses().flatMap(({ course, sections }) =>
    sections.map((s) => ({ course: course.id, section: s.id })),
  );
}
