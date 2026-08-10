import { z } from "zod";

/**
 * Content schemas for a language course pack.
 *
 * Courses are data, not code: a pack is a `course.json` plus one JSON file per
 * section. Nothing here is Lithuanian-specific — the parts that vary between
 * languages (script, dictionary citation forms) are expressed as open maps
 * whose labels the course file supplies.
 *
 * The rule/vocabulary shape follows Kellerman's *A Complete Grammar of
 * Esperanto*: continuously numbered paragraphs under prose headings, each
 * stating the reason for a usage and followed by `target, gloss` examples,
 * with footnotes and cross-references to earlier rule numbers.
 */

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const CefrLevel = z.enum(CEFR_LEVELS);

export const Difficulty = z.enum(["easy", "medium", "hard"]);

const Id = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase kebab-case");

/* ----------------------------------------------------------------- sources */

/**
 * A citation. Every page a learner can land on carries these in its footer,
 * and so does every reading passage: a course that cannot say where a claim
 * comes from has no business making it.
 *
 * `kind` is what the citation points at, which decides what the rest must
 * carry. A `text` — anything quoted rather than written for the course — must
 * name its licence, because excerpting is only permissible from open sources.
 * A `composed` source is the honest label for material generated for this
 * course; it says so plainly rather than leaving provenance to be guessed at.
 */
export const Source = z.strictObject({
  kind: z.enum(["grammar", "dictionary", "corpus", "text", "composed"]),
  /**
   * The citation as it should read in the footer, e.g.
   * "Ambrazas (ed.), *Lithuanian Grammar*, 2nd ed., Baltos lankos, 1997".
   * A bare language name is not a citation and neither is "I know Lithuanian".
   */
  citation: z.string().min(1),
  url: z.url().optional(),
  /** Licence or public-domain status. Required on `text`; see the refinement. */
  licence: z.string().optional(),
  /** What this source is cited *for*, when the citation alone leaves it open. */
  note: z.string().optional(),
}).refine(
  (s) => s.kind !== "text" || !!s.licence,
  "a quoted text must state its licence or public-domain status",
);

/* ------------------------------------------------------------------ script */

/** One letter of the course's writing system. Present only on script sections. */
export const Letter = z.strictObject({
  glyph: z.string().min(1),
  /** Uppercase form, where the script is bicameral. */
  upper: z.string().min(1).optional(),
  /** What the letter is called in the target language, e.g. "ā" → "a ilgoji". */
  name: z.string().optional(),
  /** IPA value(s), slash-delimited for letters with more than one reading. */
  ipa: z.string().optional(),
  /** Nearest English approximation, for the learner's first pass. */
  approx: z.string().optional(),
  notes: z.string().optional(),
});

export const ScriptSection = z.strictObject({
  /** e.g. "The Lithuanian alphabet" — heading for the letter table. */
  heading: z.string().min(1),
  letters: z.array(Letter).min(1),
  /** Prose that belongs with the table rather than with a numbered rule. */
  notes: z.array(z.string()).default([]),
});

/* ------------------------------------------------------------------- rules */

/** A `target, gloss` line of the kind that follows every rule in Kellerman. */
export const Example = z.strictObject({
  target: z.string().min(1),
  /**
   * The target text in Latin letters. Required by courses whose script a
   * learner may not have learned — see `Course.transliteration`.
   */
  roman: z.string().optional(),
  gloss: z.string().min(1),
  /** Parenthetical aside, e.g. why this form and not the obvious one. */
  note: z.string().optional(),
});

/**
 * A declension or conjugation table. Lithuanian needs these constantly
 * (seven cases × five declensions), and the book uses them for paradigms too.
 */
export const Paradigm = z.strictObject({
  caption: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
  /** Each row is a label followed by one cell per column. */
  rows: z
    .array(
      z.strictObject({
        label: z.string().min(1),
        cells: z.array(z.string()).min(1),
      }),
    )
    .min(1),
  footnote: z.string().optional(),
});

