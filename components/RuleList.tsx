import type { Paradigm, Rule } from "@/content/schema";
import { inline } from "@/lib/markdown";

function ParadigmTable({ paradigm }: { paradigm: Paradigm }) {
  return (
    <figure className="my-4 overflow-x-auto rounded border border-rule bg-raised">
      <table className="w-full min-w-[24rem] border-collapse text-sm">
        <caption className="border-b border-rule px-3 py-2 text-left text-xs uppercase tracking-wide text-ink-faint">
          {paradigm.caption}
        </caption>
        <thead>
          <tr className="border-b border-rule text-left text-xs text-ink-faint">
            <th className="px-3 py-2 font-medium" />
            {paradigm.columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paradigm.rows.map((row) => (
            <tr key={row.label} className="border-b border-rule/60 last:border-0">
              <th className="whitespace-nowrap px-3 py-2 text-left font-normal text-ink-soft">
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td key={i} className="target px-3 py-2 not-italic">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {paradigm.footnote && (
        <figcaption className="border-t border-rule px-3 py-2 text-xs text-ink-faint">
          {inline(paradigm.footnote)}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * The numbered rules of a section, in the shape the book uses: a numbered
 * paragraph under a heading, its examples set apart as glossed pairs, then
 * paradigms and footnotes.
 */
export function RuleList({ rules }: { rules: Rule[] }) {
  return (
    <section className="space-y-10">
      {rules.map((rule) => (
        <article key={rule.id} id={rule.id} className="scroll-mt-8">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            {rule.heading}
          </h3>

          <p className="leading-relaxed">
            <span className="mr-2 font-semibold text-accent">
              {rule.number}.
            </span>
            {inline(rule.statement)}
          </p>

          {rule.examples.length > 0 && (
            <dl className="my-4 space-y-1.5 border-l-2 border-accent-soft pl-4 text-sm">
              {rule.examples.map((ex, i) => (
                <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="target">{ex.target}</dt>
                  <dd className="text-ink-soft">
                    {ex.gloss}
                    {ex.note && (
                      <span className="text-ink-faint"> — {ex.note}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {rule.paradigms.map((p, i) => (
            <ParadigmTable key={i} paradigm={p} />
          ))}

          {rule.footnotes.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-ink-faint">
              {rule.footnotes.map((f, i) => (
                <li key={i}>[{i + 1}] {inline(f)}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
