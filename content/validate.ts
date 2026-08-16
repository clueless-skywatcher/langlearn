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
import { hasTelugu, teluguRuns, transliterateTelugu } from "@/lib/translit";
import { romanize } from "@/lib/markdown";

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
 * target-language text it renders (see `lib/markdown.tsx`). That is what keeps
 * the *grammar* completable by a learner who skipped the sections teaching the
 * script — a multiple-choice question about the dative whose four options are
 * unreadable is not a hard question, it is an unanswerable one.
 *
 * It is exactly wrong in the sections that teach the script, where decoding
 * the glyph is the whole exercise; those items set `scriptCritical` and are
 * rendered bare. See {@link scriptLeakProblems}.
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

/**
 * Prose cross-references. `seeAlso` is checked by id, but the rules also point
 * at one another by number — "the same ending a dog takes (¶42)" — and those
 * are plain text that nothing has been checking. They rot in two ways: a
 * reference can be mistyped, and a renumbering can leave every one of them
 * pointing at the wrong rule while still pointing at a rule that exists.
 *
 * The second kind cannot be caught mechanically. The first can, and must be:
 * a ¶ reference to a number no rule carries is a dead link in the middle of an
 * explanation.
 */
function paragraphReferenceProblems(sections: Section[]): Problem[] {
  const problems: Problem[] = [];
  const numbers = new Set<string>();
  for (const s of sections) {
    if (isLesson(s)) for (const r of s.rules) numbers.add(r.number);
  }
  if (numbers.size === 0) return problems;

  const check = (where: string, what: string, text?: string) => {
    if (!text) return;
    for (const m of text.matchAll(/¶(\d+[a-z]?)/g)) {
      if (!numbers.has(m[1])) {
        problems.push({
          severity: "error",
          where,
          message: `${what} refers to ¶${m[1]}, which is not a rule in this course`,
        });
      }
    }
  };

  for (const s of sections) {
    if (isLesson(s)) {
      for (const r of s.rules) {
        check(s.id, `rule "${r.id}" statement`, r.statement);
        r.footnotes.forEach((f, i) => check(s.id, `rule "${r.id}" footnote ${i}`, f));
        for (const p of r.paradigms) {
          check(s.id, `rule "${r.id}" paradigm footnote`, p.footnote);
          for (const row of p.rows) {
            row.cells.forEach((c) => check(s.id, `rule "${r.id}" paradigm cell`, c));
          }
        }
        r.examples.forEach((e) => check(s.id, `rule "${r.id}" example note`, e.note));
      }
    }
    for (const drill of s.drills) {
      const kids = drill.type === "comprehension" ? drill.questions : [drill];
      for (const q of kids) {
        check(s.id, `${q.id} stem`, q.stem);
        check(s.id, `${q.id} explanation`, q.explanation);
      }
    }
  }
  return problems;
}

/** An integer item that opens "how many" — the counting shape of the format. */
const COUNTING_INTEGER = /how many|how much/i;

/**
 * §11: `integer` accepts any non-negative number, and a pack that only ever
 * asks *how many* has used one shape and mistaken it for the format. Reading a
 * numeral, naming the rule that governs a form, or lifting a quantity out of a
 * passage all fit it, and all make the learner produce an answer rather than
 * recognise one.
 *
 * This is a whole-pack warning and deliberately blunt. Whether a *particular*
 * count was the right question is a judgement no check can make — an alphabet
 * has an inventory and counting it is fair. What a check can see is a pack
 * where the shape never varies.
 */
function integerVarietyProblems(pack: CoursePack): Problem[] {
  const integers = pack.sections
    .flatMap((s) => atomicQuestions(s.drills))
    .filter((q) => q.type === "integer");
  if (integers.length < 8) return [];

  const counts = integers.filter((q) => COUNTING_INTEGER.test(q.stem)).length;
  const share = (counts / integers.length) * 100;
  if (share < 90) return [];

  return [
    {
      severity: "warning",
      where: pack.course.id,
      message:
        `${counts} of ${integers.length} integer questions (${share.toFixed(0)}%) ask "how many"; ` +
        `the format also takes reading a numeral, naming the rule that governs a form, ` +
        `or a quantity stated in a passage — see CLAUDE.md §11`,
    },
  ];
}

