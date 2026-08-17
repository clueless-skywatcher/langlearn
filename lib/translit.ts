/**
 * Telugu → ISO 15919 transliteration.
 *
 * Telugu is an abugida: a consonant letter carries an inherent /a/ which a
 * vowel sign replaces and the virāma removes. Transliteration is therefore not
 * a character-for-character table but a small state machine — after a
 * consonant we owe an "a" until we see what comes next.
 *
 * Unlike Devanagari, Telugu does not delete the inherent vowel at the end of a
 * word, so no schwa-deletion heuristic is needed and the mapping is exact.
 */

const INDEPENDENT_VOWELS: Record<string, string> = {
  "అ": "a", "ఆ": "ā", "ఇ": "i", "ఈ": "ī", "ఉ": "u", "ఊ": "ū",
  "ఋ": "r̥", "ౠ": "r̥̄", "ఌ": "l̥", "ౡ": "l̥̄",
  "ఎ": "e", "ఏ": "ē", "ఐ": "ai", "ఒ": "o", "ఓ": "ō", "ఔ": "au",
};

/** Vowel signs (mātras), which replace the inherent vowel. */
const VOWEL_SIGNS: Record<string, string> = {
  "ా": "ā", "ి": "i", "ీ": "ī", "ు": "u", "ూ": "ū",
  "ృ": "r̥", "ౄ": "r̥̄", "ౢ": "l̥", "ౣ": "l̥̄",
  "ె": "e", "ే": "ē", "ై": "ai", "ొ": "o", "ో": "ō", "ౌ": "au",
};

/** Consonants, given without the inherent vowel the state machine supplies. */
const CONSONANTS: Record<string, string> = {
  "క": "k", "ఖ": "kh", "గ": "g", "ఘ": "gh", "ఙ": "ṅ",
  "చ": "c", "ఛ": "ch", "జ": "j", "ఝ": "jh", "ఞ": "ñ",
  "ట": "ṭ", "ఠ": "ṭh", "డ": "ḍ", "ఢ": "ḍh", "ణ": "ṇ",
  "త": "t", "థ": "th", "ద": "d", "ధ": "dh", "న": "n",
  "ప": "p", "ఫ": "ph", "బ": "b", "భ": "bh", "మ": "m",
  "య": "y", "ర": "r", "ల": "l", "వ": "v", "ళ": "ḷ", "ఱ": "ṟ",
  "శ": "ś", "ష": "ṣ", "స": "s", "హ": "h",
  "ౘ": "ĉ", "ౙ": "ẑ",
};

const DIGITS: Record<string, string> = {
  "౦": "0", "౧": "1", "౨": "2", "౩": "3", "౪": "4",
  "౫": "5", "౬": "6", "౭": "7", "౮": "8", "౯": "9",
};

/** The varga each consonant belongs to, for assimilating the anusvāra. */
const VARGA_NASAL: Record<string, string> = {};
for (const [letters, nasal] of [
  ["కఖగఘఙ", "ṅ"],
  ["చఛజఝఞ", "ñ"],
  ["టఠడఢణ", "ṇ"],
  ["తథదధన", "n"],
  ["పఫబభమ", "m"],
] as const) {
  for (const ch of letters) VARGA_NASAL[ch] = nasal;
}

const VIRAMA = "్";
const ANUSVARA = "ం";
const VISARGA = "ః";
const CANDRABINDU = "ఁ";

/** Telugu occupies U+0C00–U+0C7F and nothing else does. */
const TELUGU = /[ఀ-౿]/;
const TELUGU_RUN = /[ఀ-౿][ఀ-౿‌‍]*/g;

export function hasTelugu(text: string): boolean {
  return TELUGU.test(text);
}

/**
 * Transliterate a stretch of Telugu. Characters outside the Telugu block are
 * passed through untouched, so a mixed string round-trips safely.
 */
export function transliterateTelugu(text: string): string {
  const chars = [...text];
  let out = "";
  // True when a consonant has been emitted whose inherent vowel is still owed.
  let owesInherentA = false;

  const settle = () => {
    if (owesInherentA) out += "a";
    owesInherentA = false;
  };

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch in CONSONANTS) {
      settle();
      out += CONSONANTS[ch];
      owesInherentA = true;
      continue;
    }
    if (ch in VOWEL_SIGNS) {
      // The sign replaces the inherent vowel rather than following it.
      owesInherentA = false;
      out += VOWEL_SIGNS[ch];
      continue;
    }
    if (ch === VIRAMA) {
      owesInherentA = false;
      continue;
    }
    if (ch in INDEPENDENT_VOWELS) {
      settle();
      out += INDEPENDENT_VOWELS[ch];
      continue;
    }
    if (ch === ANUSVARA) {
      settle();
      // Before a stop it takes that stop's own nasal — పండు is paṇḍu, not
      // paṁḍu. Elsewhere, and at the end of a word, it stays ṁ.
      out += VARGA_NASAL[chars[i + 1] ?? ""] ?? "ṁ";
      continue;
    }
    if (ch === VISARGA) {
      settle();
      out += "ḥ";
      continue;
    }
    if (ch === CANDRABINDU) {
      settle();
      out += "m̐";
      continue;
    }
    if (ch in DIGITS) {
      settle();
      out += DIGITS[ch];
      continue;
    }
    // Zero-width joiners only shape the glyph and carry no sound.
    if (ch === "‌" || ch === "‍") continue;

    settle();
    out += ch;
  }

  settle();
  return out;
}

/** Every maximal run of Telugu in a string, with where it starts and ends. */
export function teluguRuns(
  text: string,
): { start: number; end: number; source: string; roman: string }[] {
  const runs: { start: number; end: number; source: string; roman: string }[] = [];
  for (const m of text.matchAll(TELUGU_RUN)) {
    runs.push({
      start: m.index,
      end: m.index + m[0].length,
      source: m[0],
      roman: transliterateTelugu(m[0]),
    });
  }
  return runs;
}

/** Compare loosely, so that "pustakaṁ" and "pustakam" count as the same gloss. */
export function looseEqualish(a: string, b: string): boolean {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  const fa = fold(a);
  const fb = fold(b);
  if (fa.length === 0 || fb.length === 0) return false;
  return fb.includes(fa) || fa.includes(fb);
}