export const Rule = z.strictObject({
  id: Id,
  /**
   * Display number, continuous across the whole course like the book's ¶1–¶282.
   * A string so that "17a" is expressible.
   */
  number: z.string().min(1),
  heading: z.string().min(1),
  /** The rule itself, in markdown. States *why*, not merely *that*. */
  statement: z.string().min(1),
  examples: z.array(Example).default([]),
  paradigms: z.array(Paradigm).default([]),
  footnotes: z.array(z.string()).default([]),
  /** Rule ids this one builds on — the book's "(see 5.)" cross-references. */
  seeAlso: z.array(Id).default([]),
  /**
   * Where this particular rule comes from. The section's own `sources` cover
   * the page; a rule states its own when it rests on something narrower than
   * the general grammar — a specialist paper, a dictionary entry, a corpus
   * count. Never invent one: if the claim cannot be sourced, cut the claim.
   */
  sources: z.array(Source).default([]),
  /**
   * Core rules must be tested by the section's own drills and again by the
   * checkpoint covering the section. The validator enforces both.
   */
  core: z.boolean().default(true),
});

/* -------------------------------------------------------------- vocabulary */

export const VocabEntry = z.strictObject({
  lemma: z.string().min(1),
  gloss: z.string().min(1),
  pos: z.string().min(1),
  /**
   * Citation forms keyed by an arbitrary label, e.g. Lithuanian verbs are
   * cited as infinitive / 3rd-person present / 3rd-person past
   * (`dirbti, dirba, dirbo`) and nouns as nominative / genitive / stress class.
   * `course.formLabels[pos]` names and orders the keys for display.
   */
  forms: z.record(z.string(), z.string()).default({}),
  notes: z.string().optional(),
});

/* ------------------------------------------------------------------ drills */

const QuestionBase = {
  id: Id,
  difficulty: Difficulty,
  /** The question itself, markdown. */
  stem: z.string().min(1),
  /** Shown after answering, whatever the outcome. */
  explanation: z.string().min(1),
  rulesTested: z.array(Id).default([]),
  vocabUsed: z.array(z.string()).default([]),
  /**
   * Which lesson section this item examines. Required on checkpoint items so
   * the per-section breakdown is a group-by rather than a reverse lookup
   * through `rulesTested`; ignored on lesson items.
   */
  fromSection: Id.optional(),
};

/** One option correct, four options. Scored +4 / −1. */
export const SingleQuestion = z.strictObject({
  ...QuestionBase,
  type: z.literal("single"),
  options: z.array(z.string().min(1)).length(4),
  /** Index into `options`. */
  correct: z.number().int().min(0).max(3),
});

/** One or more options correct, four options. JEE partial credit applies. */
export const MultiQuestion = z.strictObject({
  ...QuestionBase,
  type: z.literal("multi"),
  options: z.array(z.string().min(1)).length(4),
  /** Indices into `options`; at least one, and unique. */
  correct: z
    .array(z.number().int().min(0).max(3))
    .min(1)
    .max(4)
    .refine((v) => new Set(v).size === v.length, "correct indices must be unique"),
});

/** Non-negative integer answer. Scored +4 / 0 — no negative marking. */
export const IntegerQuestion = z.strictObject({
  ...QuestionBase,
  type: z.literal("integer"),
  answer: z.number().int().min(0),
  /** Optional unit or counting convention, e.g. "letters", "syllables". */
  unit: z.string().optional(),
});

/**
 * Two columns to pair. Column I holds four items — forms, endings, cases,
 * tenses — and Column II the labels they are matched against. The four options
 * are four *complete* pairings, exactly one of them right, so a learner who
 * has three of the four pairs still has to know the fourth: partial knowledge
 * earns nothing. Scored +4 / −1, like any other single-correct question.
 *
 * The three wrong pairings are built from real confusions — a shared ending
 * across two declensions, a case that follows the same preposition — and never
 * by shuffling at random, which produces distractors a learner can dismiss
 * without knowing anything.
 */
export const MatchingQuestion = z.strictObject({
  ...QuestionBase,
  type: z.literal("matching"),
  /** Headings for the two columns, e.g. ["Form", "Case"]. */
  columnHeadings: z.tuple([z.string().min(1), z.string().min(1)]),
  /** Column I: the four items to be paired, rendered P, Q, R, S. */
  columnI: z.array(z.string().min(1)).length(4),
  /** Column II: the labels, rendered 1, 2, 3, … A decoy label is allowed. */
  columnII: z.array(z.string().min(1)).min(4).max(6),
  /**
   * Four candidate pairings. Each is a complete assignment giving one
   * `columnII` index per Column I item, in Column I order. Two Column I items
   * may legitimately take the same label, so the assignment need not be
   * injective.
   */
  options: z
    .array(z.array(z.number().int().min(0)).length(4))
    .length(4),
  /** Index into `options`. */
  correct: z.number().int().min(0).max(3),
})
  .refine(
    (q) => q.options.every((o) => o.every((i) => i < q.columnII.length)),
    "a pairing refers to a Column II entry that does not exist",
  )
  .refine(
    (q) => new Set(q.options.map((o) => o.join(","))).size === q.options.length,
    "the four pairings must be distinct, or more than one option is correct",
  );

