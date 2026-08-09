import { Fragment, type ReactNode } from "react";

/**
 * Inline markdown for rule statements, question stems and explanations:
 * `**bold**`, `*italic*` and `` `code` ``. Nothing else is supported, and the
 * text is never passed to `dangerouslySetInnerHTML` — the content is authored
 * in this repository, but a generator writes some of it, so it is treated as
 * data rather than as markup.
 *
 * Italic is used throughout the content for Lithuanian words, so it renders in
 * the target-language style.
 */
const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

export function inline(text: string): ReactNode {
  return text.split(TOKEN).map((part, i) => {
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
