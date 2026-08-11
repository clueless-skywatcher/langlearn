import { Fragment, type ReactNode } from "react";

import { teluguRuns, transliterateTelugu } from "./translit";

/**
 * Inline markdown for rule statements, question stems and explanations:
 * `**bold**`, `*italic*` and `` `code` ``. Nothing else is supported, and the
 * text is never passed to `dangerouslySetInnerHTML` — the content is authored
 * in this repository, but a generator writes some of it, so it is treated as
 * data rather than as markup.
 *
 * Italic is used throughout the content for target-language words, so it
 * renders in the target-language style.
 */
const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

/** Fold to bare letters so "pustakaṁ" and "pustakam" compare equal. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Whether a romanization already follows the run — either as `(roman)` or as
 * `— roman`, possibly through some markdown punctuation. Deliberately strict:
 * it compares the whole parenthetical rather than looking for the letters
 * anywhere nearby, so a chance match cannot suppress a needed gloss.
 */
function romanizationFollows(after: string, roman: string): boolean {
  const rest = after.replace(/^[*_`\s]+/, "");
  const paren = /^\(([^()]{1,200})\)/.exec(rest);
  if (paren && fold(paren[1]) === fold(roman)) return true;
  const dash = /^[—-]\s*([^,.;()]{1,200})/.exec(rest);
  return !!dash && fold(dash[1]).startsWith(fold(roman)) && fold(roman).length > 0;
}

/**
 * Whether the text between two runs of target script keeps them in the same
 * sentence. Exposition does not: a Latin letter or a digit between them means
 * the two are being cited separately — *"**ఇది** is this and **అది** is that"*
 * — and each wants its own reading. Neither does a line break or a full stop,
 * which end a sentence outright.
 *
 * Nor does an emphasis marker. `**అక్కా**, **తండ్రి**` is two citations that
 * happen to be adjacent, not a two-word phrase: joining them yields
 * *అక్కా, తండ్రి (akkā, taṇḍri)*, which reads as though the whole parenthesis
 * belonged to తండ్రి. A comma alone still joins, so `రాము, నేను వస్తాను`
 * stays one sentence — it is the closing-then-opening `**` that marks the two
 * as separately quoted.
 */
function joinsSpan(gap: string): boolean {
  return (
    !/[\p{L}\p{N}]/u.test(gap) && !/[.?!…\n]/.test(gap) && !/[*`]/.test(gap)
  );
}

/**
 * How far past the end of a span the reading is written. Markdown closers are
 * always stepped over, so a gloss is never swept into the bold that wraps the
 * text it reads. A sentence's own closing punctuation is stepped over too —
 * *ఉంది? (undi)*, not *ఉంది (undi)?* — but a single cited word's is not, since
 * the full stop after it belongs to the English sentence around it rather than
 * to the citation.
 */
function tailLength(after: string, sentence: boolean): number {
  const tail = sentence ? /^[*`"'”’»)\]?!.…]*/ : /^[*`"'”’»)\]]*/;
  return tail.exec(after)![0].length;
}

/**
 * Insert a romanization after every run of non-Latin script, so that a learner
 * who has skipped the sections teaching that script can still read the rules,
 * the questions and — crucially — the options they must choose between.
 *
 * This happens at render time rather than being written into the content.
 * Content that carried its own romanization would have to be regenerated
 * whenever a sentence was edited, and would drift silently when it was not;
 * deriving it from the text itself cannot drift. Where the automatic reading
 * is wrong, the content can still override it — see `Example.roman`.
 *
 * There is one place this must not happen, and it is not a detail: a question
 * that asks the learner to *read* something. Printing the reading beside the
 * glyph answers it. Such items set `scriptCritical` and are rendered through
 * `inline(text, false)`; the validator makes sure they do.
 */
export function romanize(text: string): string {
  const runs = teluguRuns(text);
  if (runs.length === 0) return text;

  // Runs separated only by spacing and punctuation are one sentence, and are
  // read out once at the end of it rather than word by word. A gloss per word
  // does not produce a readable sentence: "నా (nā) అక్క (akka) ఎక్కడ (ekkaḍa)
  // ఉంది (undi)?" cuts both the Telugu and its reading into four pieces the
  // learner has to reassemble, where "నా అక్క ఎక్కడ ఉంది? (nā akka ekkaḍa
  // undi)" reads straight through, twice. See CLAUDE.md §12.
  const spans: { start: number; end: number; runs: number }[] = [];
  for (const run of runs) {
    const last = spans[spans.length - 1];
    if (last && joinsSpan(text.slice(last.end, run.start))) {
      last.end = run.end;
      last.runs += 1;
    } else {
      spans.push({ start: run.start, end: run.end, runs: 1 });
    }
  }

  // Each distinct span is read out once per block. Glossing every occurrence
  // makes a rule that repeats a word — and a rule about numerals repeats them
  // constantly — unreadable. The learner has the reading from the first
  // occurrence and can carry it to the rest.
  const glossed = new Set<string>();

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    const source = text.slice(span.start, span.end);
    // The span is transliterated whole, so the spacing and the punctuation
    // inside it survive into the reading; markdown does not, since it would
    // reach the reader as literal asterisks inside the parenthesis.
    const roman = transliterateTelugu(source)
      .replace(/[*`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const tail = span.end + tailLength(text.slice(span.end), span.runs > 1);
    out += text.slice(cursor, tail);
    cursor = tail;
    if (!roman) continue;
    // A reading the author wrote in counts as this span having been read out.
    if (romanizationFollows(text.slice(tail), roman)) {
      glossed.add(source);
      continue;
    }
    if (glossed.has(source)) continue;
    out += ` (${roman})`;
    glossed.add(source);
  }
  return out + text.slice(cursor);
}

/**
 * `romanized` is false where the target text is the thing being read — see
 * {@link romanize}. It only suppresses the *derived* reading; Latin the author
 * wrote into the string is left alone, which is why the validator checks the
 * rendered result rather than trusting the flag.
 */
export function inline(text: string, romanized = true): ReactNode {
  return (romanized ? romanize(text) : text)
    .split(TOKEN)
    .map((part, i) => {
      if (i % 2 === 0) return part ? <Fragment key={i}>{part}</Fragment> : null;

      if (part.startsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`")) {
        return (
          <code key={i} className="rounded bg-accent-soft px-1 py-0.5 text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        );
      }
      return (
        <em key={i} className="target not-italic">
          <i>{part.slice(1, -1)}</i>
        </em>
      );
    });
}

/** Inline markdown plus blank-line paragraph breaks. */
export function paragraphs(
  text: string,
  className = "",
  romanized = true,
): ReactNode {
  return text.split(/\n{2,}/).map((para, i) => (
    <p key={i} className={className}>
      {inline(para, romanized)}
    </p>
  ));
}

/**
 * Block text in which **every** line break is meaningful: a dialogue turn, a
 * line of a notice, a line of verse. `paragraphs` folds single newlines into
 * running prose, which turns a conversation into one unreadable block and
 * loses the speaker labels along with it.
 */
export function lines(
  text: string,
  className = "",
  romanized = true,
): ReactNode {
  return text.split("\n").map((line, i) =>
    line.trim() === "" ? (
      <span key={i} aria-hidden className="block h-3" />
    ) : (
      <p key={i} className={className}>
        {inline(line, romanized)}
      </p>
    ),
  );
}
