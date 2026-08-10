import {
  atomicQuestions,
  isCheckpoint,
  sourceSection,
  type AtomicQuestion,
  type Drill,
  type Section,
} from "./schema";
import { loadCoursePack, type CoursePack } from "./loader";
import { teluguRuns } from "@/lib/translit";

/**
 * Integrity checks that the Zod schema cannot express, because they are about
 * relationships *between* sections: that a drill only tests what has already
 * been taught, that every core rule is actually drilled, and that each
 * checkpoint is a fair examination of the block it claims to cover.
 */

export type Severity = "error" | "warning";

export interface Problem {
  severity: Severity;
  /** Section id, or the course id for whole-pack problems. */
  where: string;
  message: string;
}

/** Composition targets for a checkpoint, enforced rather than left to taste. */
export const CHECKPOINT_TARGETS = {
  minQuestions: 20,
  maxQuestions: 55,
  minPerCoveredSection: 3,
  /** Intended share of each difficulty band, in percent. */
  difficultyMix: { easy: 25, medium: 40, hard: 35 },
  /** How far a band may stray from its target, in percentage points. */
  difficultyTolerance: 15,
} as const;

/** Lesson drill sets are shorter; a checkpoint is where breadth is demanded. */
export const LESSON_TARGETS = {
  minQuestions: 8,
  maxQuestions: 40,
  /**
   * A section teaching a writing system may run longer. A grammatical rule has
   * a handful of applications worth drilling; an alphabet has one atom per
   * letter, and a learner meeting a new script needs volume rather than depth.
   */
  maxQuestionsWithScript: 50,
} as const;

/** The drill-set ceiling for a lesson, which depends on whether it teaches a script. */
export function lessonMaxQuestions(hasScript: boolean): number {
  return hasScript
    ? LESSON_TARGETS.maxQuestionsWithScript
    : LESSON_TARGETS.maxQuestions;
}

/**
 * A course written in a non-Latin script declares `transliteration` in its
 * course file, and the UI then derives a romanization for every piece of
 * target-language text it renders (see `lib/markdown.ts`). That is what keeps
 * the course completable by a learner who skipped the sections teaching the
 * script — a multiple-choice question whose four options are unreadable is not
 * a hard question, it is an unanswerable one.
 *
 * Because the romanization is derived rather than stored, the content cannot
 * fall out of step with it. The one thing that *can* go wrong is a character
 * the transliterator does not know, which would pass through untouched and
 * leave the learner with script they cannot read. That is what this checks.
 */
function transliterationProblems(pack: CoursePack): Problem[] {
  const problems: Problem[] = [];
  if (!pack.course.transliteration?.required) return problems;

  const unmapped = new Map<string, string>();

  const check = (where: string, text: string | undefined) => {
    if (!text) return;
    for (const run of teluguRuns(text)) {
      for (const ch of run.roman) {
        // Anything still in the Telugu block survived transliteration.
        if (ch >= "\u0C00" && ch <= "\u0C7F" && !unmapped.has(ch)) {
          unmapped.set(ch, where);
        }
      }
    }
  };

  for (const section of pack.sections) {
    const at = section.id;
    check(at, section.title);
    check(at, section.summary);

    if (!isCheckpoint(section)) {
      check(at, section.script?.heading);
      section.script?.letters.forEach((l) => check(at, l.glyph));
      section.script?.notes.forEach((n) => check(at, n));
      for (const rule of section.rules) {
        check(at, rule.heading);
        check(at, rule.statement);
        rule.footnotes.forEach((f) => check(at, f));
        for (const ex of rule.examples) {
          check(at, ex.target);
          check(at, ex.note);
        }
        for (const p of rule.paradigms) {
          check(at, p.caption);
          check(at, p.footnote);
          p.columns.forEach((c) => check(at, c));
          for (const row of p.rows) {
            check(at, row.label);
            row.cells.forEach((c) => check(at, c));
          }
        }
      }
      for (const v of section.vocabulary) {
        check(at, v.lemma);
        check(at, v.gloss);
        check(at, v.notes);
      }
    }

    for (const drill of section.drills) {
      if (drill.type === "comprehension") {
        check(at, drill.title);
        check(at, drill.passage);
        Object.keys(drill.glossary).forEach((w) => check(at, w));
      }
      const children =
        drill.type === "comprehension" ? drill.questions : [drill];
      for (const q of children) {
        check(at, q.stem);
        check(at, q.explanation);
        if (q.type !== "integer") q.options.forEach((o) => check(at, o));
      }
    }
  }

  for (const [ch, where] of unmapped) {
    problems.push({
      severity: "error",
      where,
      message: `the transliterator has no reading for ${JSON.stringify(ch)} (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}), so it would reach the learner unromanized`,
    });
  }

  return problems;
}

