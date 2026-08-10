import type { Source } from "@/content/schema";
import { inline } from "@/lib/markdown";

const KIND_LABEL: Record<Source["kind"], string> = {
  grammar: "Grammar",
  dictionary: "Dictionary",
  corpus: "Corpus",
  text: "Text",
  composed: "Provenance",
};

/**
 * The citations for whatever the learner is looking at. Every page carries
 * one, and so does every reading passage — a claim about the language that
 * cannot say where it comes from is a claim the course should not be making.
 *
 * `tight` is the passage variant: the same list, sized to sit inside a
 * passage card rather than to close a page.
 */
export function SourceFooter({
  sources,
  heading = "Sources",
  tight = false,
}: {
  sources: Source[];
  heading?: string;
  tight?: boolean;
}) {
  if (sources.length === 0) return null;

  return (
    <footer
      className={
        tight
          ? "mt-3 border-t border-rule pt-3"
          : "mt-12 border-t border-rule pt-6"
      }
    >
      <h2
        className={`mb-2 font-semibold uppercase tracking-wide text-ink-faint ${
          tight ? "text-[0.65rem]" : "text-xs"
        }`}
      >
        {heading}
      </h2>
      <ul className={`space-y-1.5 ${tight ? "text-[0.7rem]" : "text-xs"}`}>
        {sources.map((source, i) => (
          <li key={i} className="leading-relaxed text-ink-faint">
            <span className="mr-1.5 font-medium text-ink-soft">
              {KIND_LABEL[source.kind]}
            </span>
            {source.url ? (
              <a
                href={source.url}
                className="underline decoration-rule underline-offset-2 hover:text-accent"
                rel="noreferrer"
                target="_blank"
              >
                {inline(source.citation)}
              </a>
            ) : (
              inline(source.citation)
            )}
            {source.licence && <span> · {inline(source.licence)}</span>}
            {source.note && <span> — {inline(source.note)}</span>}
          </li>
        ))}
      </ul>
    </footer>
  );
}
