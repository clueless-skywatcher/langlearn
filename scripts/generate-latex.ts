#!/usr/bin/env -S npx tsx
/**
 * Renders a course pack as a LaTeX book: one chapter per section, the rules of
 * a lesson as continuously numbered paragraphs, and the section's drills after
 * them as a question paper grouped by examination format.
 *
 * The question layout follows the JEE-style paper the format is modelled on —
 * a numbered question, four options lettered (A)–(D) under it, one heading per
 * format naming what the learner has to do. Answers and the explanation each
 * drill carries are collected in an appendix rather than printed beside the
 * question, so that the drill pages can be worked through as a paper.
 *
 * `difficulty` is never emitted, and drills keep their authored order within a
 * format group: it is authoring metadata and a ramp is a tell (CLAUDE.md §5).
 *
 * Output is deterministic — no dates, no counts of the run — so that a
 * regenerated book diffs against the last one.
 *
 * Usage: yarn generate:latex [courseId] [--out <file>]
 * Build:  pdflatex <file>  (twice, for the contents)
 *     or: tectonic -X compile <file>
 */
import fs from "node:fs";
import path from "node:path";

import { getCourse, listCourseIds } from "../content/loader";
import {
  isExam,
  isLesson,
  type AtomicQuestion,
  type ComprehensionDrill,
  type Course,
  type Drill,
  type Example,
  type LessonSection,
  type MatchingQuestion,
  type Paradigm,
  type ScriptSection,
  type Section,
  type Source,
  type VocabEntry,
} from "../content/schema";

/* ------------------------------------------------------------ text to LaTeX */

/**
 * Non-ASCII characters the preamble knows how to set. A course that grows a
 * character outside this set stops the build rather than emitting a `.tex`
 * that either drops the glyph or fails deep inside a run of tables.
 */
const KNOWN_UNICODE = new Set(
  "§¶ÄÖÜßäçéóöøüŋœɔɛɪʃʊʏː–—‘’“„…→∅⟨⟩",
);

/** Characters the preamble maps through tipa (pdfTeX) or a fallback font. */
const IPA: Record<string, { tipa: string; hex: string }> = {
  "ŋ": { tipa: "N", hex: "014B" },
  "ɔ": { tipa: "O", hex: "0254" },
  "ɛ": { tipa: "E", hex: "025B" },
  "ɪ": { tipa: "I", hex: "026A" },
  "ʃ": { tipa: "S", hex: "0283" },
  "ʊ": { tipa: "U", hex: "028A" },
  "ʏ": { tipa: "Y", hex: "028F" },
  "ː": { tipa: ":", hex: "02D0" },
};

/** Characters that are set as mathematics whatever the engine. */
const MATHS: Record<string, string> = {
  "→": String.raw`\rightarrow`,
  "∅": String.raw`\varnothing`,
  "⟨": String.raw`\langle`,
  "⟩": String.raw`\rangle`,
};

const ESCAPES: Record<string, string> = {
  "\\": String.raw`\textbackslash{}`,
  "{": String.raw`\{`,
  "}": String.raw`\}`,
  "$": String.raw`\$`,
  "&": String.raw`\&`,
  "#": String.raw`\#`,
  "%": String.raw`\%`,
  "_": String.raw`\_`,
  "~": String.raw`\textasciitilde{}`,
  "^": String.raw`\textasciicircum{}`,
};

const warnings: string[] = [];
/** Rule numbers that carry a label, so that `¶78` can be made a link. */
const ruleNumbers = new Set<string>();

function checkUnicode(text: string, where: string): void {
  for (const ch of text) {
    if (ch.codePointAt(0)! < 128 || KNOWN_UNICODE.has(ch)) continue;
    throw new Error(
      `${where}: no LaTeX mapping for ${JSON.stringify(ch)} (U+${ch
        .codePointAt(0)!
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")}) in ${JSON.stringify(text.slice(0, 60))} — ` +
        `add it to KNOWN_UNICODE and to the preamble in scripts/generate-latex.ts`,
    );
  }
}

/**
 * One string of course markdown as LaTeX. The content dialect is `**bold**`,
 * `*italic*` and `` `code` `` (see `lib/markdown.tsx`) and nothing else; runs
 * of underscores are the gap of a fill-in-the-blank stem.
 */
function tex(raw: string, where = "content"): string {
  checkUnicode(raw, where);
  const GAP = "\u0000gap\u0000";
  let s = raw.replace(/_{2,}/g, GAP);
  s = s.replace(/[\\{}$&#%_~^]/g, (c) => ESCAPES[c]);
  // A bracket at the head of an \item argument would be read as an optional
  // argument; [aɪ] is a phonetic transcription and stays where it is written.
  s = s.replace(/\[/g, "{[}").replace(/\]/g, "{]}");
  s = s.replace(/\*\*([^*]+)\*\*/g, String.raw`\textbf{$1}`);
  s = s.replace(/\*([^*]+)\*/g, String.raw`\emph{$1}`);
  s = s.replace(/`([^`]+)`/g, String.raw`\texttt{$1}`);
  if (s.includes("*")) warnings.push(`${where}: unpaired * in ${JSON.stringify(raw)}`);
  s = s.replace(/¶(\d+[a-z]?)/g, (m, n: string) =>
    ruleNumbers.has(n) ? String.raw`\rref{${n}}` : m,
  );
  return s.split(GAP).join(String.raw`\gap{}`);
}

/**
 * Question-facing text: a stem, an option, a matching column, an integer's
 * unit. CLAUDE.md §2 keeps this course's own numbering out of all four — a ¶
 * number is answerable from the contents page and unanswerable from the
 * German — so a reference that reaches one is dropped here and reported.
 */
function texQ(raw: string, where: string): string {
  const stripped = raw
    .replace(/\s*\((?:see\s+)?¶\s*\d+[a-z]?(?:\s*(?:,|and)\s*¶?\s*\d+[a-z]?)*\)/g, "")
    .replace(/¶\s*\d+[a-z]?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (stripped !== raw.trim()) {
    warnings.push(
      `${where}: a ¶ reference was dropped from question-facing text — ` +
        `CLAUDE.md §2 keeps the course's own numbering out of stems, options, ` +
        `columns and units`,
    );
  }
  return tex(stripped, where);
}