export const AtomicQuestion = z.discriminatedUnion("type", [
  SingleQuestion,
  MultiQuestion,
  IntegerQuestion,
  MatchingQuestion,
]);

/**
 * A reading passage with 2–5 dependent questions, as in JEE Advanced paragraph
 * and comprehension blocks. The passage's own score is the sum of its children.
 */
export const ComprehensionDrill = z.strictObject({
  id: Id,
  type: z.literal("comprehension"),
  difficulty: Difficulty,
  /** Title shown above the passage. */
  title: z.string().min(1),
  /** The passage, in the target language. */
  passage: z.string().min(1),
  /** The whole passage in Latin letters, for a learner who has skipped the script. */
  romanization: z.string().optional(),
  /** Full translation, revealed only after the block is answered. */
  translation: z.string().optional(),
  /** Glosses for words the learner has not met yet, keyed by surface form. */
  glossary: z.record(z.string(), z.string()).default({}),
  /**
   * 2–8. A passage has to earn its length: it needs questions about what it
   * *says* as well as about the grammar it illustrates, and five slots do not
   * hold both. CLAUDE.md §3 quotes 2–5, written before the content/grammar
   * split was enforced.
   */
  questions: z.array(AtomicQuestion).min(2).max(8),
  fromSection: Id.optional(),
  /**
   * The passage's own provenance, shown in its footer. A real excerpt names
   * author, title, publication, date, URL and licence; a passage written for
   * the course says so, and still cites whatever grammar or idiom it leans on.
   */
  sources: z.array(Source).min(1),
});

export const Drill = z.discriminatedUnion("type", [
  SingleQuestion,
  MultiQuestion,
  IntegerQuestion,
  MatchingQuestion,
  ComprehensionDrill,
]);

/* ---------------------------------------------------------------- sections */

const SectionBase = {
  id: Id,
  level: CefrLevel,
  /** Position within the level. Unique per level; checkpoints share the sequence. */
  order: z.number().int().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  drills: z.array(Drill).min(1),
  /**
   * The page's footer citations. A section is a page a learner lands on, so
   * this is not optional: `Course.attribution` covers the manner of exposition
   * for the course as a whole and does not discharge the per-page obligation.
   */
  sources: z.array(Source).min(1),
};

export const LessonSection = z.strictObject({
  ...SectionBase,
  kind: z.literal("lesson"),
  script: ScriptSection.optional(),
  rules: z.array(Rule).default([]),
  vocabulary: z.array(VocabEntry).default([]),
});

/**
 * A cumulative exam over the 3–4 lesson sections that precede it. It teaches
 * nothing of its own; composition targets (question count, per-section
 * coverage, difficulty and format mix) are enforced by the validator.
 */
export const CheckpointSection = z.strictObject({
  ...SectionBase,
  kind: z.literal("checkpoint"),
  covers: z.array(Id).min(3).max(4),
  /** Percentage of the maximum score counted as a pass. */
  passThreshold: z.number().min(0).max(100).default(60),
});

/**
 * The examination at a level transition — A1→A2, A2→B1, and so on. Where a
 * checkpoint examines the three or four lessons behind it, a boundary exam
 * examines the whole level and assumes every rule in it is live. It is harder
 * than the checkpoints by construction: the cumulative and matching formats
 * carry most of the weight, so that a learner who passed the checkpoints by
 * memorising their items has nothing to fall back on here.
 *
 * `covers` is written out rather than derived so that the paper says what it
 * examines; the validator checks it against the level's lessons in path order,
 * which is what stops it drifting as sections are added.
 */
export const BoundaryExamSection = z.strictObject({
  ...SectionBase,
  kind: z.literal("boundary"),
  covers: z.array(Id).min(4),
  /** The level the learner is admitted to by passing. */
  admitsTo: CefrLevel,
  /** Percentage of the maximum score counted as a pass. */
  passThreshold: z.number().min(0).max(100).default(70),
});

