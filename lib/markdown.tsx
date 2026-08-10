import { Fragment, type ReactNode } from "react";

import { teluguRuns } from "./translit";

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
  const paren = /^\(([^()]{1,40})\)/.exec(rest);
  if (paren && fold(paren[1]) === fold(roman)) return true;
  const dash = /^[—-]\s*([^,.;()]{1,40})/.exec(rest);
  return !!dash && fold(dash[1]).startsWith(fold(roman)) && fold(roman).length > 0;
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
 */
export function romanize(text: string): string {
  const runs = teluguRuns(text);
  if (runs.length === 0) return text;

  let out = "";
  let cursor = 0;
  for (const run of runs) {
    out += text.slice(cursor, run.end);
    cursor = run.end;
    const roman = run.roman.trim();
    if (roman && !romanizationFollows(text.slice(run.end), roman)) {
      out += ` (${roman})`;
    }
  }
  return out + text.slice(cursor);
}

export function inline(text: string): ReactNode {
  return romanize(text)
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
export function paragraphs(text: string, className = ""): ReactNode {
  return text.split(/\n{2,}/).map((para, i) => (
    <p key={i} className={className}>
      {inline(para)}
    </p>
  ));
}

/**
 * Block text in which **every** line break is meaningful: a dialogue turn, a
 * line of a notice, a line of verse. `paragraphs` folds single newlines into
 * running prose, which turns a conversation into one unreadable block and
 * loses the speaker labels along with it.
 */
export function lines(text: string, className = ""): ReactNode {
  return text.split("\n").map((line, i) =>
    line.trim() === "" ? (
      <span key={i} aria-hidden className="block h-3" />
    ) : (
      <p key={i} className={className}>
        {inline(line)}
      </p>
    ),
  );
}