/** A speaker's name opening a line of dialogue: `ANNA.` or `HERR BECKER.` */
const SPEAKER = /^([A-ZÄÖÜ]+(?: [A-ZÄÖÜ]+)*)[.:]\s+(.+)$/;

/**
 * Line breaks kept, as the app keeps them in a passage or a dialogue. A turn
 * of dialogue is set as the speaker in bold, then a colon, whatever
 * punctuation the content used to mark the name off.
 */
function texLines(raw: string, where: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const turn = SPEAKER.exec(line);
      return turn
        ? `\\textbf{${tex(turn[1], where)}}: ${tex(turn[2], where)}`
        : tex(line, where);
    })
    .join(String.raw`\\` + "\n");
}

/* -------------------------------------------------------------- the preamble */

function preamble(course: Course): string {
  const ipaPdf = Object.entries(IPA)
    .map(([ch, m]) => `  \\newunicodechar{${ch}}{\\textipa{${m.tipa}}}`)
    .join("\n");
  const ipaUni = Object.entries(IPA)
    .map(([ch, m]) => `  \\newunicodechar{${ch}}{{\\ipafont\\char"${m.hex}}}`)
    .join("\n");
  const maths = Object.entries(MATHS)
    .map(([ch, m]) => `\\newunicodechar{${ch}}{\\ensuremath{${m}}}`)
    .join("\n");

  return `% !TeX program = pdflatex
% Generated by scripts/generate-latex.ts from content/${course.id}.
% Do not edit by hand: regenerate with \`yarn generate:latex ${course.id}\`.
%
% pdflatex sets the phonetic characters through tipa; xelatex and lualatex take
% them from a fallback font instead, so either engine builds the book.
\\documentclass[12pt,a4paper,twoside,openright]{book}

\\usepackage{iftex}
\\ifPDFTeX
  \\usepackage[utf8]{inputenc}
  \\usepackage[T3,T1]{fontenc}
  \\usepackage{lmodern}
  \\usepackage{tipa}
\\else
  \\usepackage{fontspec}
  \\defaultfontfeatures{Ligatures=TeX}
  \\setmainfont{lmroman10-regular.otf}[
    ItalicFont     = lmroman10-italic.otf,
    BoldFont       = lmroman10-bold.otf,
    BoldItalicFont = lmroman10-bolditalic.otf]
  \\setsansfont{lmsans10-regular.otf}[
    ItalicFont = lmsans10-oblique.otf,
    BoldFont   = lmsans10-bold.otf]
  \\setmonofont{lmmono10-regular.otf}[Scale=MatchLowercase]
  \\newfontfamily\\ipafont{DejaVuSerif.ttf}[Scale=MatchLowercase]
\\fi

\\usepackage{amssymb}
\\usepackage{newunicodechar}
\\usepackage[a4paper,inner=27mm,outer=22mm,top=25mm,bottom=27mm]{geometry}
\\usepackage{enumitem}
\\usepackage{array}
\\usepackage{booktabs}
\\usepackage{tabularx}
\\usepackage{ragged2e}
\\usepackage{longtable}
\\usepackage{multicol}
\\usepackage{fancyhdr}
\\usepackage{xurl}
\\usepackage{microtype}
\\usepackage[hidelinks]{hyperref}

% ---------------------------------------------------- characters beyond ASCII
${maths}
\\ifPDFTeX
${ipaPdf}
\\else
${ipaUni}
\\fi

% --------------------------------------------------------------------- layout
\\setcounter{tocdepth}{1}
\\setcounter{secnumdepth}{2}
\\setlength{\\parindent}{1.2em}
\\raggedbottom
% German compounds have no hyphenation patterns loaded against them, so a line
% is allowed to stretch rather than to overflow.
\\setlength{\\emergencystretch}{2em}

% A verso left blank by \\cleardoublepage is blank: no rule, no page number.
\\makeatletter
\\def\\cleardoublepage{\\clearpage\\if@twoside\\ifodd\\c@page\\else
  \\hbox{}\\thispagestyle{empty}\\newpage\\fi\\fi}
\\makeatother

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[RE]{\\small\\itshape\\nouppercase\\leftmark}
\\fancyhead[LO]{\\small\\itshape\\nouppercase\\rightmark}
\\fancyfoot[C]{\\small Page \\thepage}
\\renewcommand{\\headrulewidth}{0.4pt}
\\fancypagestyle{plain}{%
  \\fancyhf{}\\fancyfoot[C]{\\small Page \\thepage}%
  \\renewcommand{\\headrulewidth}{0pt}}

% ------------------------------------------------------------- grammar rules
% A rule is a numbered paragraph, in the manner of the grammar the course
% follows: the number, the heading, then the statement run on from it.
\\newcommand{\\rref}[1]{\\hyperref[rule:#1]{\\P#1}}
\\newcommand{\\gap}{\\rule[-0.45ex]{1.8em}{0.4pt}}
\\newcommand{\\rulehead}[2]{%
  \\par\\addvspace{1.5ex}\\phantomsection\\label{rule:#1}%
  \\noindent\\textbf{\\P#1.\\enspace #2.}\\enspace\\ignorespaces}
\\newenvironment{examples}
  {\\par\\addvspace{0.5ex}\\begin{list}{}{%
     \\setlength{\\leftmargin}{1.6em}\\setlength{\\labelwidth}{0pt}%
     \\setlength{\\labelsep}{0pt}\\setlength{\\itemindent}{0pt}%
     \\setlength{\\listparindent}{0pt}\\setlength{\\itemsep}{0.2ex}%
     \\setlength{\\parsep}{0pt}\\setlength{\\topsep}{0pt}}}
  {\\end{list}\\addvspace{0.5ex}}
\\newcommand{\\ex}[2]{\\item \\emph{#1} --- #2}
\\newcommand{\\exn}[3]{\\item \\emph{#1} --- #2 {\\small (#3)}}
\\newcommand{\\rulenote}[1]{\\par\\addvspace{0.5ex}{\\small #1\\par}\\addvspace{0.3ex}}
\\newenvironment{paradigm}[1]
  {\\par\\addvspace{1.3ex}\\begin{center}\\small\\textsc{#1}\\par\\addvspace{0.6ex}}
  {\\end{center}\\addvspace{0.4ex}}

% -------------------------------------------------------------------- drills
\\newlist{questions}{enumerate}{1}
\\setlist[questions]{label=\\arabic*., ref=\\arabic*, align=left,
  leftmargin=2.2em, labelsep=0.6em, itemsep=1.25ex, topsep=1ex, parsep=0.4ex}
\\newlist{choices}{enumerate}{1}
\\setlist[choices]{label=(\\Alph*), align=left,
  leftmargin=2.4em, labelsep=0.5em, itemsep=0.25ex, topsep=0.6ex,
  parsep=0pt, partopsep=0pt}
\\setlength{\\columnsep}{20pt}
\\raggedcolumns
% A stem never ends a column with its options at the head of the next.
\\makeatletter
\\@beginparpenalty=9999
\\makeatother
\\newcommand{\\pto}{\\,\\ensuremath{\\rightarrow}\\,}
\\newcommand{\\unit}[1]{\\enspace{\\small{[}\\emph{#1}{]}}}
\\newenvironment{passage}
  {\\par\\addvspace{1ex}\\begin{list}{}{%
     \\setlength{\\leftmargin}{0.8em}\\setlength{\\rightmargin}{0pt}%
     \\setlength{\\listparindent}{0pt}\\setlength{\\parsep}{0.4ex}}\\item[]}
  {\\end{list}\\addvspace{0.6ex}}
% A comprehension child says its format only where the format is not the
% default one of a single correct option.
\\newcommand{\\qtype}[1]{{\\small\\itshape[#1]}\\enspace\\ignorespaces}
\\newcommand{\\glosses}[1]{\\par\\addvspace{0.4ex}{\\small #1\\par}}

% ------------------------------------------------------------------- answers
% An answer repeats its question so that the appendix can be read on its own:
% the number and the stem, then the options as the paper set them, then the
% answer, then the explanation on a line of its own.
\\newenvironment{answerentry}[2]
  {\\par\\addvspace{1.3ex}\\noindent\\textbf{#1.}\\enspace #2%
   \\begin{list}{}{%
     \\setlength{\\leftmargin}{1.8em}\\setlength{\\rightmargin}{0pt}%
     \\setlength{\\topsep}{0.4ex}\\setlength{\\parsep}{0.35ex}%
     \\setlength{\\itemsep}{0pt}\\setlength{\\listparindent}{0pt}}\\item[]}
  {\\end{list}}
\\newcommand{\\ansline}[1]{\\par\\addvspace{0.35ex}\\textbf{Answer:}\\enspace #1\\par}

% ------------------------------------------------------------------- sources
\\newlist{sourcelist}{itemize}{1}
\\setlist[sourcelist]{label=\\textendash, leftmargin=1.4em, labelsep=0.5em,
  itemsep=0.5ex, topsep=0.6ex, parsep=0pt}
\\newlist{loci}{itemize}{1}
\\setlist[loci]{label=\\textperiodcentered, leftmargin=1.2em, labelsep=0.4em,
  itemsep=0.1ex, topsep=0.3ex, parsep=0pt}
`;
}

