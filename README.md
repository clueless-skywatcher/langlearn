# langlearn

Graded language courses: numbered grammar rules and vocabulary, then
examination-style drills, with a cumulative checkpoint after every block of
three or four sections.

The engine holds nothing language-specific. A course is a validated data pack
under `content/`, and the course id is a segment of every route, so **adding a
language is adding a directory** — no code changes.

Two courses ship:

| id | course | source |
| --- | --- | --- |
| `lt` | Lithuanian, A1→C2 | original; rules written after Kellerman's manner |
| `eo` | Esperanto, A1→C2 | adapted from Kellerman's *A Complete Grammar of Esperanto* (1910), whose own rule numbering is preserved |

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

`npm run check` runs the content validator, the typechecker and the tests.

## Where progress is stored

Grading always happens on the server, so the rubric has one implementation and
a recorded score is one the server computed. Only *persistence* varies, chosen
by `NEXT_PUBLIC_LANGLEARN_STORE` (see `.env.example`):

| value | progress lives in | needs |
| --- | --- | --- |
| `browser` (default) | `localStorage`, on the learner's machine | nothing |
| `sqlite` | `db/app.db` on the server | a writable disk, a long-lived process, Node ≥ 23.4 |

Both are implementations of one `ProgressStore` interface (`lib/progress/`),
and both run in the browser: one writes to `localStorage`, the other calls
`/api/progress`. The shape of stored progress — best versus latest, when a
question stops counting as a mistake — is defined once as pure functions in
`lib/progress/rollup.ts`, which is what keeps the two from drifting.

```bash
npm run dev            # browser store, the default
npm run dev:sqlite     # server-side SQLite instead
```

The browser store's honest limitation: progress is per-browser and per-device,
and clearing site data clears it.

## Deploying

It deploys to Vercel, or any static host with serverless functions, with no
configuration:

- **Leave `NEXT_PUBLIC_LANGLEARN_STORE` unset.** The default browser store
  needs no database. The SQLite store *cannot* work on serverless hosts — the
  filesystem is read-only and each invocation is ephemeral — and `node:sqlite`
  is behind a flag before Node 23.4, which is older than most defaults.
- Every page is prerendered; only `/api/attempts` runs per request.
- `next.config.ts` explicitly traces `content/**/*.json` into the API routes.
  The loader discovers packs with `readdirSync`, which the build's file tracer
  cannot follow, so without that the deployed function would have no content to
  grade against.

## How content is organised

```
content/
  schema.ts                 Zod schemas; the single source of truth for shape
  loader.ts                 reads packs, orders sections into a path
  validate.ts               integrity rules the schema cannot express
  lt/                       ─┐ one directory per course; the directory name
    course.json              │ is the course id and the first URL segment
    outline.md               │
    sections/*.json          │
  eo/                       ─┘
    …
```

Routes are `/` (course index), `/<course>`, `/<course>/learn/<section>`,
`/<course>/drill/<section>`, `/<course>/review`. Progress, attempts and the
review list are all scoped by course id in SQLite.

A **lesson** section carries numbered rules, vocabulary, optionally an alphabet
table, and 8–14 drill questions. A **checkpoint** carries no teaching of its
own: it names the 3–4 lesson sections it `covers` and examines them with 20–30
questions.

Rules follow the form used in Ivy Kellerman Reed's *A Complete Grammar of
Esperanto* (1910): a numbered paragraph under a heading, stating *why* a usage
holds, followed by glossed `target — gloss` examples, paradigm tables where a
declension needs one, footnotes, and cross-references to earlier rules. Each
course numbers its own rules; the Esperanto pack keeps the book's numbers, so
¶16 in the app is ¶16 in the book. Where a course names a source, it is
declared as `attribution` in `course.json` and shown in that course's footer.

## Question formats

Drills use the JEE Advanced formats and marking scheme, implemented once in
`lib/scoring.ts`:

| format | shape | marks |
| --- | --- | --- |
| `single` | four options, one correct | +4 / −1 |
| `multi` | four options, one or more correct | +4 all; +1 per correct option if the selection is an error-free subset; −2 if any wrong option is chosen |
| `integer` | a non-negative integer | +4 / 0 |
| `comprehension` | a passage with 2–3 dependent questions | sum of its children |

Grading happens on the server (`app/api/attempts`), so a recorded score is one
the server computed and the rubric has exactly one implementation. The route
returns the graded result together with the sitting; whether that sitting is
written server-side or by the client depends on the store in use.

## Checkpoints

Checkpoints sit in the ordinary path sequence — `a1-01, a1-02, a1-03,
a1-cp-01, …`. Each question inside one carries `fromSection`, which turns the
result into a per-section breakdown: a failed paper names the sections to
revisit rather than just a number. The pass threshold (default 60%) is
advisory; the next block stays reachable.

The validator enforces composition rather than leaving it to authoring
discretion — question count, at least three questions per covered section,
every `core` rule examined, a difficulty mix within ten points of 30/40/30, and
all four formats present. From B1 up it also requires two passages and an
integer question embedded in one.

## Adding a language

1. Create `content/<id>/course.json`. `formLabels` names and orders the
   dictionary citation forms per part of speech — Lithuanian cites a verb as
   `dirbti, dirba, dirbo` and a noun with its genitive and gender, Esperanto
   cites a noun with its plural. Nothing else about the language is declared
   in code.
2. Add sections under `content/<id>/sections/`. A section with a `script`
   block gets an alphabet table; `direction: "rtl"` flips the course.
3. `npm run validate:content` and `npm test`. Both walk every pack under
   `content/`, so a new course is covered the moment its directory exists.

## Authoring a section

1. Write `content/<course>/sections/<id>.json`. Copy the shape of an existing
   file; unknown keys are rejected, so a typo fails loudly rather than
   vanishing.
2. `npm run validate:content` — it checks that drills only test rules already
   taught, that vocabulary is introduced before it is used, that every `core`
   rule is drilled, and that each checkpoint fairly covers its block.
3. `npm test`.

## Generating drills

`scripts/generate-drills.ts` builds the prompt for a section from its own rules
and vocabulary, attaches the drill JSON schema, and validates whatever comes
back — but **no model provider is wired up yet**. Running it prints what to do:

```bash
npm run generate:drills lt a1-cp-01 --print-prompt   # see the prompt
npm run generate:drills eo eo-cp-01                  # explains how to wire a provider
```

Generated drills are meant to be reviewed and committed as JSON, not fetched at
runtime.

## Not yet built

Audio, spaced repetition (the `srs_items` table exists but nothing writes it),
user accounts, syncing browser-stored progress between devices, and the live
generator.
