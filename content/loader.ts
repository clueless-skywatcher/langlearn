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
let cachedSignature: string | null = null;

/**
 * In production, packs are read once per process: content is static at runtime
 * — committed to the repository, not edited through the app — so there is
 * nothing to invalidate.
 *
 * In development the packs are being written, and the JSON is read with `fs`
 * rather than imported, so nothing in the module graph changes when a section
 * is saved and neither Fast Refresh nor a server restart is triggered. Hence
 * the fingerprint below, which is what saves the author restarting `next dev`
 * for every edit.
 */
const WATCH_CONTENT = process.env.NODE_ENV !== "production";

/** Every pack file with its size and mtime — cheap enough to stat per request. */
function contentSignature(): string {
  const files: string[] = [];
  for (const id of listCourseIds()) {
    const dir = path.join(CONTENT_ROOT, id);
    files.push(path.join(dir, "course.json"));
    const sectionsDir = path.join(dir, "sections");
    if (fs.existsSync(sectionsDir)) {
      for (const name of fs.readdirSync(sectionsDir)) {
        if (name.endsWith(".json")) files.push(path.join(sectionsDir, name));
      }
    }
  }
  return files
    .sort()
    .map((file) => {
      const s = fs.statSync(file);
      return `${file}:${s.size}:${s.mtimeMs}`;
    })
    .join("|");
}

function readAll(): Map<string, CoursePack> {
  return new Map(
    listCourseIds().map((id) => [id, loadCoursePack(id)] as const),
  );
}

function packs(): Map<string, CoursePack> {
  if (!WATCH_CONTENT) {
    if (!cached) cached = readAll();
    return cached;
  }

  const signature = contentSignature();
  if (!cached || signature !== cachedSignature) {
    // A ContentError here is the point: a half-saved section should surface as
    // an error page, not as the previous render served from a stale cache.
    cached = readAll();
    cachedSignature = signature;
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
