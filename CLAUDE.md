@AGENTS.md

# Course authoring rules

These apply to **every** language pack under `content/` — Lithuanian, Telugu,
Esperanto, and any course added later. They govern the JSON content, not the
app code. The machine-checkable half lives in `content/schema.ts` and
`content/validate.ts`; run `yarn validate:content` (or `yarn check`, which adds
the typecheck and the tests) before considering any content change done.

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

Do not smuggle a matching item in as a `single` question with a pairing table in
the stem: the variant, its scoring in `lib/scoring.ts` and its renderer all
exist, and the validator requires one of every format in an exam paper.

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

`components/DrillRunner.tsx` shows the question number and the format label and
nothing else; keep it that way.

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

`BoundaryExamSection` (`kind: "boundary"`) exists alongside `LessonSection` and
`CheckpointSection`, and `BOUNDARY_TARGETS` in `content/validate.ts` holds its
composition targets — including the minimum shares of matching and
comprehension. Only a `boundary` section may be titled a boundary examination.

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

At least two questions on every passage must ask about what it *says*, in the
target language, rather than about the grammar it illustrates. The validator
knows each course's interrogatives; add yours to `CONTENT_QUESTION` in
`content/validate.ts` when adding a language.

## 8. No romanization where reading the script is the question

A course in a non-Latin script declares `transliteration` in its course file,
and the renderer then derives a reading for every run of target text it shows —
which is what keeps the *grammar* answerable by someone who skipped the script
sections. In the script sections themselves that is exactly wrong. "Which
letter is ఖ (kha)?" over an option reading `kha` is not a question about Telugu;
it is a question about whether two Latin strings match.

So:

- Any question that asks the learner to read, name or tell apart a glyph sets
  `scriptCritical: true`, and the renderer shows its stem, options and columns
  bare. The romanization stays on the explanation, which is only revealed once
  the answer is in.
- Every question in a section that teaches a script — and every exam item
  attributed back to one — must set it. The validator enforces this.
- The flag is not enough on its own. Do not hand-write the reading into the
  stem either: `Which letter is **గ** (ga)?` gives the answer away whatever the
  flag says, and so does a stem that prints the correct option's glyph and asks
  you to find its twin. The validator checks the rendered text for both.
- Ask in whichever direction keeps the glyph load on the learner. Naming the
  sound in the stem and offering four bare glyphs is fair; so is showing one
  glyph and offering four readings. Showing both is not.
- The same applies to a comprehension passage set in the script sections: it
  carries no parallel romanization, because decoding it is the exercise.

## 9. State the rule; do not instruct the learner

A rule says how the language works. It does not tell the learner what to do
about it, what to find hard, or what to commit to memory. Those are the
learner's business, and a course that keeps issuing directions reads as though
it does not trust them.

Banned from rule statements, footnotes, paradigm captions and explanations:

- Imperatives aimed at the reader — *note that*, *remember*, *observe*,
  *compare*, *read the column down*, *learn these*, *do not confuse*.
- Study advice: what is *worth learning* or *worth knowing*, what *must be
  memorised* or *learned by heart*, what a learner *should* do, what to
  *resist*, what is *not worth imitating*.
- Difficulty commentary: *this is the hard part*, *the one most often missed*,
  *worth dwelling on*, *a learner will go wrong here*. §5 already keeps the
  `difficulty` field away from the learner; prose must not smuggle it back.

Write the fact and stop. *"Note that the plural of వెయ్యి is వేలు"* is
*"The plural of వెయ్యి is వేలు"*. *"The teens are irregular and must be learned
singly"* is *"The teens are irregular"* — that the learner will therefore have
to learn them is not a further fact about Telugu.

A bare cross-reference is not an instruction and stays: `(¶42)`, or `(see ¶42)`
in the manner of the book this exposition follows. What is banned is the
sentence built around it — *"Compare ¶42 and you will see…"*.