/* ------------------------------------------------------------------- pieces */

function chapterTitle(section: Section): string {
  return tex(section.title, section.id);
}

function scriptBlock(script: ScriptSection, where: string): string {
  const out: string[] = [];
  out.push(`\\section{${tex(script.heading, where)}}`);

  const hasUpper = script.letters.some((l) => l.upper);
  const hasName = script.letters.some((l) => l.name);
  const hasIpa = script.letters.some((l) => l.ipa);
  const hasApprox = script.letters.some((l) => l.approx);
  const headers = ["Letter"];
  const spec = ["c"];
  if (hasUpper) { headers.push("Capital"); spec.push("c"); }
  if (hasName) { headers.push("Name"); spec.push("l"); }
  if (hasIpa) { headers.push("Sound"); spec.push("l"); }
  if (hasApprox) { headers.push("Nearest English"); spec.push(">{\\RaggedRight}X"); }

  out.push("\\begin{center}\\small");
  out.push(`\\begin{tabularx}{\\linewidth}{@{}${spec.join(" ")}@{}}`);
  out.push("\\toprule");
  out.push(`${headers.join(" & ")} \\\\`);
  out.push("\\midrule");
  for (const letter of script.letters) {
    const cells = [`\\textbf{${tex(letter.glyph, where)}}`];
    if (hasUpper) cells.push(letter.upper ? `\\textbf{${tex(letter.upper, where)}}` : "");
    if (hasName) cells.push(letter.name ? tex(letter.name, where) : "");
    if (hasIpa) cells.push(letter.ipa ? `{[}${tex(letter.ipa, where)}{]}` : "");
    if (hasApprox) cells.push(letter.approx ? tex(letter.approx, where) : "");
    out.push(`${cells.join(" & ")} \\\\`);
  }
  out.push("\\bottomrule");
  out.push("\\end{tabularx}");
  out.push("\\end{center}");

  for (const letter of script.letters) {
    if (letter.notes) {
      out.push(
        `\\rulenote{\\textbf{${tex(letter.glyph, where)}} --- ${tex(letter.notes, where)}}`,
      );
    }
  }
  for (const note of script.notes) out.push("", tex(note, where));
  return out.join("\n");
}

