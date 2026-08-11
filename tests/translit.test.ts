import { describe, expect, it } from "vitest";

import { loadCoursePack } from "@/content/loader";
import { isLesson } from "@/content/schema";
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

/* ------------------------------------------------------- where the reading goes */

describe("the reading follows the sentence, not the word", () => {
  it("reads a whole sentence out once, after its own punctuation", () => {
    expect(romanize("నా అక్క ఎక్కడ ఉంది?")).toBe(
      "నా అక్క ఎక్కడ ఉంది? (nā akka ekkaḍa undi)",
    );
  });

  it("steps outside the markdown wrapping the sentence", () => {
    expect(romanize("**నా అక్క ఎక్కడ ఉంది?**")).toBe(
      "**నా అక్క ఎక్కడ ఉంది?** (nā akka ekkaḍa undi)",
    );
  });

  it("keeps the spacing and the punctuation inside the sentence", () => {
    expect(romanize("రాము, నేను వస్తాను.")).toBe(
      "రాము, నేను వస్తాను. (rāmu, nēnu vastānu)",
    );
  });

  it("reads a cited word immediately after it, before the English full stop", () => {
    expect(romanize("The plural of **వెయ్యి** is **వేలు**.")).toBe(
      "The plural of **వెయ్యి** (veyyi) is **వేలు** (vēlu).",
    );
  });

  it("separates two words cited on either side of exposition", () => {
    expect(romanize("**ఇది** is this and **అది** is that.")).toBe(
      "**ఇది** (idi) is this and **అది** (adi) is that.",
    );
  });

  it("ends a span at a full stop, so two sentences are read separately", () => {
    expect(romanize("నేను వస్తాను. నువ్వు రా.")).toBe(
      "నేను వస్తాను. (nēnu vastānu) నువ్వు రా. (nuvvu rā)",
    );
  });

  it("ends a span at a line break, so a dialogue turn is read on its own line", () => {
    expect(romanize("రాము: నేను వస్తాను\nసీత: సరే")).toBe(
      "రాము: నేను వస్తాను (rāmu: nēnu vastānu)\nసీత: సరే (sīta: sarē)",
    );
  });

  it("keeps two separately emphasised citations apart", () => {
    // Joining them would attach "(akkā, taṇḍri)" to తండ్రి alone.
    expect(romanize("**అక్కా**, **తండ్రి** are both vocatives.")).toBe(
      "**అక్కా** (akkā), **తండ్రి** (taṇḍri) are both vocatives.",
    );
  });

  it("still joins across a comma inside one sentence", () => {
    expect(romanize("రాము, నేను వస్తాను.")).toBe(
      "రాము, నేను వస్తాను. (rāmu, nēnu vastānu)",
    );
  });

  it("leaves a reading the author wrote in", () => {
    expect(romanize("Read **ఇల్లు** (illu) again.")).toBe(
      "Read **ఇల్లు** (illu) again.",
    );
    expect(romanize("**నా అక్క ఎక్కడ ఉంది?** (nā akka ekkaḍa undi)")).toBe(
      "**నా అక్క ఎక్కడ ఉంది?** (nā akka ekkaḍa undi)",
    );
  });

  it("reads a repeated sentence out only once", () => {
    expect(romanize("ఇది ఇల్లు. ఇది ఇల్లు.")).toBe(
      "ఇది ఇల్లు. (idi illu) ఇది ఇల్లు.",
    );
  });

  it("never leaves markdown inside the parenthesis", () => {
    expect(romanize("**రెండు ఇళ్ళు** ఉన్నాయి.")).not.toMatch(/\([^)]*\*/);
  });
});

/* ------------------------------------------------------------------ the pack */

