import { describe, expect, it } from "vitest";

import { loadCoursePack } from "@/content/loader";
import { isCheckpoint } from "@/content/schema";
import { romanize } from "@/lib/markdown";
import {
  hasTelugu,
  teluguRuns,
  transliterateTelugu as tr,
} from "@/lib/translit";

describe("independent vowels", () => {
  it("maps the sixteen", () => {
    expect(tr("అఆఇఈఉఊ")).toBe("aāiīuū");
    expect(tr("ఎఏఐఒఓఔ")).toBe("eēaioōau");
    expect(tr("ఋౠఌౡ")).toBe("r̥r̥̄l̥l̥̄");
  });
});

describe("the inherent vowel", () => {
  it("supplies an a after a bare consonant", () => {
    expect(tr("క")).toBe("ka");
    expect(tr("మ")).toBe("ma");
    expect(tr("కమ")).toBe("kama");
  });

  it("keeps the inherent vowel at the end of a word, unlike Devanagari", () => {
    expect(tr("కల")).toBe("kala");
    expect(tr("తల")).toBe("tala");
  });

  it("is replaced, not joined, by a vowel sign", () => {
    expect(tr("కా")).toBe("kā");
    expect(tr("కి")).toBe("ki");
    expect(tr("కు")).toBe("ku");
    expect(tr("కే")).toBe("kē");
    expect(tr("కౌ")).toBe("kau");
  });

  it("is removed by the virāma", () => {
    expect(tr("క్")).toBe("k");
    expect(tr("త్")).toBe("t");
  });
});

describe("conjuncts", () => {
  it("joins two consonants with no vowel between them", () => {
    expect(tr("క్క")).toBe("kka");
    expect(tr("స్త")).toBe("sta");
    expect(tr("ల్లు")).toBe("llu");
  });

  it("reads whole words", () => {
    expect(tr("పుస్తకం")).toBe("pustakaṁ");
    expect(tr("ఇల్లు")).toBe("illu");
    expect(tr("అమ్మ")).toBe("amma");
    expect(tr("తెలుగు")).toBe("telugu");
    expect(tr("నీళ్ళు")).toBe("nīḷḷu");
    expect(tr("వెళ్ళాడు")).toBe("veḷḷāḍu");
    expect(tr("చదువుతున్నాను")).toBe("caduvutunnānu");
  });
});

describe("marks", () => {
  it("writes the anusvāra and visarga", () => {
    expect(tr("కం")).toBe("kaṁ");
    expect(tr("కః")).toBe("kaḥ");
  });

  it("settles the inherent vowel before a mark", () => {
    // The mark follows the vowel, so the a must be emitted first.
    expect(tr("పండు")).toBe("paṇḍu");
  });

  it("assimilates the anusvāra to the varga of the consonant after it", () => {
    // This is ¶18 of the course itself: the mark has no place of its own and
    // borrows one from its neighbour.
    expect(tr("పండు")).toBe("paṇḍu");      // retroflex డ → ṇ
    expect(tr("గుణింతం")).toBe("guṇintaṁ"); // dental త → n, then final ṁ
    expect(tr("అంబ")).toBe("amba");        // labial బ → m
  });

  it("leaves a word-final anusvāra as ṁ, having nothing to assimilate to", () => {
    expect(tr("పుస్తకం")).toBe("pustakaṁ");
    expect(tr("అక్షరం")).toBe("akṣaraṁ");
  });
});

describe("digits and passthrough", () => {
  it("maps the Telugu digits", () => {
    expect(tr("౦౧౨౩౪౫౬౭౮౯")).toBe("0123456789");
    expect(tr("౨౦౨౬")).toBe("2026");
  });

  it("leaves non-Telugu untouched", () => {
    expect(tr("in ఇల్లు, the house")).toBe("in illu, the house");
    expect(tr("no Telugu here")).toBe("no Telugu here");
  });
});

describe("detection and runs", () => {
  it("detects Telugu", () => {
    expect(hasTelugu("ఇల్లు")).toBe(true);
    expect(hasTelugu("illu")).toBe(false);
  });

  it("finds each run separately with its offsets", () => {
    const runs = teluguRuns("The word ఇల్లు means house, and అమ్మ mother.");
    expect(runs.map((r) => r.roman)).toEqual(["illu", "amma"]);
    expect(runs[0].source).toBe("ఇల్లు");
    expect(runs[0].start).toBe(9);
  });

  it("returns nothing for a string with no Telugu", () => {
    expect(teluguRuns("plain English")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ the pack */

describe("the Telugu course is usable without reading the script", () => {
  const pack = loadCoursePack("te");
  const LATIN = /\p{Script=Latin}/u;

  /** Every string a learner has to read in order to answer something. */
  function readableStrings(): { where: string; text: string }[] {
    const out: { where: string; text: string }[] = [];
    const add = (where: string, text?: string) => {
      if (text && hasTelugu(text)) out.push({ where, text });
    };

    for (const s of pack.sections) {
      add(`${s.id} title`, s.title);
      add(`${s.id} summary`, s.summary);

      if (!isCheckpoint(s)) {
        for (const rule of s.rules) {
          add(`${s.id} ${rule.id} statement`, rule.statement);
          rule.footnotes.forEach((f, i) =>
            add(`${s.id} ${rule.id} footnote ${i}`, f),
          );
          for (const p of rule.paradigms) {
            add(`${s.id} ${rule.id} caption`, p.caption);
            add(`${s.id} ${rule.id} paradigm footnote`, p.footnote);
            p.columns.forEach((c) => add(`${s.id} ${rule.id} column`, c));
            for (const row of p.rows) {
              add(`${s.id} ${rule.id} row label`, row.label);
              row.cells.forEach((c) => add(`${s.id} ${rule.id} cell`, c));
            }
          }
        }
      }

      for (const drill of s.drills) {
        const kids = drill.type === "comprehension" ? drill.questions : [drill];
        for (const q of kids) {
          add(`${q.id} stem`, q.stem);
          add(`${q.id} explanation`, q.explanation);
          if (q.type !== "integer") {
            q.options.forEach((o, i) => add(`${q.id} option ${i}`, o));
          }
        }
      }
    }
    return out;
  }

  it("has target-language text to romanize in the first place", () => {
    expect(readableStrings().length).toBeGreaterThan(200);
  });

  it("renders every such string with a romanization beside it", () => {
    const bare = readableStrings()
      .filter(({ text }) => !LATIN.test(romanize(text)))
      .map(({ where }) => where);
    expect(bare).toEqual([]);
  });

  it("leaves no Telugu character unread by the transliterator", () => {
    const unmapped = new Set<string>();
    for (const { text } of readableStrings()) {
      for (const run of teluguRuns(text)) {
        for (const ch of run.roman) {
          if (ch >= "ఀ" && ch <= "౿") unmapped.add(ch);
        }
      }
    }
    expect([...unmapped]).toEqual([]);
  });

  it("romanizes the options of every multiple-choice question", () => {
    const unreadable: string[] = [];
    for (const s of pack.sections) {
      for (const drill of s.drills) {
        const kids = drill.type === "comprehension" ? drill.questions : [drill];
        for (const q of kids) {
          if (q.type === "integer") continue;
          for (const [i, o] of q.options.entries()) {
            if (hasTelugu(o) && !LATIN.test(romanize(o))) {
              unreadable.push(`${q.id} option ${i}`);
            }
          }
        }
      }
    }
    expect(unreadable).toEqual([]);
  });
});