function examplesBlock(examples: Example[], where: string): string {
  if (examples.length === 0) return "";
  const items = examples.map((e) => {
    const target = e.roman
      ? `${tex(e.target, where)} (${tex(e.roman, where)})`
      : tex(e.target, where);
    return e.note
      ? `\\exn{${target}}{${tex(e.gloss, where)}}{${tex(e.note, where)}}`
      : `\\ex{${target}}{${tex(e.gloss, where)}}`;
  });
  return ["\\begin{examples}", ...items, "\\end{examples}"].join("\n");
}

/** Wide cells get a paragraph column, so that a table of glosses still fits. */
function columnSpec(rows: string[][], columns: number): string {
  const spec: string[] = [];
  for (let c = 0; c < columns; c += 1) {
    const widest = Math.max(0, ...rows.map((r) => (r[c] ?? "").length));
    spec.push(widest > 34 ? ">{\\RaggedRight}X" : "l");
  }
  return spec.join(" ");
}

function paradigmBlock(paradigm: Paradigm, where: string): string {
  const raw = paradigm.rows.map((r) => [r.label, ...r.cells]);
  // A paradigm either names the column its row labels stand in — "Gender,
  // Article, Example" over "masculine, der, *der Tisch*" — or heads the cells
  // alone and leaves the labels an unnamed stub, as a declension table does.
  const cells = Math.max(...raw.map((row) => row.length - 1));
  const headers =
    paradigm.columns.length > cells ? paradigm.columns : ["", ...paradigm.columns];
  const width = Math.max(headers.length, cells + 1);
  for (const row of raw) while (row.length < width) row.push("");
  while (headers.length < width) headers.push("");
  const spec = columnSpec(raw, width);
  const out = [
    `\\begin{paradigm}{${tex(paradigm.caption, where)}}`,
    spec.includes("X")
      ? `\\begin{tabularx}{\\linewidth}{@{}${spec}@{}}`
      : `\\begin{tabular}{@{}${spec}@{}}`,
    "\\toprule",
    `${headers.map((c) => (c ? `\\textit{${tex(c, where)}}` : "")).join(" & ")} \\\\`,
    "\\midrule",
    ...raw.map((row) => `${row.map((cell) => tex(cell, where)).join(" & ")} \\\\`),
    "\\bottomrule",
    spec.includes("X") ? "\\end{tabularx}" : "\\end{tabular}",
    "\\end{paradigm}",
  ];
  if (paradigm.footnote) out.push(`\\rulenote{${tex(paradigm.footnote, where)}}`);
  return out.join("\n");
}

function rulesBlock(section: LessonSection): string {
  const out: string[] = ["\\section{Grammar}"];
  for (const rule of section.rules) {
    const where = `${section.id}/${rule.id}`;
    let statement = tex(rule.statement, where);
    rule.footnotes.forEach((note, i) => {
      statement += `${i > 0 ? "\\textsuperscript{,}" : ""}\\footnote{${tex(note, where)}}`;
    });
    if (rule.seeAlso.length > 0) {
      const refs = rule.seeAlso
        .map((id) => ruleNumberById.get(id))
        .filter((n): n is string => n !== undefined)
        .map((n) => `\\rref{${n}}`);
      if (refs.length > 0) statement += ` (see ${refs.join(", ")})`;
    }
    out.push(`\\rulehead{${rule.number}}{${tex(rule.heading, where)}}${statement}`);
    const examples = examplesBlock(rule.examples, where);
    if (examples) out.push(examples);
    for (const paradigm of rule.paradigms) out.push(paradigmBlock(paradigm, where));
    out.push("");
  }
  return out.join("\n");
}

/* --------------------------------------------------------------- vocabulary */

const POS_ORDER = ["noun", "verb", "adjective", "pronoun", "adverb", "preposition", "particle"];

function posHeading(pos: string, count: number): string {
  const word = count === 1 || pos.endsWith("s") ? pos : `${pos}s`;
  return `\\subsection*{${tex(word[0].toUpperCase() + word.slice(1))}}`;
}