describe("the Telugu course is usable without reading the script", () => {
  const pack = loadCoursePack("te");
  /**
   * What counts as a reading a learner can use. Digits belong here as much as
   * letters do: the Telugu digits transliterate to European ones, so `౧ (1)`
   * is romanized even though it contains no Latin letter. `content/validate.ts`
   * draws the line in the same place.
   */
  const LATIN = /[\p{Script=Latin}\p{Nd}]/u;

  /**
   * What the learner is shown, which is what the renderer does: target text
   * carries a derived romanization, except on an item where reading the script
   * *is* the question. See `lib/markdown.tsx` and `AtomicQuestion.scriptCritical`.
   */
  const shown = (text: string, scriptCritical = false) =>
    scriptCritical ? text : romanize(text);

  /**
   * Every string a learner has to read in order to answer something —
   * excluding the drills, which are handled separately below because whether
   * they are romanized depends on what they are asking.
   */
  function readableStrings(): { where: string; text: string }[] {
    const out: { where: string; text: string }[] = [];
    const add = (where: string, text?: string) => {
      if (text && hasTelugu(text)) out.push({ where, text });
    };

    for (const s of pack.sections) {
      add(`${s.id} title`, s.title);
      add(`${s.id} summary`, s.summary);

      if (isLesson(s)) {
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
          // An explanation is shown only once the answer is in, so it is
          // romanized whatever the question was asking.
          add(`${q.id} explanation`, q.explanation);
        }
      }
    }
    return out;
  }

  /** Every string of a drill that the learner reads *before* answering. */
  function questionStrings(): {
    where: string;
    text: string;
    scriptCritical: boolean;
  }[] {
    const out: {
      where: string;
      text: string;
      scriptCritical: boolean;
    }[] = [];
    for (const s of pack.sections) {
      for (const drill of s.drills) {
        const kids = drill.type === "comprehension" ? drill.questions : [drill];
        for (const q of kids) {
          const add = (where: string, text: string) => {
            if (hasTelugu(text)) {
              out.push({ where, text, scriptCritical: q.scriptCritical });
            }
          };
          add(`${q.id} stem`, q.stem);
          if (q.type === "matching") {
            q.columnI.forEach((c, i) => add(`${q.id} column I ${i}`, c));
            q.columnII.forEach((c, i) => add(`${q.id} column II ${i}`, c));
          } else if (q.type !== "integer") {
            q.options.forEach((o, i) => add(`${q.id} option ${i}`, o));
          }
        }
      }
    }
    return out;
  }

  it("has target-language text to romanize in the first place", () => {
    expect(readableStrings().length).toBeGreaterThan(100);
    expect(questionStrings().length).toBeGreaterThan(200);
  });

  it("renders the prose and the explanations with a romanization beside them", () => {
    const bare = readableStrings()
      .filter(({ text }) => !LATIN.test(shown(text)))
      .map(({ where }) => where);
    expect(bare).toEqual([]);
  });

  it("leaves no Telugu character unread by the transliterator", () => {
    const unmapped = new Set<string>();
    for (const { text } of [...readableStrings(), ...questionStrings()]) {
      for (const run of teluguRuns(text)) {
        for (const ch of run.roman) {
          if (ch >= "ఀ" && ch <= "౿") unmapped.add(ch);
        }
      }
    }
    expect([...unmapped]).toEqual([]);
  });

  it("romanizes a question that is not about the script, so the grammar stays reachable", () => {
    const unreadable = questionStrings()
      .filter((q) => !q.scriptCritical && !LATIN.test(shown(q.text)))
      .map(({ where }) => where);
    expect(unreadable).toEqual([]);
  });

  /**
   * The other half of the rule, and the one that matters most: an item that
   * asks the learner to read a glyph must not print the reading beside it.
   * Without this the script sections degenerate into matching one Latin string
   * against another, which is not a test of Telugu at all.
   */
  it("prints a script-critical question bare, so the glyph has to be read", () => {
    const critical = questionStrings().filter((q) => q.scriptCritical);
    expect(critical.length).toBeGreaterThan(200);

    const leaked = critical
      .filter(({ text }) => shown(text, true) !== text)
      .map(({ where }) => where);
    expect(leaked).toEqual([]);
  });

  it("marks every question of the script sections script-critical", () => {
    const script = new Set(
      pack.sections
        .filter((s) => isLesson(s) && s.script)
        .map((s) => s.id),
    );
    const missed: string[] = [];
    for (const s of pack.sections) {
      for (const drill of s.drills) {
        const kids = drill.type === "comprehension" ? drill.questions : [drill];
        for (const q of kids) {
          const from = q.fromSection ?? drill.fromSection ?? s.id;
          if (script.has(from) && hasTelugu(q.stem) && !q.scriptCritical) {
            missed.push(q.id);
          }
        }
      }
    }
    expect(missed).toEqual([]);
  });
});