Describing the language is not instructing: *"the sexes are distinguished when
alone and not when together"* is a statement about Telugu and belongs. So does
naming a form's register — *"అది of a woman is impolite"* is a fact about
usage, not advice.

## 10. Rule statements are short

Each rule's `statement` is at most **two or three sentences**, and as concise as
the fact allows. One rule, one fact; if a paragraph is growing a second fact,
it is a second rule.

Paradigms, examples and footnotes carry the detail the statement must not:
tables, stem alternations, spoken variants, cross-tense comparisons. The
statement names the form and stops.

Split a long rule rather than compress it into a telegram. ¶62–¶65 (past
denial, the negative tense, progressive denial) are the pattern: what used to
be one block is three rules plus a one-line frame, each readable in a glance.

## 11. Integer questions are not only counts

`IntegerQuestion` accepts any non-negative integer. It is not a counting
format, and a pack in which every integer item opens *how many* has used one
shape and mistaken it for the format.

Shapes it takes just as well, several of them better tests than a count:

- **Read a number.** Give the numeral in the target language and ask for the
  figure — *ఇరవై ఒకటి* → 21, *నూట ఇరవై ఒకటి* → 121, *ముగ్గురు* → 3. This tests
  the numeral system head-on, and unlike four options it cannot be narrowed by
  elimination: the learner has to produce the answer.
- **Read a form and give the value it carries** — which numbered rule governs
  it, which declension or conjugation it belongs to, which person an ending
  marks.
- **A quantity the passage states**: an age, a year, a price, a time, a
  distance. The learner has to read the passage to find it.
- **How many distinct forms a paradigm collapses**, which is the count §2
  sanctions by name.

Counts are legitimate where the material is an inventory — an alphabet has a
number of letters and asking for it is fair. What is wrong is reaching for
*how many* by reflex when the material offers something better. A numerals
section that asks how many of five words denote people, rather than what
*నూట ఇరవై ఒకటి* comes to, has wasted the one format in which the learner
answers in their own hand.

The validator warns once per pack when nearly every integer item is a count.
It cannot judge whether a particular count was the right question; that is the
author's job.

### Never write the number in figures in the stem

A question about a numeral must not print that numeral as a figure. *"**రెండు
వందలు** is 200. How is **251** said?"* hands over the decomposition — two,
five, one — so the learner assembles from something already on the page
instead of knowing the words. Ask it as *"How is **two hundred and fifty-one**
said?"*, or the other way about: give the Telugu and take the figure as the
answer.

This holds however the figure gets there. A stem reading *"what number is
౧౦౧?"* prints its own answer as soon as the renderer transliterates the Telugu
digits, because they come out as `101`; such items are `scriptCritical` (§8)
and the validator checks the rendered text, not the source.

Figures that are not the number in question are fine and often necessary:
grammatical notation (*1 sg.*, *3rd person*), a level tag (*A1*), a price or a
year that the passage states and the learner has to find. The rule is about
the number being asked for, not about digits.

## 12. The romanization follows the sentence, not the word

A course in a non-Latin script has its reading derived at render time (§8), and
the derivation is per *sentence*, not per word. A stem glossed word by word —

> నా (nā) అక్క (akka) ఎక్కడ (ekkaḍa) ఉంది (undi)?

is not a sentence a learner can read: the Telugu is cut into four pieces by
four parentheses, and both the target text and its reading have to be
reassembled before either can be taken in. The reading goes after the whole of
it instead, once:

> నా అక్క ఎక్కడ ఉంది? (nā akka ekkaḍa undi)

`romanize` in `lib/markdown.tsx` does this by grouping runs of target script
into spans. Runs separated only by spaces and punctuation are one sentence and
are read out together; exposition between them — any Latin letter or digit — a
line break, or a full stop ends the span. A sentence's reading is placed after
its own closing punctuation and outside whatever markdown wraps it, so that
`**… ఉంది?**` reads `**… ఉంది?** (… undi)`.

A single cited word keeps its reading immediately after it — **ఇల్లు** (illu)
— because a citation form is not a sentence; only its markdown closers are
stepped over, so the gloss is not swept into the bold.