function vocabularyBlock(section: LessonSection, course: Course): string {
  if (section.vocabulary.length === 0) return "";
  const groups = new Map<string, VocabEntry[]>();
  for (const entry of section.vocabulary) {
    const list = groups.get(entry.pos) ?? [];
    list.push(entry);
    groups.set(entry.pos, list);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const ia = POS_ORDER.indexOf(a);
    const ib = POS_ORDER.indexOf(b);
    return (ia < 0 ? POS_ORDER.length : ia) - (ib < 0 ? POS_ORDER.length : ib);
  });

  const out: string[] = ["\\section{Vocabulary}"];
  for (const pos of order) {
    const entries = groups.get(pos)!;
    const where = `${section.id}/vocab/${pos}`;
    const declared = course.formLabels[pos] ?? [];
    const extra = [
      ...new Set(entries.flatMap((e) => Object.keys(e.forms))),
    ].filter((k) => !declared.some((d) => d.key === k));
    const keys = [...declared.map((d) => d.key), ...extra];
    const labels = [
      ...declared.map((d) => d.label),
      ...extra,
    ];
    // The citation form usually carries the lemma — *der Tag* for `Tag` — and a
    // column repeating it would say nothing. It is kept wherever some entry of
    // the group has no forms at all, which is the only place it is the word.
    const lemmaInForms =
      keys.length > 0 &&
      entries.every((e) => (e.forms[keys[0]] ?? "").includes(e.lemma));

    const headers = [...(lemmaInForms ? [] : ["word"]), ...labels, "meaning"];
    const rows = entries.map((e) => [
      ...(lemmaInForms ? [] : [`\\textbf{${tex(e.lemma, where)}}`]),
      ...keys.map((k, i) =>
        e.forms[k]
          ? i === 0 && lemmaInForms
            ? `\\textbf{${tex(e.forms[k], where)}}`
            : tex(e.forms[k], where)
          : "",
      ),
      tex(e.gloss, where),
    ]);

    out.push(posHeading(pos, entries.length));
    out.push("{\\footnotesize\\setlength{\\tabcolsep}{4pt}");
    const last = headers.length - 1;
    const spec = headers
      .map((_, i) => (i === last ? ">{\\RaggedRight}p{0.17\\linewidth}" : "l"))
      .join(" ");
    const head = [
      "\\toprule",
      `${headers.map((h) => `\\textit{${tex(h)}}`).join(" & ")} \\\\`,
      "\\midrule",
    ].join("\n");
    out.push(`\\begin{longtable}{@{}${spec}@{}}`);
    out.push(head, "\\endfirsthead", head, "\\endhead", "\\bottomrule", "\\endfoot", "\\bottomrule", "\\endlastfoot");
    out.push(...rows.map((r) => `${r.join(" & ")} \\\\`));
    out.push("\\end{longtable}");
    out.push("}");
    for (const entry of entries) {
      if (entry.notes) {
        out.push(
          `\\rulenote{\\textbf{${tex(entry.lemma, where)}} --- ${tex(entry.notes, where)}}`,
        );
      }
    }
  }
  return out.join("\n");
}

/* -------------------------------------------------------------------- drills */

const GROUPS = [
  {
    type: "single",
    heading: "Single-answer questions (choose the one correct option)",
  },
  {
    type: "multi",
    heading: "Multiple-answer questions (one or more options are correct)",
  },
  {
    type: "integer",
    heading: "Integer-answer questions (the answer is a non-negative integer)",
  },
  {
    type: "matching",
    heading: "Matching questions (one pairing of the two columns is correct)",
  },
  {
    type: "comprehension",
    heading: "Comprehension (read the passage and answer what follows)",
  },
] as const;

const COLUMN_I_LABELS = ["P", "Q", "R", "S"];

function choicesBlock(options: string[], where: string): string {
  return choicesRaw(options.map((o) => texQ(o, where)));
}

/** The same list, from cells that are already LaTeX. */
function choicesRaw(cells: string[]): string {
  return [
    "\\begin{choices}",
    ...cells.map((c) => `\\item ${c}`),
    "\\end{choices}",
  ].join("\n");
}

/** The format tag a comprehension child carries, where it carries one. */
function questionTag(type: AtomicQuestion["type"]): string {
  if (type === "multi") return "\\qtype{Multiple options correct}";
  if (type === "integer") return "\\qtype{Integer answer}";
  return "";
}

function matchingTable(q: MatchingQuestion, where: string): string {
  const row = (label: string, text: string) =>
    `(${label}) & ${texQ(text, where)} \\\\`;
  return [
    "\\begin{flushleft}\\small",
    "\\begin{tabular}{@{}r@{~}>{\\RaggedRight}p{\\dimexpr\\linewidth-2.6em\\relax}@{}}",
    `\\multicolumn{2}{@{}l}{\\textit{Column I} --- ${texQ(q.columnHeadings[0], where)}} \\\\[0.2ex]`,
    ...q.columnI.map((item, i) => row(COLUMN_I_LABELS[i], item)),
    "\\noalign{\\vspace{0.5ex}}",
    `\\multicolumn{2}{@{}l}{\\textit{Column II} --- ${texQ(q.columnHeadings[1], where)}} \\\\[0.2ex]`,
    ...q.columnII.map((item, i) => row(String(i + 1), item)),
    "\\end{tabular}",
    "\\end{flushleft}",
  ].join("\n");
}

