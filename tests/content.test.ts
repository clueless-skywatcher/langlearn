import { describe, expect, it } from "vitest";

import {
  comparePathOrder,
  listCourseIds,
  loadCoursePack,
  type CoursePack,
} from "@/content/loader";
import {
  atomicQuestions,
  isBoundaryExam,
  isCheckpoint,
  isLesson,
  type CheckpointSection,
  type LessonSection,
} from "@/content/schema";
import { validateCoursePack } from "@/content/validate";
import { lines } from "@/lib/markdown";
import { maxScoreOf } from "@/lib/scoring";

const COURSE_IDS = listCourseIds();

function errors(p: CoursePack): string[] {
  return validateCoursePack(p)
    .filter((x) => x.severity === "error")
    .map((x) => `${x.where}: ${x.message}`);
}

/* ------------------------------------------------------------------ every pack */

describe("content packs", () => {
  it("finds at least two courses, so nothing is hardcoded to one language", () => {
    expect(COURSE_IDS.length).toBeGreaterThanOrEqual(2);
    expect(COURSE_IDS).toEqual(expect.arrayContaining(["eo", "lt"]));
  });
});

describe.each(COURSE_IDS)("course pack %s", (courseId) => {
  const pack = loadCoursePack(courseId);

  it("validates without errors", () => {
    expect(errors(pack)).toEqual([]);
  });

  it("declares an id matching its directory", () => {
    expect(pack.course.id).toBe(courseId);
  });

  it("is returned in path order", () => {
    const resorted = [...pack.sections].sort(comparePathOrder);
    expect(pack.sections.map((s) => s.id)).toEqual(
      resorted.map((s) => s.id),
    );
  });

  it("puts each checkpoint immediately after the block it covers", () => {
    const ids = pack.sections.map((s) => s.id);
    for (const section of pack.sections) {
      if (!isCheckpoint(section)) continue;
      const at = ids.indexOf(section.id);
      const before = ids.slice(at - section.covers.length, at);
      expect(before).toEqual(section.covers);
    }
  });

  it("uses all five question formats in every checkpoint", () => {
    const checkpoints = pack.sections.filter(isCheckpoint);
    expect(checkpoints.length).toBeGreaterThan(0);
    for (const cp of checkpoints) {
      const formats = new Set(
        cp.drills.flatMap((d) =>
          d.type === "comprehension"
            ? [d.type, ...d.questions.map((q) => q.type)]
            : [d.type],
        ),
      );
      expect(formats).toEqual(
        new Set(["single", "multi", "integer", "matching", "comprehension"]),
      );
      expect(atomicQuestions(cp.drills).length).toBeGreaterThanOrEqual(20);
    }
  });

  it("gives every question a unique id and four marks", () => {
    const questions = pack.sections.flatMap((s) => atomicQuestions(s.drills));
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    for (const section of pack.sections) {
      expect(maxScoreOf(section.drills)).toBe(
        atomicQuestions(section.drills).length * 4,
      );
    }
  });

  it("teaches something in every lesson section", () => {
    for (const section of pack.sections) {
      if (!isLesson(section)) continue;
      expect(section.rules.length + (section.script ? 1 : 0)).toBeGreaterThan(0);
      expect(section.vocabulary.length).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------- the validator's own behaviour */

/**
 * Driven off whichever pack is loaded first rather than off Lithuanian, so
 * these keep testing the validator and not the content of one language.
 */
const subject = loadCoursePack(COURSE_IDS[0]);

function mutable(): CoursePack {
  return structuredClone(subject);
}

function lessons(p: CoursePack): LessonSection[] {
  return p.sections.filter((s): s is LessonSection => !isCheckpoint(s));
}

function checkpoint(p: CoursePack): CheckpointSection {
  const cp = p.sections.find(isCheckpoint);
  if (!cp) throw new Error(`${p.course.id} has no checkpoint`);
  return cp;
}

/** The first standalone question of a section — comprehension blocks nest theirs. */
function firstQuestion(p: CoursePack, sectionId: string) {
  const section = p.sections.find((s) => s.id === sectionId)!;
  const drill = section.drills.find((d) => d.type !== "comprehension");
  if (!drill) throw new Error(`${sectionId} has no standalone question`);
  return drill;
}

const FIRST = subject.sections[0].id;
const SECOND = subject.sections[1].id;
const CP = checkpoint(subject).id;
/** A rule taught in the last covered section — i.e. later in the path than FIRST. */
const LATE_RULE = lessons(subject).at(-1)!.rules[0].id;
/** A word introduced in the last covered section. */
const LATE_WORD = lessons(subject).at(-1)!.vocabulary[0].lemma;

describe("referential integrity", () => {
  it("rejects a drill that tests a rule which does not exist", () => {
    const p = mutable();
    firstQuestion(p, SECOND).rulesTested = ["no-such-rule"];
    expect(errors(p)).toContainEqual(
      expect.stringContaining('tests unknown rule "no-such-rule"'),
    );
  });

  it("rejects a drill that tests a rule taught later in the path", () => {
    const p = mutable();
    firstQuestion(p, FIRST).rulesTested = [LATE_RULE];
    expect(errors(p)).toContainEqual(
      expect.stringContaining("which comes later in the path"),
    );
  });

  it("rejects vocabulary used before it is introduced", () => {
    const p = mutable();
    firstQuestion(p, FIRST).vocabUsed = [LATE_WORD];
    expect(errors(p)).toContainEqual(
      expect.stringContaining("has not been introduced by this point"),
    );
  });

  it("rejects a core rule that no drill in its own section tests", () => {
    const p = mutable();
    const section = p.sections.find((s) => s.id === SECOND)!;
    if (!isLesson(section)) throw new Error("unreachable");
    const orphan = section.rules.find((r) => r.core)!.id;
    for (const drill of section.drills) {
      const children =
        drill.type === "comprehension" ? drill.questions : [drill];
      for (const q of children) {
        q.rulesTested = q.rulesTested.filter((r) => r !== orphan);
      }
    }
    expect(errors(p)).toContainEqual(
      expect.stringContaining(`"${orphan}" is never tested`),
    );
  });

  it("rejects duplicate question ids across sections", () => {
    const p = mutable();
    firstQuestion(p, SECOND).id = firstQuestion(p, FIRST).id;
    expect(errors(p)).toContainEqual(
      expect.stringContaining(`is already used in ${FIRST}`),
    );
  });

  it("rejects a fromSection on a lesson drill", () => {
    const p = mutable();
    firstQuestion(p, SECOND).fromSection = FIRST;
    expect(errors(p)).toContainEqual(
      expect.stringContaining("on a lesson drill"),
    );
  });
});

describe("checkpoint composition", () => {
  it("rejects a checkpoint that leaves one of its covered sections untested", () => {
    const p = mutable();
    const cp = checkpoint(p);
    const dropped = cp.covers[1];
    cp.drills = cp.drills.filter((d) => d.fromSection !== dropped);
    expect(errors(p)).toContainEqual(
      expect.stringContaining(`question(s) examine ${dropped}`),
    );
  });

  it("rejects a checkpoint that does not cover the block directly before it", () => {
    const p = mutable();
    const cp = checkpoint(p);
    cp.covers = [...cp.covers.slice(0, -1), cp.id];
    expect(errors(p)).toContainEqual(
      expect.stringContaining("directly follows"),
    );
  });

  it("rejects a question attributed to a section outside the block", () => {
    const p = mutable();
    firstQuestion(p, CP).fromSection = "not-a-section";
    expect(errors(p)).toContainEqual(
      expect.stringContaining("is not among the covered sections"),
    );
  });

  it("rejects a paper missing one of the five formats", () => {
    const p = mutable();
    const cp = checkpoint(p);
    // Formats are counted through comprehension blocks, so an integer nested
    // in a passage still counts as an integer question on the paper.
    cp.drills = cp.drills.filter((d) => d.type !== "integer");
    for (const drill of cp.drills) {
      if (drill.type === "comprehension") {
        drill.questions = drill.questions.filter((q) => q.type !== "integer");
      }
    }
    expect(errors(p)).toContainEqual(
      expect.stringContaining("no integer questions"),
    );
  });

  it("rejects a paper whose difficulty mix is lopsided", () => {
    const p = mutable();
    for (const drill of checkpoint(p).drills) drill.difficulty = "easy";
    expect(errors(p)).toContainEqual(
      expect.stringContaining("the target is 25%"),
    );
  });

  it("rejects a paper that leaves a core rule of a covered section unexamined", () => {
    const p = mutable();
    const cp = checkpoint(p);
    const covered = lessons(p).find((s) => s.id === cp.covers[0])!;
    const orphan = covered.rules.find((r) => r.core)!.id;
    for (const drill of cp.drills) {
      const children =
        drill.type === "comprehension" ? drill.questions : [drill];
      for (const q of children) {
        q.rulesTested = q.rulesTested.filter((r) => r !== orphan);
      }
    }
    expect(errors(p)).toContainEqual(
      expect.stringContaining(`"${orphan}" (${covered.id}) is not examined`),
    );
  });

  it("rejects a paper that is too short", () => {
    const p = mutable();
    const cp = checkpoint(p);
    cp.drills = cp.drills.slice(0, 4);
    expect(errors(p)).toContainEqual(
      expect.stringContaining("should carry 20–70 questions"),
    );
  });
});

describe("passage rendering", () => {
  it("gives every dialogue turn its own line", () => {
    const rendered = lines("JONAS. Labas!\nRŪTA. Labas.");
    expect(Array.isArray(rendered)).toBe(true);
    expect((rendered as unknown[]).length).toBe(2);
  });

  it("keeps a blank line as a gap rather than dropping it", () => {
    expect(((lines("a\n\nb") as unknown[]) ?? []).length).toBe(3);
  });

  it("renders markdown inside a line instead of printing the asterisks", () => {
    const [first] = lines("**BIBLIOTEKA**") as { props: { children: unknown } }[];
    expect(JSON.stringify(first.props.children)).toContain("strong");
    expect(JSON.stringify(first.props.children)).not.toContain("**");
  });
});

describe("the boundary exam is findable", () => {
  it("is the last section of its level and is not a checkpoint", () => {
    for (const pack of COURSE_IDS.map((id) => loadCoursePack(id))) {
      for (const section of pack.sections.filter(isBoundaryExam)) {
        const after = pack.sections.filter(
          (s) => s.level === section.level && s.order > section.order,
        );
        expect(after).toEqual([]);
        expect(isCheckpoint(section)).toBe(false);
      }
    }
  });

  it("is the only section titled as one", () => {
    for (const pack of COURSE_IDS.map((id) => loadCoursePack(id))) {
      for (const s of pack.sections) {
        if (isBoundaryExam(s)) continue;
        expect(s.title.toLowerCase()).not.toContain("boundary exam");
      }
    }
  });
});
