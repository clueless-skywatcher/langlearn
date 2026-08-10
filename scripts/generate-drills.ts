#!/usr/bin/env -S npx tsx
import { z } from "zod";

import { getCourse, getSection, listCourseIds } from "../content/loader";
import {
  Drill,
  isCheckpoint,
  isLesson,
  type Course,
  type Drill as DrillType,
  type LessonSection,
  type Section,
} from "../content/schema";
import { CHECKPOINT_TARGETS, LESSON_TARGETS, lessonMaxQuestions } from "../content/validate";

/**
 * Offline drill generation — **not wired to a provider yet**.
 *
 * What exists here is everything that does not depend on which model is used:
 * the request shape, the prompt built from a section's own rules and
 * vocabulary, and the parse-and-validate step that a generated batch must
 * survive. Wiring a provider means writing one `DrillGenerator` and passing it
 * to `generate()`.
 *
 * Generated drills are meant to be reviewed and committed as JSON, not fetched
 * at runtime: content in this project is reviewable, diffable and testable.
 */

export interface GenerationSpec {
  /** How many drills of each format to produce. */
  counts: { single: number; multi: number; integer: number; comprehension: number };
  /** Share of each difficulty band, in percent. */
  difficultyMix: { easy: number; medium: number; hard: number };
  /** For a checkpoint, the lesson sections the paper must examine. */
  covers?: string[];
}

export interface DrillGenerator {
  readonly name: string;
  /** Return raw drill objects; `generate()` validates them against the schema. */
  generate(prompt: string, spec: GenerationSpec): Promise<unknown[]>;
}

/* ------------------------------------------------------------------ prompts */

/** "a Lithuanian course", but "an Esperanto course". */
function article(name: string): string {
  return /^[AEIOU]/i.test(name) ? "an" : "a";
}

