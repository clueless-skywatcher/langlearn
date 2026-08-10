import {
  atomicQuestions,
  isBoundaryExam,
  isCheckpoint,
  isExam,
  isLesson,
  sourceSection,
  type AtomicQuestion,
  type Drill,
  type ExamSection,
  type LessonSection,
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
  maxQuestions: 70,
  minPerCoveredSection: 3,
  /** Intended share of each difficulty band, in percent. */
  difficultyMix: { easy: 25, medium: 40, hard: 35 },
  /** How far a band may stray from its target, in percentage points. */
  difficultyTolerance: 15,
} as const;

/**
 * A boundary exam sits at a level transition and examines the whole level, so
 * it is longer than a checkpoint, harder, and weighted towards the two formats
 * that cannot be passed by recall: matching, which gives nothing for three
 * pairs out of four, and comprehension, which puts the rules back into prose.
 */
export const BOUNDARY_TARGETS = {
  minQuestions: 40,
  maxQuestions: 120,
  /** Every lesson in the level must be examined at least this many times. */
  minPerCoveredSection: 2,
  /** Harder than a checkpoint: the hard band carries most of the paper. */
  difficultyMix: { easy: 10, medium: 35, hard: 55 },
  difficultyTolerance: 12,
  /** Least share of the paper, in percent, that must be matching questions. */
  minMatchingShare: 12,
  /** Least share of the paper that must sit inside a comprehension passage. */
  minComprehensionShare: 15,
  minPassages: 2,
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

    if (isLesson(section)) {
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
        // A matching question's options are index tuples; its target-language
        // text is in the two columns instead.
        if (q.type === "matching") {
          q.columnHeadings.forEach((h) => check(at, h));
          q.columnI.forEach((c) => check(at, c));
          q.columnII.forEach((c) => check(at, c));
        } else if (q.type !== "integer") {
          q.options.forEach((o) => check(at, o));
        }
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

/**
 * Questions that test the printed form of a word rather than the language.
 * Counting the letters in *norėčiau* is a question about a string; a learner
 * who has never met the conditional can answer it, and one who has mastered
 * the conditional can get it wrong by miscounting. `integer` questions are for
 * grammatical counts — how many case forms a paradigm collapses, which
 * numbered rule governs a form — and this is what they are not for.
 */
const SURFACE_COUNTING =
  /how many\s+(?:\*\*)?(?:letters?|vowels?|consonants?|commas?|syllables?|characters?)(?:\*\*)?\s+(?:are\s+)?(?:there\s+)?(?:in|of|does|do|has|have)\b/i;

/**
 * Words are a special case. "How many words are in this sentence" counts a
 * surface feature; "how many words stand in the genitive" is a grammatical
 * count and is exactly what `integer` is for. Only the first shape is banned.
 */
const SURFACE_COUNTING_WORDS =
  /how many\s+(?:\*\*)?words(?:\*\*)?\s+(?:are\s+)?(?:there\s+)?in\b/i;

/** The reason a stem is rejected, or null if it is allowed. */
function bannedStem(stem: string): string | null {
  if (SURFACE_COUNTING.test(stem) || SURFACE_COUNTING_WORDS.test(stem)) {
    return "counts surface features (letters, vowels, syllables, commas) rather than grammar, which CLAUDE.md §2 bans outright";
  }
  return null;
}

/**
 * §1: every page carries its sources, and a page that teaches grammar cites a
 * grammar. Presence is already required by the schema; what is checked here is
 * that the citations are of the right kind for what the page claims — a lesson
 * whose only source is "composed for this course" has sourced its passages and
 * left its paradigms hanging.
 */
function validateSources(section: Section, problems: Problem[]): void {
  const err = (message: string) =>
    problems.push({ severity: "error", where: section.id, message });

  const descriptive = new Set(["grammar", "dictionary", "corpus"]);

  if (isLesson(section) && section.rules.length > 0) {
    const cites = [
      ...section.sources,
      ...section.rules.flatMap((r) => r.sources),
    ].some((s) => descriptive.has(s.kind));
    if (!cites) {
      err(
        "teaches numbered rules but cites no grammar, dictionary or corpus; " +
          "Course.attribution does not discharge the per-page obligation",
      );
    }
  }

  for (const drill of section.drills) {
    if (drill.type !== "comprehension") continue;

    // A passage the learner never has to read is not a comprehension
    // passage. At least two questions must turn on what it *says* — asked in
    // the target language, which is the convention this pack follows — rather
    // than on the grammar it happens to illustrate.
    const aboutContent = drill.questions.filter((q) =>
      CONTENT_QUESTION.test(q.stem),
    ).length;
    if (aboutContent < MIN_CONTENT_QUESTIONS) {
      err(
        `${drill.id}: only ${aboutContent} of ${drill.questions.length} questions ask about what the passage says; at least ${MIN_CONTENT_QUESTIONS} must`,
      );
    }

    // §7: a generated conversation is "dialogue between named speakers". A run
    // of bare dashes tells the learner that somebody spoke but not who, and a
    // comprehension question about who said what then has no answer on the
    // page. Any passage with spoken turns must name them.
    if (DIALOGUE_TURN.test(drill.passage) && !SPEAKER_LABEL.test(drill.passage)) {
      err(
        `${drill.id}: has dialogue turns marked only by a dash; each turn needs its speaker, as "RŪTA. …"`,
      );
    }

    for (const source of drill.sources) {
      // The schema already demands a licence on a quoted text; a URL is what
      // makes the licence checkable by a reader.
      if (source.kind === "text" && !source.url) {
        err(
          `${drill.id}: quotes a text (${source.citation}) without a URL, so its licence cannot be verified`,
        );
      }
    }
  }
}

/**
 * A spoken turn: an en- or em-dash opening a line or a sentence. Both dashes
 * occur in the content, which is why the first sweep for these missed half of
 * them.
 */
const DIALOGUE_TURN = /(?:^|\n|(?<=[.!?"\u201e\u201c\u201d])\s)[\u2014\u2013]\s/;

/**
 * A question about the passage rather than about its grammar. The pack asks
 * these in Lithuanian — *Kas išmušė vištytei akį?* — which both marks them
 * unambiguously and makes the learner read the target language to answer.
 */
const CONTENT_QUESTION =
  // `\b` in JavaScript is ASCII-only, so `Ką\b` never matches before a space:
  // ą is not a word character to it. Match the following delimiter instead.
  /^\s*(?:\*\*)?(?:Kas|Ką|Ko|Kam|Kur|Kada|Kodėl|Kiek|Kuri(?:s|ame|oje|uo)?|Koki(?:a|o|ą)|Koks|Kelint(?:a|ą|as)?|Ar|Kuo|Su\s+kuo|Iš\s+kur)(?=\s|[?,.:!]|$)/;

/** Least number of content questions a comprehension passage must carry. */
const MIN_CONTENT_QUESTIONS = 2;

/** A speaker label at the head of a line: `RŪTA.`, `KURSŲ DARBUOTOJA.` */
const SPEAKER_LABEL = /^[A-ZĄČĘĖĮŠŲŪŽ][A-ZĄČĘĖĮŠŲŪŽ\s]*\.\s/m;

/** Text compares equal when it differs only in emphasis, case or spacing. */
function normalise(text: string): string {
  return text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * What makes two questions the same question. The stem alone is not enough:
 * plenty of honest items share a stem as bland as "Which are correct?" and
 * differ entirely in what they offer. So the fingerprint is the stem together
 * with what the learner chooses between — which is the item.
 */
function fingerprint(q: AtomicQuestion): string {
  const body =
    q.type === "integer"
      ? `#${q.answer}`
      : q.type === "matching"
        ? [...q.columnI, ...q.columnII].map(normalise).join("|")
        : q.options.map(normalise).join("|");
  return `${normalise(q.stem)}||${body}`;
}

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

    if (isLesson(section)) {
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
    if (isLesson(section)) {
      for (const rule of section.rules) rulesSoFar.add(rule.id);
      for (const entry of section.vocabulary) vocabSoFar.add(entry.lemma);
    }
    rulesUpTo.set(section.id, new Set(rulesSoFar));
    vocabUpTo.set(section.id, new Set(vocabSoFar));
  }

  /* ------------------------------------------------------ per-section checks */

  const lessonIndex = new Map<string, LessonSection>();
  for (const s of sections) if (isLesson(s)) lessonIndex.set(s.id, s);

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

    /* --------------------------------------- what a question may not ask */

    for (const q of questions) {
      const banned = bannedStem(q.stem);
      if (banned) {
        err(
          section.id,
          `${q.id}: ${banned}. A question earns its place only if a learner who has not internalised the rule can plausibly get it wrong`,
        );
      }
    }

    validateSources(section, problems);

    if (isExam(section)) {
      validateExam(section, sections, lessonIndex, problems);
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
    // A boundary exam covers its whole level, but it does not stand in for the
    // checkpoints: every lesson still answers to the block exam behind it.
    if (isExam(section) || covered.has(section.id)) return;
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

/**
 * Checkpoints and boundary exams differ in what they examine and how hard they
 * are, not in what makes them sound, so the two share this. `targets` carries
 * the composition the kind is held to.
 */
function validateExam(
  section: ExamSection,
  sections: Section[],
  lessonIndex: Map<string, LessonSection>,
  problems: Problem[],
): void {
  const err = (message: string) =>
    problems.push({ severity: "error", where: section.id, message });

  const boundary = isBoundaryExam(section);
  const kind = boundary ? "a boundary exam" : "a checkpoint";
  const targets = boundary ? BOUNDARY_TARGETS : CHECKPOINT_TARGETS;

  /* ------------------------------------------------- what it claims to cover */

  for (const id of section.covers) {
    if (!lessonIndex.has(id)) {
      err(`covers "${id}", which is not a lesson section`);
    }
  }

  const at = sections.findIndex((s) => s.id === section.id);

  // Only the boundary exam may be *called* one. The title is the entry name in
  // the path list, so a checkpoint that claims it puts two identically named
  // papers side by side and the learner cannot tell which is the real one. A
  // summary may still point at the boundary exam — that is a signpost, not a
  // claim.
  if (!boundary && /boundary exam/i.test(section.title)) {
    err(
      `title "${section.title}" calls this a boundary examination, but its kind is \`checkpoint\``,
    );
  }

  if (boundary) {
    // A boundary exam examines its whole level, so `covers` is checked against
    // every lesson of that level in path order rather than against a block.
    const levelLessons = sections
      .filter((s) => s.level === section.level && isLesson(s))
      .map((s) => s.id);
    if (levelLessons.join(",") !== section.covers.join(",")) {
      err(
        `covers [${section.covers.join(", ")}] but ${section.level} teaches [${levelLessons.join(", ")}]; a boundary exam examines the whole level`,
      );
    }

    const later = sections.findIndex(
      (s, i) => i > at && s.level === section.level,
    );
    if (later >= 0) {
      err(
        `is followed by ${sections[later].id}, which is still ${section.level}; the boundary exam closes its level`,
      );
    }

    if (section.admitsTo === section.level) {
      err("admitsTo is its own level; a boundary exam admits to the next one");
    }
  } else {
    // The block a checkpoint examines is the run of lessons directly before it.
    const expected: string[] = [];
    for (let i = at - 1; i >= 0 && expected.length < section.covers.length; i--) {
      const prev = sections[i];
      if (isExam(prev)) break;
      expected.unshift(prev.id);
    }
    if (expected.join(",") !== section.covers.join(",")) {
      err(
        `covers [${section.covers.join(", ")}] but directly follows [${expected.join(", ") || "nothing"}]`,
      );
    }
  }

  /* ------------------------------------------------------------ composition */

  const questions = atomicQuestions(section.drills);

  if (
    questions.length < targets.minQuestions ||
    questions.length > targets.maxQuestions
  ) {
    err(
      `${kind} should carry ${targets.minQuestions}–${targets.maxQuestions} questions; this one has ${questions.length}`,
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
    if (n < targets.minPerCoveredSection) {
      err(
        `only ${n} question(s) examine ${id}; at least ${targets.minPerCoveredSection} are required`,
      );
    }
  }

  /* ---------------------------------------------------- core rule coverage */

  const tested = new Set(questions.flatMap((q) => q.rulesTested));
  for (const id of section.covers) {
    const lesson = lessonIndex.get(id);
    if (!lesson) continue;
    for (const rule of lesson.rules) {
      if (rule.core && !tested.has(rule.id)) {
        err(`core rule ¶${rule.number} "${rule.id}" (${id}) is not examined`);
      }
    }
  }

  /* -------------------------------------------------------- difficulty mix */

  const bands: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  for (const q of questions) bands[q.difficulty] += 1;

  for (const [band, target] of Object.entries(targets.difficultyMix)) {
    const share = (bands[band] / questions.length) * 100;
    if (Math.abs(share - target) > targets.difficultyTolerance) {
      err(
        `${band} questions are ${share.toFixed(0)}% of the paper; the target is ${target}% ±${targets.difficultyTolerance}`,
      );
    }
  }

  /**
   * §6: an exam is harder than what it examines. Comparing the hard-band share
   * against the lessons it covers is a crude measure, but it catches the real
   * failure — a checkpoint assembled from the easy end of each drill set.
   */
  const coveredQuestions = section.covers.flatMap((id) => {
    const lesson = lessonIndex.get(id);
    return lesson ? atomicQuestions(lesson.drills) : [];
  });
  if (coveredQuestions.length > 0) {
    const hardShare = (bands.hard / questions.length) * 100;
    const lessonHardShare =
      (coveredQuestions.filter((q) => q.difficulty === "hard").length /
        coveredQuestions.length) *
      100;
    if (hardShare < lessonHardShare) {
      err(
        `${hardShare.toFixed(0)}% of this paper is hard, against ${lessonHardShare.toFixed(0)}% of the drills it examines; an exam must be harder than what it follows`,
      );
    }
  }

  /**
   * §6 again: a paper that reuses drill stems examines the learner's memory of
   * the drill rather than their command of the rule.
   */
  const drilled = new Map<string, string>();
  for (const id of section.covers) {
    const lesson = lessonIndex.get(id);
    if (!lesson) continue;
    for (const q of atomicQuestions(lesson.drills)) {
      drilled.set(fingerprint(q), `${id}/${q.id}`);
    }
  }
  for (const q of questions) {
    const reused = drilled.get(fingerprint(q));
    if (reused) {
      err(`${q.id}: is ${reused} over again; an exam may not reskin its drills`);
    }
  }

  /* ------------------------------------------------------------ format mix */

  const formats = new Set<string>(
    section.drills.flatMap((d) =>
      d.type === "comprehension"
        ? [d.type, ...d.questions.map((q) => q.type)]
        : [d.type],
    ),
  );
  for (const type of ["single", "multi", "integer", "matching", "comprehension"]) {
    if (!formats.has(type)) {
      err(`no ${type} questions; ${kind} must use all five formats`);
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

  if (!boundary) return;

  /* ------------------------------------------------- boundary exams only */

  // §6: the boundary paper weights the formats that recall cannot carry.
  const matchingShare =
    (questions.filter((q) => q.type === "matching").length /
      questions.length) *
    100;
  if (matchingShare < BOUNDARY_TARGETS.minMatchingShare) {
    err(
      `matching questions are ${matchingShare.toFixed(0)}% of the paper; a boundary exam weights them at ${BOUNDARY_TARGETS.minMatchingShare}% or more`,
    );
  }

  const inPassages = passages.reduce((n, p) => n + p.questions.length, 0);
  const comprehensionShare = (inPassages / questions.length) * 100;
  if (comprehensionShare < BOUNDARY_TARGETS.minComprehensionShare) {
    err(
      `only ${comprehensionShare.toFixed(0)}% of the paper sits inside a passage; a boundary exam wants at least ${BOUNDARY_TARGETS.minComprehensionShare}%`,
    );
  }

  if (passages.length < BOUNDARY_TARGETS.minPassages) {
    err(
      `only ${passages.length} comprehension passage(s); a boundary exam needs at least ${BOUNDARY_TARGETS.minPassages}`,
    );
  }

  // That every core rule of the level is examined — §6's "assume every rule
  // from the level is live" — already falls out of the core-rule loop above,
  // because a boundary exam covers the whole level.
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