/** From B1 up, comprehension carries more of the weight. */
const HEAVY_COMPREHENSION_LEVELS = new Set(["B1", "B2", "C1", "C2"]);

export function validateCoursePack(pack: CoursePack): Problem[] {
  const problems: Problem[] = [];
  const { course, sections } = pack;

  const err = (where: string, message: string) =>
    problems.push({ severity: "error", where, message });
  const warn = (where: string, message: string) =>
    problems.push({ severity: "warning", where, message });

  /* ------------------------------------------------- uniqueness and ordering */

  const seenSectionIds = new Set<string>();
  const orderByLevel = new Map<string, Map<number, string>>();
  const ruleOwner = new Map<string, string>();
  const ruleNumberOwner = new Map<string, string>();
  const questionOwner = new Map<string, string>();

  for (const section of sections) {
    if (seenSectionIds.has(section.id)) {
      err(section.id, "duplicate section id");
    }
    seenSectionIds.add(section.id);

    if (!course.levels.includes(section.level)) {
      err(section.id, `level ${section.level} is not listed in course.json`);
    }

    let orders = orderByLevel.get(section.level);
    if (!orders) {
      orders = new Map();
      orderByLevel.set(section.level, orders);
    }
    const clash = orders.get(section.order);
    if (clash) {
      err(
        section.id,
        `order ${section.order} in level ${section.level} is already taken by ${clash}`,
      );
    }
    orders.set(section.order, section.id);

    if (!isCheckpoint(section)) {
      for (const rule of section.rules) {
        const owner = ruleOwner.get(rule.id);
        if (owner) {
          err(section.id, `rule id "${rule.id}" is already defined in ${owner}`);
        }
        ruleOwner.set(rule.id, section.id);

        const numberOwner = ruleNumberOwner.get(rule.number);
        if (numberOwner) {
          err(
            section.id,
            `rule number ¶${rule.number} is already used in ${numberOwner}`,
          );
        }
        ruleNumberOwner.set(rule.number, section.id);
      }
    }

    for (const q of atomicQuestions(section.drills)) {
      const owner = questionOwner.get(q.id);
      if (owner) {
        err(section.id, `question id "${q.id}" is already used in ${owner}`);
      }
      questionOwner.set(q.id, section.id);
    }
  }

  /* --------------------------------- what each section is allowed to draw on */

  // Path order is already established by the loader, so "everything taught so
  // far" is simply the prefix of the section list.
  const rulesUpTo = new Map<string, Set<string>>();
  const vocabUpTo = new Map<string, Set<string>>();
  const rulesSoFar = new Set<string>();
  const vocabSoFar = new Set<string>();

  for (const section of sections) {
    if (!isCheckpoint(section)) {
      for (const rule of section.rules) rulesSoFar.add(rule.id);
      for (const entry of section.vocabulary) vocabSoFar.add(entry.lemma);
    }
    rulesUpTo.set(section.id, new Set(rulesSoFar));
    vocabUpTo.set(section.id, new Set(vocabSoFar));
  }

  /* ------------------------------------------------------ per-section checks */

  const lessonIndex = new Map<string, Section>();
  for (const s of sections) if (!isCheckpoint(s)) lessonIndex.set(s.id, s);

  for (const section of sections) {
    const questions = atomicQuestions(section.drills);
    const availableRules = rulesUpTo.get(section.id)!;
    const availableVocab = vocabUpTo.get(section.id)!;

    for (const q of questions) {
      for (const ruleId of q.rulesTested) {
        if (!ruleOwner.has(ruleId)) {
          err(section.id, `${q.id}: tests unknown rule "${ruleId}"`);
        } else if (!availableRules.has(ruleId)) {
          err(
            section.id,
            `${q.id}: tests rule "${ruleId}" from ${ruleOwner.get(ruleId)}, which comes later in the path`,
          );
        }
      }
      for (const lemma of q.vocabUsed) {
        if (!availableVocab.has(lemma)) {
          err(
            section.id,
            `${q.id}: uses "${lemma}", which has not been introduced by this point`,
          );
        }
      }
    }

    if (isCheckpoint(section)) {
      validateCheckpoint(section, sections, lessonIndex, problems);
      continue;
    }

    /* ------------------------------------------------------ lesson sections */

    const maxQuestions = lessonMaxQuestions(!!section.script);
    if (
      questions.length < LESSON_TARGETS.minQuestions ||
      questions.length > maxQuestions
    ) {
      err(
        section.id,
        `a lesson should carry ${LESSON_TARGETS.minQuestions}–${maxQuestions} questions${section.script ? " (it teaches a script, so the ceiling is raised)" : ""}; this one has ${questions.length}`,
      );
    }

    if (section.rules.length === 0 && !section.script) {
      err(section.id, "a lesson must teach something: no rules and no script");
    }

    const tested = new Set(questions.flatMap((q) => q.rulesTested));
    for (const rule of section.rules) {
      if (rule.core && !tested.has(rule.id)) {
        err(
          section.id,
          `core rule ¶${rule.number} "${rule.id}" is never tested by this section's drills`,
        );
      }
    }

    for (const rule of section.rules) {
      for (const ref of rule.seeAlso) {
        if (!ruleOwner.has(ref)) {
          err(section.id, `rule "${rule.id}" cross-references unknown rule "${ref}"`);
        } else if (!availableRules.has(ref)) {
          err(
            section.id,
            `rule "${rule.id}" cross-references "${ref}", which is taught later`,
          );
        }
      }
    }

    for (const drill of section.drills) {
      const stray = [
        drill.fromSection,
        ...(drill.type === "comprehension"
          ? drill.questions.map((q) => q.fromSection)
          : []),
      ].filter((s): s is string => !!s && s !== section.id);
      if (stray.length) {
        err(
          section.id,
          `${drill.id}: fromSection "${stray[0]}" on a lesson drill; lesson items examine their own section`,
        );
      }
    }
  }

  /* ------------------------------------------- every lesson gets an exam */

  const covered = new Set(
    sections.flatMap((s) => (isCheckpoint(s) ? s.covers : [])),
  );
  const lastCheckpointIndex = sections.reduce(
    (last, s, i) => (isCheckpoint(s) ? i : last),
    -1,
  );

  sections.forEach((section, i) => {
    if (isCheckpoint(section) || covered.has(section.id)) return;
    if (i < lastCheckpointIndex) {
      err(section.id, "no checkpoint covers this section");
    } else {
      // Sections authored past the final checkpoint are work in progress.
      warn(section.id, "not yet covered by a checkpoint");
    }
  });

  problems.push(...transliterationProblems(pack));

  return problems;
}

