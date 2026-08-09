import type { Course, VocabEntry } from "@/content/schema";
import { hasTelugu, transliterateTelugu } from "@/lib/translit";

/**
 * Citation forms in the order the course declares for that part of speech,
 * then any remaining keys. This is what keeps the display language-agnostic:
 * Lithuanian cites a verb as `dirbti, dirba, dirbo`, another language will
 * cite something else, and only `course.formLabels` has to change.
 */
function citation(entry: VocabEntry, course: Course): string {
  const labels = course.formLabels[entry.pos] ?? [];
  const ordered = labels.map((l) => l.key).filter((k) => k in entry.forms);
  const rest = Object.keys(entry.forms).filter((k) => !ordered.includes(k));
  return [...ordered, ...rest]
    .map((k) => entry.forms[k])
    .filter((v) => v && v !== entry.lemma)
    .join(", ");
}

export function VocabList({
  vocabulary,
  course,
}: {
  vocabulary: VocabEntry[];
  course: Course;
}) {
  if (vocabulary.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        Vocabulary
      </h2>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {vocabulary.map((entry) => {
          const forms = citation(entry, course);
          return (
            <div key={entry.lemma} className="text-sm">
              <dt className="target text-base">
                {entry.lemma}
                {hasTelugu(entry.lemma) && (
                  <span className="ml-2 text-sm not-italic text-ink-faint">
                    {transliterateTelugu(entry.lemma)}
                  </span>
                )}
              </dt>
              <dd className="text-ink-soft">
                {entry.gloss}
                <span className="text-ink-faint"> · {entry.pos}</span>
              </dd>
              {forms && (
                <dd className="target text-xs not-italic text-ink-faint">{forms}</dd>
              )}
              {entry.notes && (
                <dd className="mt-1 text-xs text-ink-faint">{entry.notes}</dd>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