export const Section = z.discriminatedUnion("kind", [
  LessonSection,
  CheckpointSection,
  BoundaryExamSection,
]);

/* ------------------------------------------------------------------ course */

export const Course = z.strictObject({
  id: Id,
  /** BCP 47 / ISO 639 code, e.g. "lt". */
  langCode: z.string().min(2),
  /** Endonym, e.g. "Lietuvių kalba". */
  name: z.string().min(1),
  /** Name in the interface language. */
  englishName: z.string().min(1),
  description: z.string().min(1),
  direction: z.enum(["ltr", "rtl"]).default("ltr"),
  /**
   * Where this course's grammar comes from, shown in the footer. Some courses
   * follow a source text closely; others only borrow its manner of exposition.
   */
  attribution: z.string().optional(),
  /**
   * Declared by a course written in a script the learner may not read. When
   * `required`, the validator refuses any target-language string that carries
   * no Latin alongside it, so that the course stays completable by someone who
   * skipped the sections teaching the script.
   */
  transliteration: z
    .strictObject({
      scheme: z.string().min(1),
      required: z.boolean().default(true),
    })
    .optional(),
  /**
   * Ordered, human-readable labels for the keys of `VocabEntry.forms`, per
   * part of speech. Keys absent here are still rendered, after the listed ones.
   */
  formLabels: z
    .record(
      z.string(),
      z.array(
        z.strictObject({
          key: z.string().min(1),
          label: z.string().min(1),
        }),
      ),
    )
    .default({}),
  levels: z.array(CefrLevel).min(1),
});

/* ------------------------------------------------------------------- types */

export type CefrLevel = z.infer<typeof CefrLevel>;
export type Difficulty = z.infer<typeof Difficulty>;
export type Source = z.infer<typeof Source>;
export type Letter = z.infer<typeof Letter>;
export type ScriptSection = z.infer<typeof ScriptSection>;
export type Example = z.infer<typeof Example>;
export type Paradigm = z.infer<typeof Paradigm>;
export type Rule = z.infer<typeof Rule>;
export type VocabEntry = z.infer<typeof VocabEntry>;
export type SingleQuestion = z.infer<typeof SingleQuestion>;
export type MultiQuestion = z.infer<typeof MultiQuestion>;
export type IntegerQuestion = z.infer<typeof IntegerQuestion>;
export type MatchingQuestion = z.infer<typeof MatchingQuestion>;
export type AtomicQuestion = z.infer<typeof AtomicQuestion>;
export type ComprehensionDrill = z.infer<typeof ComprehensionDrill>;
export type Drill = z.infer<typeof Drill>;
export type LessonSection = z.infer<typeof LessonSection>;
export type CheckpointSection = z.infer<typeof CheckpointSection>;
export type BoundaryExamSection = z.infer<typeof BoundaryExamSection>;
/** Any section that examines rather than teaches: a checkpoint or a boundary exam. */
export type ExamSection = CheckpointSection | BoundaryExamSection;
export type Section = z.infer<typeof Section>;
export type Course = z.infer<typeof Course>;

/* --------------------------------------------------------------- utilities */

/** Every atomic question in a drill list, flattening comprehension blocks. */
export function atomicQuestions(drills: Drill[]): AtomicQuestion[] {
  return drills.flatMap((d) =>
    d.type === "comprehension" ? d.questions : [d],
  );
}

/** The section a drill (or a comprehension child) examines. */
export function sourceSection(
  drill: Drill,
  question: AtomicQuestion,
  fallback: string,
): string {
  return question.fromSection ?? drill.fromSection ?? fallback;
}

export function isCheckpoint(section: Section): section is CheckpointSection {
  return section.kind === "checkpoint";
}

export function isBoundaryExam(
  section: Section,
): section is BoundaryExamSection {
  return section.kind === "boundary";
}

/**
 * True for any section that examines rather than teaches. Both kinds declare
 * `covers` and a `passThreshold`, so everything downstream — marking, the
 * per-section breakdown, the "answers at the end" mode of the runner — wants
 * this predicate rather than `isCheckpoint`.
 */
export function isExam(section: Section): section is ExamSection {
  return section.kind === "checkpoint" || section.kind === "boundary";
}

/** True for a section that teaches: the complement of {@link isExam}. */
export function isLesson(section: Section): section is LessonSection {
  return section.kind === "lesson";
}