/* ------------------------------------------------- reading the script at all */

/**
 * The Latin in a string, lowercased, as one space-delimited run. Target script
 * is dropped rather than transliterated, because the point is to see what a
 * learner who cannot read that script has in front of them.
 *
 * Diacritics are kept. ISO 15919 distinguishes *i* from *ī* and *ta* from *ṭa*,
 * and folding them together would report every short vowel as a leak of its
 * long partner. European digits are kept for the same reason: a question about
 * the Telugu digits whose options are `3 4 5 6` is given away by a `(5)` in
 * the stem exactly as a letter question is given away by a `(ka)`.
 */
function latinRun(text: string): string {
  const withoutTarget = text.replace(/[ఀ-౿]/g, " ");
  return ` ${withoutTarget
    .normalize("NFC")
    .replace(/[^\p{Script=Latin}\p{Nd}\p{Mn}]+/gu, " ")
    .trim()
    .toLowerCase()} `;
}

/**
 * The Latin a learner can actually see on an option, or null where there is
 * none to see. A target-script option under `scriptCritical` renders as bare
 * glyphs, so there is nothing in it to match against the stem — which is the
 * whole point of the flag, and the reason *"which letter is **ā**?"* over four
 * unromanized glyphs is a fair question rather than a leak.
 */
function optionLatin(option: string, scriptCritical: boolean): string | null {
  if (!hasTelugu(option)) return latinRun(option).trim() || null;
  if (scriptCritical) return null;
  return latinRun(transliterateTelugu(option)).trim() || null;
}

/** Target-script text with markdown and spacing normalised away. */
function targetRun(text: string): string {
  return ` ${text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim()} `;
}

/**
 * §2: "anything answerable by looking at the stem without knowing the
 * language" is banned, and in an abugida course the commonest way to write
 * such a question is by accident.
 *
 * Two things give a script question away. The renderer romanizes target text
 * by default, so *which letter is ఖ?* reaches the learner as *which letter is
 * ఖ (kha)?* against an option reading `kha` — a string-matching exercise.
 * `scriptCritical` turns that off. And an author can write the reading into
 * the stem by hand, which no flag undoes.
 *
 * So this checks the text as the learner will actually see it, and reports a
 * leak when the correct option — and only the correct option — can be picked
 * out of it without reading a glyph. Two ways that happens: the option's
 * reading is legible and the stem repeats it, or the stem prints the answer's
 * glyph and the learner need only match two shapes.
 */
function questionLeak(q: AtomicQuestion): string | null {
  if (q.type === "integer") {
    // §11: the stem may not state its own answer in figures. That happens two
    // ways — target-script digits that transliterate straight to European ones
    // ("what number is ౧౦౧ (101)?"), and a figure written in by hand.
    //
    // Grammatical notation is not a number the question is about: "1 sg.",
    // "3rd person" and the level tag "A1" all carry figures that mean nothing
    // arithmetically, and stripping them is what keeps this off the Lithuanian
    // pack, where such notation is everywhere.
    const shown = (q.scriptCritical ? q.stem : romanize(q.stem))
      .replace(/[ఀ-౿]/g, " ")
      .replace(/¶\s*\d+[a-z]?/g, " ")
      .replace(/\d+\s*(?:sg|pl|st|nd|rd|th)\b/gi, " ")
      .replace(/[A-Za-z]\d+/g, " ");
    const digits = new RegExp(`(?<![0-9])${q.answer}(?![0-9])`);
    return digits.test(shown)
      ? `the stem states its own answer (${q.answer}) in figures`
      : null;
  }

  const options = q.type === "matching" ? q.columnI : q.options;
  if (!options.some(hasTelugu) && !hasTelugu(q.stem)) return null;

  const shownStem = q.scriptCritical ? q.stem : romanize(q.stem);
  const latin = latinRun(shownStem);
  const glyphs = targetRun(shownStem);
  const correct = new Set(
    q.type === "multi" ? q.correct : [q.correct],
  );

  // A matching question is picked by its pairing rather than by an entry, so
  // there is no single "correct option" to find in the stem.
  if (q.type === "matching") return null;

  const givenAway = (option: string): boolean => {
    const key = optionLatin(option, q.scriptCritical);
    if (key && latin.includes(` ${key} `)) return true;
    return hasTelugu(option) && glyphs.includes(targetRun(option).trim());
  };

  const leaked = options.map(givenAway);
  const everyCorrect = [...correct].every((i) => leaked[i]);
  const noDistractor = leaked.every((v, i) => !v || correct.has(i));
  const hasDistractor = options.length > correct.size;

  return everyCorrect && noDistractor && hasDistractor
    ? "the stem already contains the correct option and none of the distractors, " +
        "so it can be answered without reading the script"
    : null;
}