function matchingChoices(q: MatchingQuestion): string {
  const pairings = q.options.map((option) =>
    option
      .map((label, i) => `${COLUMN_I_LABELS[i]}\\pto ${label + 1}`)
      .join(",\\quad "),
  );
  return [
    "\\begin{choices}",
    ...pairings.map((p) => `\\item ${p}`),
    "\\end{choices}",
  ].join("\n");
}

function passageBlock(drill: ComprehensionDrill, where: string): string {
  const out = [
    `\\subsubsection*{${tex(drill.title, where)}}`,
    "\\begin{passage}",
    texLines(drill.passage, where),
    "\\end{passage}",
  ];
  const glossary = Object.entries(drill.glossary);
  if (glossary.length > 0) {
    out.push(
      `\\glosses{${glossary
        .map(([word, gloss]) => `\\textbf{${tex(word, where)}} ${tex(gloss, where)}`)
        .join("; ")}.}`,
    );
  }
  return out.join("\n");
}

/**
 * One question, without its number: the list supplies that. `tag` marks the
 * format, and is set only on the children of a passage, where the group
 * heading is about the passage rather than about the format of each item.
 */
function questionItem(drill: AtomicQuestion, where: string, tag = ""): string {
  const stem = `\\item ${tag}${texQ(drill.stem, where)}`;
  switch (drill.type) {
    case "single":
    case "multi":
      return [stem, choicesBlock(drill.options, where)].join("\n");
    case "integer":
      return `${stem}${drill.unit ? `\\unit{${texQ(drill.unit, where)}}` : ""}`;
    case "matching":
      return [stem, matchingTable(drill, where), matchingChoices(drill)].join("\n");
  }
}

/**
 * The drills of one section, grouped by format, numbered continuously across
 * the groups so that a number names one question of the chapter.
 */
function drillsBlock(section: Section): { body: string; numbers: Map<string, number> } {
  const numbers = new Map<string, number>();
  let n = 0;
  // The whole paper is set in two columns, as an examination paper is —
  // reading passages included, so that a chapter's drills are one object on
  // the page rather than two settings alternating down it.
  const out: string[] = ["\\section{Drills}", "{\\small", "\\begin{multicols}{2}"];

  for (const group of GROUPS) {
    const drills = section.drills.filter((d) => d.type === group.type);
    if (drills.length === 0) continue;
    out.push(`\\subsection*{${group.heading}}`);

    if (group.type === "comprehension") {
      for (const drill of drills) {
        if (drill.type !== "comprehension") continue;
        const where = `${section.id}/${drill.id}`;
        out.push(passageBlock(drill, where));
        out.push(`\\begin{questions}[start=${n + 1}]`);
        for (const child of drill.questions) {
          n += 1;
          numbers.set(child.id, n);
          out.push(questionItem(child, `${where}/${child.id}`, questionTag(child.type)));
        }
        out.push("\\end{questions}");
      }
      continue;
    }

    out.push(`\\begin{questions}[start=${n + 1}]`);
    for (const drill of drills) {
      if (drill.type === "comprehension") continue;
      n += 1;
      numbers.set(drill.id, n);
      out.push(questionItem(drill, `${section.id}/${drill.id}`));
    }
    out.push("\\end{questions}");
  }
  out.push("\\end{multicols}");
  out.push("}");
  return { body: out.join("\n"), numbers };
}

/* -------------------------------------------------------------------- sources */

/**
 * One work, and under it the places it is cited for. A chapter can lean on the
 * same grammar twenty times over; run together in one parenthesis those loci
 * are unreadable, so each keeps its own line.
 */
function sourceLine(source: Source, notes: string[], where: string): string {
  const parts = [tex(source.citation, where)];
  if (source.url) parts.push(`\\url{${source.url}}`);
  if (source.licence) parts.push(tex(source.licence, where));
  const line = parts.join(" ");
  if (notes.length === 0) return line;
  return [
    line,
    "\\begin{loci}",
    ...notes.map((note) => `\\item ${tex(note, where)}`),
    "\\end{loci}",
  ].join("\n");
}

/** Everything the chapter rests on: the page's sources, its rules', its passages'. */
function sourcesBlock(section: Section): string {
  const seen = new Map<string, { source: Source; notes: string[] }>();
  const add = (source: Source) => {
    const key = `${source.citation}\u0000${source.url ?? ""}`;
    const entry = seen.get(key) ?? { source, notes: [] };
    if (source.note && !entry.notes.includes(source.note)) entry.notes.push(source.note);
    seen.set(key, entry);
  };
  for (const source of section.sources) add(source);
  if (isLesson(section)) {
    for (const rule of section.rules) for (const source of rule.sources) add(source);
  }
  for (const drill of section.drills) {
    if (drill.type === "comprehension") for (const source of drill.sources) add(source);
  }

  return [
    "\\section{Sources}",
    "{\\small",
    "\\begin{sourcelist}",
    ...[...seen.values()].map(
      (e) => `\\item ${sourceLine(e.source, e.notes, section.id)}`,
    ),
    "\\end{sourcelist}",
    "}",
  ].join("\n");
}

/* -------------------------------------------------------------------- answers */

/**
 * What the appendix prints for one question: the options as the paper set
 * them, the answer, and the explanation. The options are repeated so that the
 * appendix can be read without the chapter open beside it.
 */
