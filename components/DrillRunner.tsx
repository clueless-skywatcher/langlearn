"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  atomicQuestions,
  type AtomicQuestion,
  type Drill,
  type Section,
} from "@/content/schema";
import {
  gradeDrillSet,
  gradeQuestion,
  weakestSections,
  type DrillSetResult,
  type Response,
  type Verdict,
} from "@/lib/scoring";
import { progressStore, type SittingInput } from "@/lib/progress";
import { inline } from "@/lib/markdown";
import { hasTelugu, transliterateTelugu } from "@/lib/translit";

const LETTERS = ["A", "B", "C", "D"];

const VERDICT_STYLE: Record<Verdict, string> = {
  correct: "bg-correct-soft text-correct",
  partial: "bg-partial-soft text-partial",
  incorrect: "bg-wrong-soft text-wrong",
  skipped: "bg-rule/40 text-ink-faint",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: "Correct",
  partial: "Partial credit",
  incorrect: "Incorrect",
  skipped: "Unattempted",
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function marks(n: number): string {
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
}

/* -------------------------------------------------------------- one question */

function QuestionBody({
  question,
  response,
  onRespond,
  locked,
  showAnswer,
}: {
  question: AtomicQuestion;
  response: Response | undefined;
  onRespond: (r: Response) => void;
  locked: boolean;
  showAnswer: boolean;
}) {
  if (question.type === "integer") {
    const value = response?.kind === "integer" ? String(response.value) : "";
    return (
      <div className="mt-3 flex items-center gap-3">
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          disabled={locked}
          value={value}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onRespond({ kind: "skipped" });
            const n = Number.parseInt(raw, 10);
            if (Number.isFinite(n)) onRespond({ kind: "integer", value: n });
          }}
          className="w-32 rounded border border-rule bg-raised px-3 py-2 text-lg disabled:opacity-70"
          aria-label="Your answer"
        />
        {question.unit && (
          <span className="text-sm text-ink-faint">{question.unit}</span>
        )}
        {showAnswer && (
          <span className="text-sm text-ink-soft">
            Answer: <strong className="text-correct">{question.answer}</strong>
          </span>
        )}
      </div>
    );
  }

  const selected = new Set(
    response?.kind === "options" ? response.selected : [],
  );
  const correct = new Set(
    question.type === "single" ? [question.correct] : question.correct,
  );

  const toggle = (i: number) => {
    if (locked) return;
    if (question.type === "single") {
      onRespond({ kind: "options", selected: selected.has(i) ? [] : [i] });
      return;
    }
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    onRespond({ kind: "options", selected: [...next].sort((a, b) => a - b) });
  };

  return (
    <ul className="mt-3 space-y-2">
      {question.options.map((option, i) => {
        const isSelected = selected.has(i);
        const isCorrect = correct.has(i);

        let tone = "border-rule bg-raised hover:border-accent";
        if (showAnswer && isCorrect) {
          tone = "border-correct bg-correct-soft";
        } else if (showAnswer && isSelected) {
          tone = "border-wrong bg-wrong-soft";
        } else if (isSelected) {
          tone = "border-accent bg-accent-soft";
        }

        return (
          <li key={i}>
            <button
              type="button"
              disabled={locked}
              aria-pressed={isSelected}
              onClick={() => toggle(i)}
              className={`flex w-full items-baseline gap-3 rounded border px-3 py-2 text-left transition-colors disabled:cursor-default ${tone}`}
            >
              <span
                className={`text-xs font-semibold ${
                  isSelected ? "text-accent" : "text-ink-faint"
                }`}
              >
                {LETTERS[i]}
              </span>
              <span className="flex-1">{inline(option)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function QuestionCard({
  question,
  index,
  response,
  onRespond,
  locked,
  showAnswer,
}: {
  question: AtomicQuestion;
  index: number;
  response: Response | undefined;
  onRespond: (r: Response) => void;
  locked: boolean;
  showAnswer: boolean;
}) {
  const graded = showAnswer
    ? gradeQuestion(question, response ?? { kind: "skipped" })
    : null;

  return (
    <div className="border-t border-rule pt-5 first:border-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs uppercase tracking-wide text-ink-faint">
          Q{index} · {TYPE_LABEL[question.type]} · {question.difficulty}
        </p>
        {graded && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[graded.verdict]}`}
          >
            {VERDICT_LABEL[graded.verdict]} {marks(graded.score)}
          </span>
        )}
      </div>

      <p className="mt-2 leading-relaxed">{inline(question.stem)}</p>

      <QuestionBody
        question={question}
        response={response}
        onRespond={onRespond}
        locked={locked}
        showAnswer={showAnswer}
      />

      {showAnswer && (
        <p className="mt-3 rounded bg-accent-soft/60 px-3 py-2 text-sm text-ink-soft">
          {inline(question.explanation)}
        </p>
      )}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  single: "one option correct",
  multi: "one or more correct",
  integer: "integer answer",
};

/* ------------------------------------------------------------------ passage */

function Passage({ drill }: { drill: Extract<Drill, { type: "comprehension" }> }) {
  const glossary = Object.entries(drill.glossary);
  return (
    <div className="mb-6 rounded border border-rule bg-raised p-4">
      <p className="mb-2 text-xs uppercase tracking-wide text-ink-faint">
        Comprehension · {drill.title}
      </p>
      <p className="target text-lg leading-loose not-italic">{drill.passage}</p>
      {(drill.romanization ?? (hasTelugu(drill.passage) ? transliterateTelugu(drill.passage) : "")) && (
        <p className="mt-2 text-sm leading-relaxed text-ink-faint">
          {drill.romanization ?? transliterateTelugu(drill.passage)}
        </p>
      )}
      {glossary.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-rule pt-3 text-xs text-ink-faint">
          {glossary.map(([word, gloss]) => (
            <div key={word} className="flex gap-1.5">
              <dt className="target not-italic">
                {word}
                {hasTelugu(word) && ` (${transliterateTelugu(word)})`}
              </dt>
              <dd>— {gloss}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- runner */

export function DrillRunner({
  section,
  courseId,
  sectionTitles,
}: {
  section: Section;
  courseId: string;
  /** Titles of the sections a checkpoint covers, for the breakdown. */
  sectionTitles: Record<string, string>;
}) {
  const examMode = section.kind === "checkpoint";
  const drills = section.drills;
  const total = useMemo(() => atomicQuestions(drills).length, [drills]);

  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState<Record<string, Response>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<DrillSetResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const drill = drills[step];
  const questions: AtomicQuestion[] =
    drill?.type === "comprehension" ? drill.questions : drill ? [drill] : [];

  const answeredSoFar = drills
    .slice(0, step)
    .reduce(
      (n, d) => n + (d.type === "comprehension" ? d.questions.length : 1),
      0,
    );

  const isChecked = checked.has(drill?.id ?? "");
  const allAnswered = questions.every((q) => {
    const r = responses[q.id];
    if (!r) return false;
    if (r.kind === "options") return r.selected.length > 0;
    return r.kind === "integer";
  });

  const respond = (id: string, r: Response) =>
    setResponses((prev) => ({ ...prev, [id]: r }));

  const lastStep = step === drills.length - 1;
  const firstStep = step === 0;

  useEffect(() => {
    if (result) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStep((s) => Math.max(0, s - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setStep((s) => Math.min(drills.length - 1, s + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, drills.length]);

  async function submit() {
    setSaving(true);
    setSaveError(null);
    // Grade locally first, so the summary appears even if the server or the
    // store is unreachable. The server's marking replaces it a moment later.
    setResult(gradeDrillSet(section, responses));
    try {
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, sectionId: section.id, responses }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const body = (await res.json()) as {
        sitting: SittingInput;
        result: DrillSetResult;
      };
      setResult(body.result);

      // With the SQLite store the server has already written the sitting and
      // this is a no-op; with the browser store this is where it is kept.
      await progressStore().record(body.sitting);
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "could not save this attempt",
      );
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Summary
        section={section}
        courseId={courseId}
        result={result}
        responses={responses}
        sectionTitles={sectionTitles}
        saveError={saveError}
        onRetake={() => {
          setResponses({});
          setChecked(new Set());
          setResult(null);
          setStep(0);
        }}
      />
    );
  }

  const goPrev = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => setStep((s) => Math.min(drills.length - 1, s + 1));

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-4 text-xs text-ink-faint">
        <span>
          Question {answeredSoFar + 1}
          {questions.length > 1 ? `–${answeredSoFar + questions.length}` : ""} of{" "}
          {total}
        </span>
        <span>
          {examMode
            ? "Examination — answers are shown at the end"
            : "Practice — check each answer as you go"}
        </span>
      </div>

      <div
        className="mb-6 h-0.5 w-full bg-rule"
        role="progressbar"
        aria-valuenow={answeredSoFar}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${(answeredSoFar / total) * 100}%` }}
        />
      </div>

      {drill.type === "comprehension" && <Passage drill={drill} />}

      <div className="space-y-6">
        {questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            index={answeredSoFar + i + 1}
            response={responses[q.id]}
            onRespond={(r) => respond(q.id, r)}
            locked={isChecked}
            showAnswer={isChecked}
          />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-rule pt-5">
        <button
          type="button"
          disabled={firstStep}
          onClick={goPrev}
          className="rounded border border-rule px-4 py-2 text-sm hover:border-accent disabled:opacity-40"
        >
          Previous
        </button>

        {!examMode && !isChecked && (
          <button
            type="button"
            disabled={!allAnswered}
            onClick={() =>
              setChecked((prev) => new Set(prev).add(drill.id))
            }
            className="rounded border border-rule px-4 py-2 text-sm hover:border-accent disabled:opacity-40"
          >
            Check
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          {lastStep ? (
            <button
              type="button"
              disabled={saving}
              onClick={submit}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-40"
            >
              {saving ? "Marking…" : "Finish and mark"}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-paper"
            >
              Next
            </button>
          )}
        </div>

        {examMode && !lastStep && !allAnswered && (
          <span className="w-full text-xs text-ink-faint">
            You may leave a question unanswered.
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ summary */

function Summary({
  section,
  courseId,
  result,
  responses,
  sectionTitles,
  saveError,
  onRetake,
}: {
  section: Section;
  courseId: string;
  result: DrillSetResult;
  responses: Record<string, Response>;
  sectionTitles: Record<string, string>;
  saveError: string | null;
  onRetake: () => void;
}) {
  const questions = atomicQuestions(section.drills);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const weak = weakestSections(result, result.passThreshold ?? 60);

  return (
    <div>
      <div className="rounded border border-rule bg-raised p-5">
        <p className="text-xs uppercase tracking-wide text-ink-faint">
          {section.kind === "checkpoint" ? "Checkpoint result" : "Drill result"}
        </p>
        <p className="mt-1 text-3xl font-semibold tracking-tight">
          {fmt(result.score)}{" "}
          <span className="text-lg font-normal text-ink-faint">
            / {fmt(result.max)} marks
          </span>
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {result.percent.toFixed(0)}% · {result.counts.correct} correct,{" "}
          {result.counts.partial} partial, {result.counts.incorrect} incorrect,{" "}
          {result.counts.skipped} unattempted
        </p>

        {result.passed !== undefined && (
          <p
            className={`mt-4 inline-block rounded px-3 py-1 text-sm font-medium ${
              result.passed
                ? "bg-correct-soft text-correct"
                : "bg-wrong-soft text-wrong"
            }`}
          >
            {result.passed ? "Passed" : "Not passed"} — threshold{" "}
            {result.passThreshold}%
          </p>
        )}

        {saveError && (
          <p className="mt-4 text-sm text-wrong">
            Marked, but not saved: {saveError}
          </p>
        )}
      </div>

      {result.breakdown.length > 1 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            By section
          </h2>
          <ul className="space-y-2">
            {result.breakdown.map((b) => (
              <li
                key={b.sectionId}
                className="flex items-baseline justify-between gap-4 rounded border border-rule bg-raised px-3 py-2 text-sm"
              >
                <span>
                  <Link
                    href={`/${courseId}/learn/${b.sectionId}`}
                    className="hover:text-accent"
                  >
                    {sectionTitles[b.sectionId] ?? b.sectionId}
                  </Link>
                </span>
                <span className="whitespace-nowrap text-ink-soft">
                  {fmt(b.score)}/{fmt(b.max)} · {b.percent.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>

          {weak.length > 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              Weakest first:{" "}
              {weak.map((b, i) => (
                <span key={b.sectionId}>
                  {i > 0 && ", "}
                  <Link
                    href={`/${courseId}/learn/${b.sectionId}`}
                    className="text-accent hover:underline"
                  >
                    {sectionTitles[b.sectionId] ?? b.sectionId}
                  </Link>
                </span>
              ))}
              . Revisit these before going on.
            </p>
          )}
        </section>
      )}

      <section className="mt-10 space-y-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Answers
        </h2>
        {result.results.map((r, i) => {
          const q = byId.get(r.questionId);
          if (!q) return null;
          return (
            <QuestionCard
              key={r.questionId}
              question={q}
              index={i + 1}
              response={responses[r.questionId]}
              onRespond={() => {}}
              locked
              showAnswer
            />
          );
        })}
      </section>

      <div className="mt-10 flex gap-3 border-t border-rule pt-5">
        <button
          type="button"
          onClick={onRetake}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-paper"
        >
          Retake
        </button>
        <Link
          href={`/${courseId}`}
          className="rounded border border-rule px-4 py-2 text-sm hover:border-accent"
        >
          Back to the path
        </Link>
      </div>
    </div>
  );
}