function renderRules(section: LessonSection): string {
  return section.rules
    .map((rule) => {
      const examples = rule.examples
        .map((e) => `    ${e.target} — ${e.gloss}${e.note ? ` (${e.note})` : ""}`)
        .join("\n");
      const paradigms = rule.paradigms
        .map(
          (p) =>
            `    [${p.caption}] ` +
            p.rows.map((r) => `${r.label}: ${r.cells.join(" / ")}`).join("; "),
        )
        .join("\n");
      return [
        `¶${rule.number} (id: ${rule.id}${rule.core ? ", CORE" : ""}) ${rule.heading}`,
        `  ${rule.statement}`,
        examples,
        paradigms,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function renderVocabulary(section: LessonSection): string {
  return section.vocabulary
    .map((v) => {
      const forms = Object.values(v.forms).join(", ");
      return `  ${v.lemma} = ${v.gloss} (${v.pos}${forms ? `; ${forms}` : ""})`;
    })
    .join("\n");
}

/**
 * The prompt a generator receives. It carries only what has been taught up to
 * and including the target section, so a generated item can never test
 * material the learner has not met.
 */
export function buildPrompt(
  target: Section,
  taughtSoFar: LessonSection[],
  course: Course,
  spec: GenerationSpec,
): string {
  const checkpoint = isCheckpoint(target);
  const scope = checkpoint
    ? taughtSoFar.filter((s) => target.covers.includes(s.id))
    : taughtSoFar.slice(-1);

  const earlier = taughtSoFar.filter((s) => !scope.includes(s));

  const rubric = checkpoint
    ? [
        `This is a CHECKPOINT: a cumulative examination of ${target.covers.join(", ")}.`,
        `Produce ${CHECKPOINT_TARGETS.minQuestions}–${CHECKPOINT_TARGETS.maxQuestions} questions in total.`,
        `Every covered section needs at least ${CHECKPOINT_TARGETS.minPerCoveredSection} questions, and every CORE rule of every covered section must be examined by at least one.`,
        `Set "fromSection" on every drill to the id of the section it examines.`,
      ]
    : [
        `This is a LESSON drill set for ${target.id}.`,
        `Produce ${LESSON_TARGETS.minQuestions}–${lessonMaxQuestions(isLesson(target) && !!target.script)} questions in total.`,
        `Every CORE rule of this section must be tested by at least one question.`,
        `Do not set "fromSection".`,
      ];

  return `You are writing examination questions for ${article(course.englishName)} ${course.englishName} course.

FORMATS (JEE Advanced):
  single         four options, exactly one correct. Marked +4 / −1.
  multi          four options, one or more correct. Partial credit; −2 if any wrong option is chosen.
  integer        a non-negative integer answer, no options. Marked +4 / 0.
  matching       two columns to pair. Column I holds four items, Column II the labels;
                 the four options are four COMPLETE pairings, exactly one right, so
                 three correct pairs out of four score nothing. Marked +4 / −1.
  comprehension  a short passage in ${course.englishName} with 2–5 dependent questions of the above types.

REQUESTED MIX:
  single ${spec.counts.single}, multi ${spec.counts.multi}, integer ${spec.counts.integer}, comprehension ${spec.counts.comprehension}
  difficulty roughly ${spec.difficultyMix.easy}% easy / ${spec.difficultyMix.medium}% medium / ${spec.difficultyMix.hard}% hard

${rubric.join("\n")}

RULES BEING EXAMINED
${scope.map(renderRules).join("\n\n")}

VOCABULARY AVAILABLE (this scope)
${scope.map(renderVocabulary).join("\n")}

VOCABULARY ALREADY KNOWN (earlier sections; you may use it freely)
${earlier.map((s) => s.vocabulary.map((v) => v.lemma).join(", ")).join("\n") || "  (none)"}

CONSTRAINTS
  - Never use a word or construction that does not appear above. A comprehension
    passage may introduce a word only if it is listed in that drill's "glossary".
  - Set "rulesTested" to the rule ids the question actually turns on, and
    "vocabUsed" to the lemmas it uses. Both are checked against the lists above.
  - Distractors must be wrong for a reason a learner would state, not by being
    nonsense. A good wrong option is the mistake this rule exists to prevent.
  - "explanation" must say why the right answer is right AND why the tempting
    wrong one is wrong. Refer to rules by their ¶ number.
  - Ids are lowercase kebab-case and unique across the whole course.
  - NEVER ask a question that counts surface features: how many letters, vowels,
    commas or syllables a string has. Nor one answerable without knowing the
    language (the option in another script, the odd one out by length), nor one
    answerable by reading the rule text verbatim. A question earns its place
    only if a learner who has not internalised the rule can plausibly get it wrong.
  - Build a matching question's three wrong pairings from real confusions — an
    ending shared across two declensions, a case governed by the same
    preposition — never by shuffling at random.
  - End the set with items that put EVERYTHING taught so far to the test, using
    earlier rules as the trap. Confusion must come from the language, never from
    the question: ambiguous stems and defensible-but-wrong options are bugs.
  - Every comprehension drill carries "sources". A passage you write is
    {"kind":"composed","citation":"Composed for this course."} plus a citation
    for any grammar or idiom it leans on; a real excerpt names author, title,
    publication, date, url and licence, and may only come from an open source.
    Never invent a citation.

Return a JSON array of drill objects conforming to this schema:
${JSON.stringify(z.toJSONSchema(Drill, { io: "input" }), null, 2)}`;
}

/* ---------------------------------------------------------------- generation */

export class NullGenerator implements DrillGenerator {
  readonly name = "null";

  async generate(): Promise<unknown[]> {
    throw new Error(
      [
        "No drill generator is configured.",
        "",
        "Everything except the provider call is in place: buildPrompt() renders a",
        "section's rules and vocabulary into a prompt with the drill JSON schema",
        "attached, and generate() validates whatever comes back.",
        "",
        "To wire one up:",
        "  1. npm i @anthropic-ai/sdk        (or another provider's SDK)",
        "  2. implement DrillGenerator.generate(prompt, spec) in this file,",
        "     requesting structured output so the response is a JSON array",
        "  3. pass it to generate() instead of NullGenerator",
        "  4. review the output, write it into the section's drills[], and run",
        "     `npm run validate:content` before committing",
      ].join("\n"),
    );
  }
}

export interface GenerationResult {
  drills: DrillType[];
  /** Items the model returned that failed the schema, with the reason. */
  rejected: { index: number; reason: string }[];
}

/**
 * Run a generator and keep only what validates. Schema failures are reported
 * rather than thrown: a batch of twenty questions is still worth having if two
 * of them are malformed.
 */
export async function generate(
  courseId: string,
  sectionId: string,
  spec: GenerationSpec,
  generator: DrillGenerator,
): Promise<GenerationResult> {
  const { course, sections } = getCourse(courseId);
  const target = getSection(courseId, sectionId);
  if (!target) throw new Error(`no such section: ${courseId}/${sectionId}`);

  const at = sections.findIndex((s) => s.id === sectionId);
  const taughtSoFar = sections
    .slice(0, at + 1)
    .filter((s): s is LessonSection => !isCheckpoint(s));

  const prompt = buildPrompt(target, taughtSoFar, course, spec);
  const raw = await generator.generate(prompt, spec);

  const drills: DrillType[] = [];
  const rejected: { index: number; reason: string }[] = [];

  raw.forEach((item, index) => {
    const parsed = Drill.safeParse(item);
    if (parsed.success) drills.push(parsed.data);
    else
      rejected.push({
        index,
        reason: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
  });

  return { drills, rejected };
}

/** A spec proportional to the targets the validator enforces. */
export function defaultSpec(section: Section): GenerationSpec {
  return isCheckpoint(section)
    ? {
        counts: { single: 12, multi: 5, integer: 3, comprehension: 2 },
        difficultyMix: CHECKPOINT_TARGETS.difficultyMix,
        covers: section.covers,
      }
    : {
        counts: { single: 10, multi: 4, integer: 3, comprehension: 1 },
        difficultyMix: { easy: 25, medium: 40, hard: 35 },
      };
}

/* ----------------------------------------------------------------------- cli */

if (process.argv[1]?.endsWith("generate-drills.ts")) {
  const [courseId, sectionId] = process.argv.slice(2);
  if (!courseId || !sectionId) {
    console.error(
      "usage: npx tsx scripts/generate-drills.ts <course-id> <section-id> [--print-prompt]",
    );
    console.error(`courses: ${listCourseIds().join(", ")}`);
    process.exit(1);
  }

  const section = getSection(courseId, sectionId);
  if (!section) {
    console.error(`no such section: ${courseId}/${sectionId}`);
    process.exit(1);
  }

  const spec = defaultSpec(section);

  if (process.argv.includes("--print-prompt")) {
    const { course, sections } = getCourse(courseId);
    const at = sections.findIndex((s) => s.id === sectionId);
    console.log(
      buildPrompt(
        section,
        sections
          .slice(0, at + 1)
          .filter((s): s is LessonSection => !isCheckpoint(s)),
        course,
        spec,
      ),
    );
  } else {
    generate(courseId, sectionId, spec, new NullGenerator()).catch((cause) => {
      console.error(cause instanceof Error ? cause.message : cause);
      console.error(
        "\nRun with --print-prompt to see the prompt that would be sent.",
      );
      process.exit(1);
    });
  }
}