function answerParts(
  drill: AtomicQuestion,
  where: string,
): { label: string; options: string[]; solution: string } {
  switch (drill.type) {
    case "single":
      return {
        label: `(${String.fromCharCode(65 + drill.correct)})\\quad ${texQ(drill.options[drill.correct], where)}`,
        options: drill.options.map((o) => texQ(o, where)),
        solution: tex(drill.explanation, where),
      };
    case "multi":
      return {
        label: [...drill.correct]
          .sort((a, b) => a - b)
          .map((i) => `(${String.fromCharCode(65 + i)})\\quad ${texQ(drill.options[i], where)}`)
          .join("; "),
        options: drill.options.map((o) => texQ(o, where)),
        solution: tex(drill.explanation, where),
      };
    case "integer":
      return {
        label: String(drill.answer),
        options: [],
        solution: tex(drill.explanation, where),
      };
    case "matching":
      return {
        label:
          `(${String.fromCharCode(65 + drill.correct)})\\quad ` +
          drill.options[drill.correct]
            .map((label, i) => `${COLUMN_I_LABELS[i]}\\pto ${label + 1}`)
            .join(", "),
        options: drill.options.map((option) =>
          option
            .map((label, i) => `${COLUMN_I_LABELS[i]}\\pto ${label + 1}`)
            .join(",\\quad "),
        ),
        solution: tex(drill.explanation, where),
      };
  }
}

/** One entry of the appendix: number, stem, options, answer, explanation. */
function answerEntry(drill: AtomicQuestion, n: number, where: string, tag = ""): string {
  const { label, options, solution } = answerParts(drill, where);
  const unit =
    drill.type === "integer" && drill.unit ? `\\unit{${texQ(drill.unit, where)}}` : "";
  const out = [`\\begin{answerentry}{${n}}{${tag}${texQ(drill.stem, where)}${unit}}`];
  if (options.length > 0) out.push(choicesRaw(options));
  out.push(`\\ansline{${label}}`);
  out.push(solution);
  out.push("\\end{answerentry}");
  return out.join("\n");
}

function answersBlock(section: Section, numbers: Map<string, number>): string {
  // Set as the paper is: the heading across the measure, the entries in two
  // columns under it.
  const out: string[] = [];
  for (const group of GROUPS) {
    for (const drill of section.drills.filter((d) => d.type === group.type)) {
      const where = `${section.id}/${drill.id}`;
      if (drill.type === "comprehension") {
        out.push(
          `\\rulenote{\\textbf{${tex(drill.title, where)}.}` +
            (drill.translation ? ` ${tex(drill.translation, where)}` : "") +
            "}",
        );
        for (const child of drill.questions) {
          out.push(
            answerEntry(
              child,
              numbers.get(child.id)!,
              `${where}/${child.id}`,
              questionTag(child.type),
            ),
          );
        }
        continue;
      }
      out.push(answerEntry(drill, numbers.get(drill.id)!, where));
    }
  }
  return [
    `\\section{${chapterTitle(section)}}`,
    "{\\small",
    "\\begin{multicols}{2}",
    ...out,
    "\\end{multicols}",
    "}",
  ].join("\n");
}

/* ------------------------------------------------------------------ the book */

const ruleNumberById = new Map<string, string>();

function frontMatter(course: Course): string {
  const levels = course.levels.join(", ");
  return `\\begin{document}
\\frontmatter

\\begin{titlepage}
\\centering
\\vspace*{4.5cm}
{\\Huge\\bfseries ${tex(course.name)}\\par}
\\vspace{1cm}
{\\Large ${tex(course.englishName)}\\par}
\\vspace{0.4cm}
{\\large Level ${tex(levels)}\\par}
\\vfill
{\\small Grammar, vocabulary and drills of the \\texttt{${tex(course.id)}} course pack.\\par}
\\vspace{1cm}
\\end{titlepage}

\\chapter*{About this book}
\\addcontentsline{toc}{chapter}{About this book}
${tex(course.description, "course.description")}

${course.attribution ? tex(course.attribution, "course.attribution") : ""}

Each section of the course is a chapter here. A lesson chapter states its
grammar as numbered paragraphs --- \\P1, \\P2, and so on, continuously through
the book --- with the examples, paradigms and footnotes that belong to each,
then its vocabulary, then its drills. A checkpoint chapter has no grammar of
its own: it is a paper over the lessons behind it.

The drills of a chapter are numbered from~1 and grouped by examination format.
Answers, with the explanation each drill carries, are in the appendix, so that
a chapter's questions can be worked as a paper. A cross-reference of the form
\\P78 is a link to the paragraph it names.

\\section*{Marking}
The formats and their marking are those of the JEE~Advanced paper the drills
are modelled on.

\\begin{center}\\small
\\begin{tabularx}{\\linewidth}{@{}l>{\\RaggedRight}X>{\\RaggedRight}X@{}}
\\toprule
\\textit{Format} & \\textit{Shape} & \\textit{Marks} \\\\
\\midrule
Single-answer & four options, exactly one correct & $+4$ correct, $-1$ wrong \\\\
Multiple-answer & four options, one to four correct & $+4$ for the whole set; $+1$ a correct option in an error-free subset; $-2$ once a wrong option is chosen \\\\
Integer-answer & a non-negative integer & $+4$ correct, $0$ otherwise \\\\
Matching & two columns, four candidate pairings, one correct & $+4$ correct, $-1$ wrong \\\\
Comprehension & a passage and the questions on it & the sum of its questions \\\\
\\bottomrule
\\end{tabularx}
\\end{center}

An unattempted question scores nothing, and nothing is subtracted for it.

\\tableofcontents
`;
}