A comprehension passage is not glossed inline at all. It is printed as it
stands and the romanization follows the whole passage as a parallel block,
which is what `ComprehensionDrill.romanization` is for. Interleaving readings
into a passage destroys the one thing a passage is for.

None of this applies where reading the script *is* the question: §8 governs
there, and `scriptCritical` suppresses the derived reading entirely.

## 13. A noun is cited with its oblique stem

In a language where the case suffixes are regular and the stem in front of
them is not, the stem is the part a learner cannot derive. So every noun in a
`vocabulary` block carries its oblique stem beside its nominative, in the same
way a Latin noun is cited with its genitive and a Lithuanian one with both:

```json
{ "lemma": "ఇల్లు", "gloss": "house", "pos": "noun",
  "forms": { "nom": "ఇల్లు", "oblique": "ఇంటి-", "translit": "illu", "class": "amahat sg." } }
```

The `oblique` key is declared in `Course.formLabels.noun`, so the renderer
shows it wherever vocabulary is listed. A noun whose oblique is identical with
its nominative still states it — that identity is a fact about the noun, and
leaving the field out makes it indistinguishable from a noun nobody checked.

Write the oblique with the trailing hyphen it earns: it is a bound form and
never stands alone. Where a noun has two obliques — a noun in **-ం** has one
for the genitive and another before the accusative and dative (K&G §8.5F,
§9.9) — give both, separated by a comma: `"పుస్తకం-, పుస్తకాని-"`.

This applies to `pos: "noun"`. Pronouns already carry their oblique as the
possessive stem; verbs are cited by root (§ the Telugu course's `formLabels`).

An emphasis marker between two runs also ends the span. `**అక్కా**, **తండ్రి**`
is two citations that happen to be adjacent, not a two-word phrase; merging
them would print *అక్కా, తండ్రి (akkā, taṇḍri)* and read as though the whole
parenthesis belonged to the second word. A bare comma still joins, so
`రాము, నేను వస్తాను` stays one sentence.

## 14. Some scripts get their romanization from a source, not the generator

The derived reading of §8 and §12 is a character machine: `lib/translit.ts`
walks the target script and supplies the vowels an abugida leaves implicit.
That works for Telugu, where the inherent vowel is pronounced wherever it is
written, and it does not work for a language whose orthography and pronunciation
have come apart. Bengali is the case in hand: the inherent vowel is read *o*
rather than *a* and is dropped at the end of most words, য় and ব behave
differently in clusters than in isolation, and a generated table produces
readings — *āpela* for আপেল, *mana* for মন — that no Bengali speaker would
recognise. A reading that misleads is worse than no reading, because the learner
cannot tell which of the two they are looking at.

So a course whose script the generator does not handle **does not rely on the
derived reading**. Its romanizations are authored into the content — `translit`
in a `forms` block, the parenthesised reading after a sentence,
`ComprehensionDrill.romanization` for a passage — and every one of them comes
from a source:

- **Wiktionary** first, which gives Bengali entries a transliteration and an IPA
  pronunciation; take the transliteration, in the scheme the course declares in
  `Course.transliteration.scheme`.
- Failing that, any open, publicly reachable source that romanizes the form: a
  dictionary, a grammar, a language-institute or public-broadcaster wordlist, a
  Wikipedia article that gives the transliteration alongside the script. If a
  Google search cannot reach it, it cannot be cited, and §1 applies to these
  sources like any other — name them in the page footer.

Do not romanize by applying a letter table yourself, and do not extend
`lib/translit.ts` with a table for such a script: a per-character mapping is the
thing that is wrong here, not the thing that is missing. Where no source gives a
reading for a form, use a form that has one.

The rest of the romanization rules are unchanged for these courses. The reading
still follows the whole sentence rather than each word (§12), a passage still
carries its reading as a parallel block rather than inline, and a question that
asks the learner to read a glyph still sets `scriptCritical` and shows no reading
at all (§8).
