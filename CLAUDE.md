@AGENTS.md

# Course authoring rules

These apply to **every** language pack under `content/` — Lithuanian, Telugu,
Esperanto, and any course added later. They govern the JSON content, not the
app code. The machine-checkable half lives in `content/schema.ts` and
`content/validate.ts`; run `yarn validate` (see `scripts/`) before considering
any content change done.

## 1. Sources

Every page a learner can land on must carry its sources in a footer.

- Grammar rules, paradigms, and vocabulary: cite the grammar, dictionary, or
  corpus the form comes from. "I know Lithuanian" is not a source; neither is a
  bare language name.
- Reading passages taken from a real text: cite author, title, publication,
  date, and a URL, plus the licence or public-domain status. Excerpt only from
  open sources.
- Passages and dialogues you generated: say so explicitly — *"Composed for this
  course"* — rather than leaving provenance ambiguous. A generated passage still
  needs a source for any grammar or idiom it leans on.
- `Course.attribution` covers the manner of exposition for the whole course. It
  does not discharge the per-page obligation.

Never invent a citation. If you cannot source a claim, cut the claim.

## 2. Questions must test the grammar

Banned outright, at every level:

- Counting surface features: how many commas / letters / vowels / words are in
  a string, how many syllables a printed word has.
- Anything answerable by looking at the stem without knowing the language —
  spotting the option in a different script, the odd one out by length, the only
  option with a diacritic.
- Anything answerable by reading the immediately preceding rule text verbatim.

A question earns its place only if a learner who has not internalised the rule
can plausibly get it wrong. `IntegerQuestion` exists for grammatical counts
(how many distinct case forms this paradigm collapses, which numbered rule
governs the form), not for character counting.

## 3. JEE Advanced format

All drills follow JEE Advanced conventions, already encoded in the schema:

| Format | Shape | Scoring |
| --- | --- | --- |
| `single` | 4 options, exactly 1 correct | +4 / −1 |
| `multi` | 4 options, 1–4 correct | JEE partial credit |
| `integer` | non-negative integer | +4 / 0 |
| `comprehension` | passage + 2–5 dependent items | sum of children |
| **matching** | two columns to pair, 4 candidate pairings, pick the correct one | +4 / −1 |

Matching questions are part of the standard mix. Column I holds 4 items
(forms, endings, cases, tenses); Column II holds the labels. The four options
are four complete pairings, exactly one of which is right — the learner cannot
score by getting three of four pairs. Build the three distractor pairings from
real confusions (a shared ending across declensions, a case that governs the
same preposition), not by shuffling at random.

> Not yet in the schema: `matching` is not a member of the `Drill` union in
> `content/schema.ts`. Add the variant, its scoring in `lib/scoring.ts`, and its
> renderer before authoring matching items — do not smuggle them in as `single`
> questions with a pairing table in the stem.

## 4. Every drill set ends hard

Each section's drills must include items that put *everything taught so far* to
the test, not just that section's rules. Use earlier rules as the trap: a
question about the dative that only resolves if the learner still remembers
which verbs take the genitive. Cumulative items are allowed to be as confusing
as the language honestly permits — garden-path word order, near-homographs,
forms that are legal under one rule and blocked by another.

The one limit: confusion must come from the language, never from the question.
Ambiguous stems, options that are simultaneously defensible, and typos are bugs.

## 5. Never show difficulty

`difficulty` is authoring metadata — it drives the checkpoint mix in
`CHECKPOINT_TARGETS` and the progress rollups. It must never reach the learner:
not as a badge, a label, a colour, an ordering signal, or a hint in the stem.
Do not sort drills by difficulty, either; a predictable ramp is a tell.

> Currently violated: `components/DrillRunner.tsx:177` renders
> `{question.difficulty}` in the question header. Remove it.

## 6. Checkpoints and boundary exams

- **Checkpoints** (`kind: "checkpoint"`) examine the 3–4 lessons before them.
  They must be *harder* than the drills they follow and must not reuse or
  lightly reskin drill items. A checkpoint question should combine at least two
  sections' rules wherever the material allows. Reused stems are a validation
  failure waiting to happen and a wasted exam either way.
- **Course boundary exams** sit at each level transition (A1→A2, A2→B1, …) and
  are harder still: they examine the whole level, weight the cumulative and
  matching formats heavily, and assume every rule from the level is live. A
  learner who passed the checkpoints by memorising them should fail here.

> Not yet in the schema: there is no boundary-exam section kind. Add it
> (alongside `LessonSection` / `CheckpointSection`), with its own composition
> targets in `content/validate.ts`, before authoring one.

## 7. Reading comprehension

Every course draws comprehension passages from three kinds of material:

1. **Generated conversations** — dialogue between named speakers, doing
   something ordinary in the target culture.
2. **Generated passages** — narrative or expository prose written for the course.
3. **Genuine excerpts from open sources** — public-domain children's stories,
   folk tales, newspaper and magazine articles under an open licence,
   Wikipedia/Wikisource, government and public-broadcaster material.

Match the source to the level rather than to what is available:

| Level | Typical material |
| --- | --- |
| A1–A2 | dialogues, graded generated prose, children's storybooks, simple news briefs |
| B1–B2 | news articles, blog and magazine prose, folk tales, popular science |
| C1–C2 | literary excerpts, editorials, legal and academic prose, older orthography |

Real excerpts are quoted as published — do not silently simplify them. If a
passage needs help, use `glossary` for unmet words and `translation` for the
post-answer reveal. Cite per §1, in the passage footer.
