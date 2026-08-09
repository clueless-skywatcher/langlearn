import type { ScriptSection } from "@/content/schema";
import { hasTelugu, transliterateTelugu } from "@/lib/translit";

/** The alphabet table of a script section. */
export function ScriptTable({ script }: { script: ScriptSection }) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 text-xl font-semibold tracking-tight">
        {script.heading}
      </h2>

      <div className="overflow-x-auto rounded border border-rule bg-raised">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-3 py-2 font-medium">Letter</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">IPA</th>
              <th className="px-3 py-2 font-medium">Approximately</th>
            </tr>
          </thead>
          <tbody>
            {script.letters.map((l) => (
              <tr key={l.glyph} className="border-b border-rule/60 last:border-0">
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="target text-lg not-italic">
                    {l.upper ? `${l.upper} ${l.glyph}` : l.glyph}
                  </span>
                  {hasTelugu(l.glyph) && (
                    <span className="ml-2 text-xs text-ink-faint">
                      {transliterateTelugu(l.glyph)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                  {l.name}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-soft">
                  {l.ipa}
                </td>
                <td className="px-3 py-2 text-ink-soft">{l.approx}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {script.notes.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm text-ink-soft">
          {script.notes.map((note, i) => (
            <li key={i} className="border-l-2 border-rule pl-3">
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