function chapterBlock(
  section: Section,
  course: Course,
): { body: string; numbers: Map<string, number> } {
  const out: string[] = [];
  out.push(`\\chapter{${chapterTitle(section)}}`);
  out.push(`\\label{chap:${section.id}}`);
  out.push(`{\\itshape ${tex(section.summary, section.id)}\\par}`);

  if (isExam(section)) {
    const covered = section.covers
      .map((id) => `\\hyperref[chap:${id}]{Chapter~\\ref*{chap:${id}}}`)
      .join(", ");
    out.push(
      `\\rulenote{This paper examines ${covered}. ` +
        `${section.passThreshold}\\,\\% of the marks available is a pass.}`,
    );
  }

  if (isLesson(section)) {
    if (section.script) out.push(scriptBlock(section.script, section.id));
    if (section.rules.length > 0) out.push(rulesBlock(section));
    const vocabulary = vocabularyBlock(section, course);
    if (vocabulary) out.push(vocabulary);
  }

  const drills = drillsBlock(section);
  out.push(drills.body);
  out.push(sourcesBlock(section));
  return { body: out.join("\n\n"), numbers: drills.numbers };
}

/** One file of the book: where it goes, and what is in it. */
interface Part {
  /** Path relative to the master file's directory, without the .tex. */
  stem: string;
  body: string;
}

/** The master file, and one file per chapter beside it. */
interface Book {
  master: string;
  parts: Part[];
}

/**
 * A chapter file says where it sits in the sequence. LaTeX cannot chain the
 * files themselves — \include does not nest, and \input would hide the order
 * of the book inside the chapters and defeat \includeonly — so the chain is
 * written as the pointers a reader opening one file needs, and the master
 * carries the ordered \include list that actually builds the book.
 */
function partHeader(
  title: string,
  n: number,
  of: number,
  prev: Part | undefined,
  next: Part | undefined,
  masterName: string,
): string {
  return [
    `% ${title}`,
    `% Part ${n} of ${of} of the ${masterName} book.`,
    `% previous: ${prev ? prev.stem + ".tex" : "— (this is the first)"}`,
    `% next:     ${next ? next.stem + ".tex" : "— (this is the last)"}`,
    `% Generated by scripts/generate-latex.ts. Do not edit by hand.`,
    `% Included by ${masterName}; not a document on its own.`,
  ].join("\n");
}

function render(courseId: string, masterName: string): Book {
  const { course, sections } = getCourse(courseId);

  for (const section of sections) {
    if (!isLesson(section)) continue;
    for (const rule of section.rules) {
      if (ruleNumbers.has(rule.number)) {
        warnings.push(`¶${rule.number} is used by more than one rule`);
      }
      ruleNumbers.add(rule.number);
      ruleNumberById.set(rule.id, rule.number);
    }
  }

  // The chapters first, so that each knows what follows it.
  const parts: Part[] = [];
  const answers: string[] = [];
  const levelAt = new Map<number, string>();
  let level = "";
  for (const section of sections) {
    if (section.level !== level) {
      level = section.level;
      levelAt.set(parts.length, level);
    }
    const chapter = chapterBlock(section, course);
    parts.push({
      stem: `chapters/${String(section.order).padStart(2, "0")}-${section.id}`,
      body: chapter.body,
    });
    answers.push(answersBlock(section, chapter.numbers));
  }
  parts.push({
    stem: `chapters/${String(sections.length + 1).padStart(2, "0")}-answers`,
    body: [
      "\\chapter{Answers and explanations}",
      "The number in front of an answer is the number the question carries in " +
        "its own chapter.",
      ...answers,
    ].join("\n\n"),
  });

  const withHeaders = parts.map((part, i) => ({
    stem: part.stem,
    body:
      partHeader(
        chapterTitleOf(sections, i),
        i + 1,
        parts.length,
        parts[i - 1],
        parts[i + 1],
        masterName,
      ) +
      "\n\n" +
      part.body +
      "\n",
  }));

  const master: string[] = [preamble(course), frontMatter(course), "\\mainmatter"];
  parts.forEach((part, i) => {
    const at = levelAt.get(i);
    if (at) master.push(`\\part{Level ${tex(at)}}`);
    if (part.stem.endsWith("-answers")) master.push("\\appendix");
    master.push(`\\include{${part.stem}}`);
  });
  master.push("\\backmatter");
  master.push("\\end{document}");

  return { master: master.join("\n\n") + "\n", parts: withHeaders };
}

/** The title a part carries in its header comment. */
function chapterTitleOf(sections: Section[], i: number): string {
  return i < sections.length
    ? chapterTitle(sections[i])
    : "Answers and explanations";
}

/* --------------------------------------------------------------------- main */

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = outFlag >= 0 ? args[outFlag + 1] : undefined;
const courseId = args.find((a) => !a.startsWith("--") && a !== out) ?? "de";

if (!listCourseIds().includes(courseId)) {
  console.error(`no such course: ${courseId} (have ${listCourseIds().join(", ")})`);
  process.exit(1);
}

const file = out ?? path.join("build", "latex", `${courseId}.tex`);
const dir = path.dirname(file);
const book = render(courseId, path.basename(file));

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, book.master, "utf8");
for (const part of book.parts) {
  const target = path.join(dir, `${part.stem}.tex`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, part.body, "utf8");
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
const lines = (t: string) => t.split("\n").length;
console.log(`${file} — ${lines(book.master)} lines, ${book.parts.length} parts`);
for (const part of book.parts) {
  console.log(`  ${path.join(dir, part.stem)}.tex — ${lines(part.body)} lines`);
}
