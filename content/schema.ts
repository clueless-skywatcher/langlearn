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

export const AtomicQuestion = z.discriminatedUnion("type", [
  SingleQuestion,
  MultiQuestion,
  IntegerQuestion,
]);

/**
 * A reading passage with 2–3 dependent questions, as in JEE's comprehension
 * blocks. The passage's own score is the sum of its children.
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
  questions: z.array(AtomicQuestion).min(2).max(3),
  fromSection: Id.optional(),
});

export const Drill = z.discriminatedUnion("type", [
  SingleQuestion,
  MultiQuestion,
  IntegerQuestion,
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

export const Section = z.discriminatedUnion("kind", [
  LessonSection,
  CheckpointSection,
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
export type Letter = z.infer<typeof Letter>;
export type ScriptSection = z.infer<typeof ScriptSection>;
export type Example = z.infer<typeof Example>;
export type Paradigm = z.infer<typeof Paradigm>;
export type Rule = z.infer<typeof Rule>;
export type VocabEntry = z.infer<typeof VocabEntry>;
export type SingleQuestion = z.infer<typeof SingleQuestion>;
export type MultiQuestion = z.infer<typeof MultiQuestion>;
export type IntegerQuestion = z.infer<typeof IntegerQuestion>;
export type AtomicQuestion = z.infer<typeof AtomicQuestion>;
export type ComprehensionDrill = z.infer<typeof ComprehensionDrill>;
export type Drill = z.infer<typeof Drill>;
export type LessonSection = z.infer<typeof LessonSection>;
export type CheckpointSection = z.infer<typeof CheckpointSection>;
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