function validateCheckpoint(
  section: Extract<Section, { kind: "checkpoint" }>,
  sections: Section[],
  lessonIndex: Map<string, Section>,
  problems: Problem[],
): void {
  const err = (message: string) =>
    problems.push({ severity: "error", where: section.id, message });

  /* ------------------------------------------------- what it claims to cover */

  for (const id of section.covers) {
    if (!lessonIndex.has(id)) {
      err(`covers "${id}", which is not a lesson section`);
    }
  }

  // The block a checkpoint examines is the run of lessons directly before it.
  const at = sections.findIndex((s) => s.id === section.id);
  const expected: string[] = [];
  for (let i = at - 1; i >= 0 && expected.length < section.covers.length; i--) {
    const prev = sections[i];
    if (isCheckpoint(prev)) break;
    expected.unshift(prev.id);
  }
  if (expected.join(",") !== section.covers.join(",")) {
    err(
      `covers [${section.covers.join(", ")}] but directly follows [${expected.join(", ") || "nothing"}]`,
    );
  }

  /* ------------------------------------------------------------ composition */

  const questions = atomicQuestions(section.drills);

  if (
    questions.length < CHECKPOINT_TARGETS.minQuestions ||
    questions.length > CHECKPOINT_TARGETS.maxQuestions
  ) {
    err(
      `a checkpoint should carry ${CHECKPOINT_TARGETS.minQuestions}–${CHECKPOINT_TARGETS.maxQuestions} questions; this one has ${questions.length}`,
    );
  }

  const perSection = new Map<string, number>();
  for (const drill of section.drills) {
    const children: AtomicQuestion[] =
      drill.type === "comprehension" ? drill.questions : [drill];
    for (const q of children) {
      const from = sourceSection(drill, q, "");
      if (!from) {
        err(`${q.id}: no fromSection, so it cannot be attributed to a section`);
        continue;
      }
      if (!section.covers.includes(from)) {
        err(`${q.id}: fromSection "${from}" is not among the covered sections`);
        continue;
      }
      perSection.set(from, (perSection.get(from) ?? 0) + 1);
    }
  }

  for (const id of section.covers) {
    const n = perSection.get(id) ?? 0;
    if (n < CHECKPOINT_TARGETS.minPerCoveredSection) {
      err(
        `only ${n} question(s) examine ${id}; at least ${CHECKPOINT_TARGETS.minPerCoveredSection} are required`,
      );
    }
  }

  /* ---------------------------------------------------- core rule coverage */

  const tested = new Set(questions.flatMap((q) => q.rulesTested));
  for (const id of section.covers) {
    const lesson = lessonIndex.get(id);
    if (!lesson || isCheckpoint(lesson)) continue;
    for (const rule of lesson.rules) {
      if (rule.core && !tested.has(rule.id)) {
        err(`core rule ¶${rule.number} "${rule.id}" (${id}) is not examined`);
      }
    }
  }

  /* -------------------------------------------------------- difficulty mix */

  const bands: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  for (const q of questions) bands[q.difficulty] += 1;

  for (const [band, target] of Object.entries(
    CHECKPOINT_TARGETS.difficultyMix,
  )) {
    const share = (bands[band] / questions.length) * 100;
    if (Math.abs(share - target) > CHECKPOINT_TARGETS.difficultyTolerance) {
      err(
        `${band} questions are ${share.toFixed(0)}% of the paper; the target is ${target}% ±${CHECKPOINT_TARGETS.difficultyTolerance}`,
      );
    }
  }

  /* ------------------------------------------------------------ format mix */

  const formats = new Set<string>(section.drills.map((d) => d.type));
  for (const type of ["single", "multi", "integer", "comprehension"]) {
    if (!formats.has(type)) {
      err(`no ${type} questions; a checkpoint must use all four formats`);
    }
  }

  const passages = section.drills.filter(
    (d): d is Extract<Drill, { type: "comprehension" }> =>
      d.type === "comprehension",
  );

  if (HEAVY_COMPREHENSION_LEVELS.has(section.level)) {
    if (passages.length < 2) {
      err(
        `only ${passages.length} comprehension passage(s); ${section.level} checkpoints need at least 2`,
      );
    }
    const integerInPassage = passages.some((p) =>
      p.questions.some((q) => q.type === "integer"),
    );
    if (!integerInPassage) {
      err(
        `${section.level} checkpoints must embed at least one integer-answer question in a passage`,
      );
    }
  }
}

/** Validate every pack under `content/`. Loader failures become errors. */
export function validateAll(courseIds: string[]): Problem[] {
  const problems: Problem[] = [];
  for (const id of courseIds) {
    try {
      problems.push(...validateCoursePack(loadCoursePack(id)));
    } catch (cause) {
      problems.push({
        severity: "error",
        where: id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return problems;
}