/**
 * The blunt half of the rule, and the one the learner notices: in a section
 * that teaches the writing system, target text in a question is there to be
 * read. Romanizing it hands over the answer to *which of these is the nasal of
 * the palatal varga* as surely as printing the answer would, because the four
 * readings say which is which.
 *
 * Applies to the lesson itself and to any exam item attributed back to it.
 */
function scriptLeakProblems(
  sections: Section[],
  lessonIndex: Map<string, LessonSection>,
): Problem[] {
  const problems: Problem[] = [];

  for (const section of sections) {
    for (const drill of section.drills) {
      const children: AtomicQuestion[] =
        drill.type === "comprehension" ? drill.questions : [drill];

      for (const q of children) {
        const from = isExam(section)
          ? sourceSection(drill, q, "")
          : section.id;
        const teachesScript = !!lessonIndex.get(from)?.script;

        const strings =
          q.type === "integer"
            ? [q.stem]
            : q.type === "matching"
              ? [q.stem, ...q.columnI, ...q.columnII]
              : [q.stem, ...q.options];

        if (teachesScript && strings.some(hasTelugu) && !q.scriptCritical) {
          problems.push({
            severity: "error",
            where: section.id,
            message:
              `${q.id}: examines ${from}, which teaches the script, but is not ` +
              `marked scriptCritical, so the renderer prints a romanization ` +
              `beside every glyph and the learner never has to read one`,
          });
        }

        if (q.scriptCritical && !strings.some(hasTelugu)) {
          problems.push({
            severity: "error",
            where: section.id,
            message: `${q.id}: is marked scriptCritical but contains no target script`,
          });
        }

        const leak = questionLeak(q);
        if (leak) {
          problems.push({
            severity: "error",
            where: section.id,
            message: `${q.id}: ${leak}`,
          });
        }
      }

      if (drill.type === "comprehension") {
        const from = isExam(section)
          ? (drill.fromSection ?? section.id)
          : section.id;
        if (
          !!lessonIndex.get(from)?.script &&
          hasTelugu(drill.passage) &&
          !drill.scriptCritical
        ) {
          problems.push({
            severity: "error",
            where: section.id,
            message:
              `${drill.id}: a passage in a script section is printed with a ` +
              `parallel romanization, which is the text the learner will read instead`,
          });
        }
      }
    }
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
  // The trailing alternation includes end-of-question, because the shape that
  // slipped through first time round was "**పుస్తకం** — how many syllables?",
  // which names the word before the count instead of after it.
  /how many\s+(?:\*\*)?(?:letters?|vowels?|consonants?|commas?|syllables?|characters?)(?:\*\*)?\s*(?:[?.]|\b(?:are|there|in|of|does|do|has|have)\b)/i;

/**
 * Words are a special case. "How many words are in this sentence" counts a
 * surface feature; "how many words stand in the genitive" is a grammatical
 * count and is exactly what `integer` is for. Only the first shape is banned.
 */
const SURFACE_COUNTING_WORDS =
  /how many\s+(?:\*\*)?words(?:\*\*)?\s+(?:are\s+)?(?:there\s+)?in\b/i;

/**
 * What is being counted decides whether the count is grammar. "How many
 * letters are in *norėčiau*" is a question about a string; "how many letters
 * does the alphabet contain" is a question about the writing system, and is
 * the sort of thing §2 keeps `integer` for — alongside "how many case forms
 * this paradigm collapses". So a count whose subject is an inventory rather
 * than a printed word is allowed.
 *
 * Syllables are not on this list, and cannot be: §2 bans "how many syllables
 * a printed word has" by name, and no alphabet has a syllable count worth
 * asking for.
 */
const GRAMMATICAL_INVENTORY =
  /\b(?:varṇamāla|varnamala|alphabet|vargas?|guṇintam|gunintam|paradigm|declensions?|conjugations?|chart|inventory)\b/i;

const SYLLABLE_COUNTING = /how many\s+(?:\*\*)?syllables?\b/i;

/** The reason a stem is rejected, or null if it is allowed. */
function bannedStem(stem: string): string | null {
  if (SYLLABLE_COUNTING.test(stem)) {
    return "counts the syllables of a printed word, which CLAUDE.md §2 bans by name";
  }
  if (SURFACE_COUNTING.test(stem) || SURFACE_COUNTING_WORDS.test(stem)) {
    if (GRAMMATICAL_INVENTORY.test(stem)) return null;
    return "counts surface features (letters, vowels, commas) of a string rather than grammar, which CLAUDE.md §2 bans outright";
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
function validateSources(
  section: Section,
  langCode: string,
  problems: Problem[],
): void {
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
    // the target language, which is the convention the packs follow — rather
    // than on the grammar it happens to illustrate.
    //
    // A script-critical passage is exempt. There the passage is a page to be
    // decoded rather than a story to be understood, the learner has met no
    // grammar yet to be asked a question in, and every question about it
    // already requires reading it.
    const asksInTarget = CONTENT_QUESTION[langCode];
    if (asksInTarget && !drill.scriptCritical) {
      const aboutContent = drill.questions.filter((q) =>
        asksInTarget(q.stem),
      ).length;
      if (aboutContent < MIN_CONTENT_QUESTIONS) {
        err(
          `${drill.id}: only ${aboutContent} of ${drill.questions.length} questions ask about what the passage says; at least ${MIN_CONTENT_QUESTIONS} must`,
        );
      }
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
 * A question about the passage rather than about its grammar. A pack asks
 * these in the target language, which both marks them unambiguously and makes
 * the learner read that language in order to answer.
 *
 * Which interrogatives count is a fact about the language, so this is keyed by
 * course. Word order decides the shape of the test as much as the vocabulary
 * does: Lithuanian and Esperanto front their question words, so those are
 * anchored, while Telugu is verb-final and puts *ఏమిటి* last — *అతని పేరు
 * ఏమిటి?* — so there the interrogative is looked for anywhere in a stem that
 * is written in the script and ends in a question mark.
 */
const CONTENT_QUESTION: Record<string, (stem: string) => boolean> = {
  // `\b` in JavaScript is ASCII-only, so `Ką\b` never matches before a space:
  // ą is not a word character to it. Match the following delimiter instead.
  lt: (s) =>
    /^\s*(?:\*\*)?(?:Kas|Ką|Ko|Kam|Kur|Kada|Kodėl|Kiek|Kuri(?:s|ame|oje|uo)?|Koki(?:a|o|ą)|Koks|Kelint(?:a|ą|as)?|Ar|Kuo|Su\s+kuo|Iš\s+kur)(?=\s|[?,.:!]|$)/.test(
      s,
    ),
  eo: (s) =>
    /^\s*(?:\*\*)?(?:Kiu|Kio|Kie|Kiam|Kial|Kiel|Kiom|Kies|Kia|Ĉu)(?=[nj]?\s|[?,.:!])/.test(
      s,
    ),
  te: (s) =>
    /\?\s*(?:\*\*)?\s*$/.test(s) &&
    /(?:ఎవరు|ఎవరి|ఏమిటి|ఏది|ఏవి|ఎక్కడ|ఎప్పుడు|ఎందుకు|ఎలా|ఎన్ని|ఎంత|ఎవరిది)/.test(s),
  // German is verb-second and fronts its interrogative, so the question word
  // opens the stem as it does in Lithuanian and Esperanto. All of them begin
  // with w-, which keeps this clear of the sentence-initial capital (¶7).
  de: (s) =>
    /^\s*(?:\*\*)?(?:Wer|Wen|Wem|Wessen|Was|Wo|Wohin|Woher|Wann|Warum|Wieso|Weshalb|Wie|Welch(?:e|er|es|en|em)?)(?=\s|[?,.:!]|$)/.test(
      s,
    ),
};

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

    validateSources(section, course.langCode, problems);

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
  problems.push(...scriptLeakProblems(sections, lessonIndex));
  problems.push(...paragraphReferenceProblems(sections));
  problems.push(...integerVarietyProblems(pack));

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
