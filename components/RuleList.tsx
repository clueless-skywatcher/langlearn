import type { Paradigm, Rule } from "@/content/schema";
import { inline } from "@/lib/markdown";
import { hasTelugu, transliterateTelugu } from "@/lib/translit";

function ParadigmTable({ paradigm }: { paradigm: Paradigm }) {
  const { columns, rows } = paradigm;
  // Authors often put the row key both as columns[0] ("case", "figure", …)
  // and as row.label, leaving cells one short. Treat columns[0] as the label
  // header in that case so headers and cells line up.
  const cellsMatchColumns = rows.every((r) => r.cells.length === columns.length);
  const cellsMatchTail =
    columns.length > 0 &&
    rows.every((r) => r.cells.length === columns.length - 1);
  const labelOwnsFirstColumn = cellsMatchTail && !cellsMatchColumns;
  const labelHeader = labelOwnsFirstColumn ? columns[0] : null;
  const dataColumns = labelOwnsFirstColumn ? columns.slice(1) : columns;

  return (
    <figure className="mx-auto my-4 w-fit max-w-full overflow-x-auto rounded border border-rule bg-raised">
      <table className="border-collapse text-sm">
        <caption className="border-b border-rule px-3 py-2 text-left text-xs uppercase tracking-wide text-ink-faint">
          {inline(paradigm.caption)}
        </caption>
        <thead>
          <tr className="border-b border-rule text-left text-xs text-ink-faint">
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              {labelHeader ? inline(labelHeader) : null}
            </th>
            {dataColumns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                {inline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-rule/60 last:border-0">
              <th className="whitespace-nowrap px-3 py-2 text-left align-top font-normal text-ink-soft">
                {inline(row.label)}
              </th>
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className="target whitespace-nowrap px-3 py-2 align-top not-italic"
                >
                  {inline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {paradigm.footnote && (
        <figcaption className="w-0 min-w-full border-t border-rule px-3 py-2 text-xs leading-relaxed text-ink-faint">
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
                  {(ex.roman ?? (hasTelugu(ex.target) ? transliterateTelugu(ex.target) : "")) && (
                    <dd className="text-ink-faint">
                      {ex.roman ?? transliterateTelugu(ex.target)}
                    </dd>
                  )}
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
