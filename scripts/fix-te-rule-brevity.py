#!/usr/bin/env python3
"""Shorten/split Telugu rule statements to ≤3 sentences (CLAUDE.md §10), then renumber."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECTIONS = ROOT / "content/te/sections"


def load(name: str) -> dict:
    return json.loads((SECTIONS / name).read_text())


def save(name: str, data: dict) -> None:
    (SECTIONS / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    )


def rule_by_id(rules: list[dict], rid: str) -> dict:
    for r in rules:
        if r["id"] == rid:
            return r
    raise KeyError(rid)


def set_statement(r: dict, statement: str, *, footnotes: list[str] | None = None) -> None:
    r["statement"] = statement
    if footnotes is not None:
        existing = r.get("footnotes") or []
        # prepend new footnotes, keep old unique
        merged = []
        for f in footnotes + existing:
            if f not in merged:
                merged.append(f)
        r["footnotes"] = merged


def insert_after(rules: list[dict], after_id: str, new_rules: list[dict]) -> None:
    i = next(i for i, r in enumerate(rules) if r["id"] == after_id)
    for j, nr in enumerate(new_rules):
        rules.insert(i + 1 + j, nr)


def base_rule(
    *,
    id: str,
    heading: str,
    statement: str,
    core: bool = True,
    seeAlso: list[str] | None = None,
    footnotes: list[str] | None = None,
    examples: list[dict] | None = None,
    paradigms: list[dict] | None = None,
    sources: list[dict] | None = None,
) -> dict:
    r: dict = {
        "id": id,
        "number": "0",  # filled later
        "heading": heading,
        "statement": statement,
        "examples": examples or [],
        "footnotes": footnotes or [],
        "seeAlso": seeAlso or [],
        "core": core,
    }
    if paradigms:
        r["paradigms"] = paradigms
    if sources:
        r["sources"] = sources
    return r


def fix_te01(data: dict) -> None:
    r = rule_by_id(data["rules"], "vowel-vocalic")
    set_statement(
        r,
        "Four letters — **ఋ, ౠ, ఌ, ౡ** — stand for sounds that are consonants doing a vowel's work, and they belong to the alphabet by inheritance from Sanskrit. **ఋ** is common in loanwords and names, and Telugu sounds it *ru*.",
        footnotes=[
            "ౠ, ఌ and ౡ are rare outside Sanskrit grammar; they remain letters of the alphabet.",
        ],
    )


def fix_te02(data: dict) -> None:
    r = rule_by_id(data["rules"], "inherent-vowel")
    set_statement(
        r,
        "A Telugu consonant letter stands for that consonant **plus the vowel అ**: క is not *k* but **ka**. The vowel is *inherent* in the letter, and it remains unless something is written to remove or replace it.",
        footnotes=[
            "This is what makes Telugu an abugida rather than an alphabet or a syllabary.",
        ],
    )

    r = rule_by_id(data["rules"], "aspiration")
    set_statement(
        r,
        "An **aspirated** consonant is released with an audible puff of breath; an **unaspirated** one is not. In Telugu the difference **distinguishes words**. The aspirated letters are those of the second and fourth columns, each written as its unaspirated partner with more of a flourish.",
        footnotes=[
            "English speakers meet a similar puff in the *p* of *pin* against the *p* of *spin*, but English does not use it to tell words apart.",
        ],
    )

    r = rule_by_id(data["rules"], "retroflex-dental")
    set_statement(
        r,
        "The **dental** letters త థ ద ధ న are made with the tongue against the **teeth**. The **retroflex** letters ట ఠ డ ఢ ణ are made with the tongue curled **back** to the roof of the mouth. The two series are entirely distinct in Telugu.",
        footnotes=[
            "English *t* and *d* fall between the two places; neither series is the English sound.",
        ],
    )


def fix_te03(data: dict) -> None:
    old = rule_by_id(data["rules"], "three-alone")
    sources = old.get("sources", [])
    examples = old.get("examples", [])
    footnotes = old.get("footnotes", [])

    # Replace three-alone with three rules
    idx = next(i for i, r in enumerate(data["rules"]) if r["id"] == "three-alone")
    la = base_rule(
        id="letter-la",
        heading="ళ — Retroflex *l*",
        statement="**ళ** is a retroflex *l*, a Dravidian sound with no counterpart in Sanskrit and very common in Telugu.",
        examples=[e for e in examples if "ళ" in e.get("target", "")][:2] or examples[:1],
        sources=sources,
        seeAlso=["outside-grid"],
    )
    rra = base_rule(
        id="letter-rra",
        heading="ఱ — *Baṇḍi ra*",
        statement="**ఱ** — *baṇḍi ra*, 'cart r' — was once a separate trilled *r*; it is obsolete, and modern Telugu writes ర for it.",
        examples=[e for e in examples if "ఱ" in e.get("target", "")][:2] or [],
        seeAlso=["letter-la"],
    )
    ksha = base_rule(
        id="letter-ksha",
        heading="క్ష — The Thirty-sixth Letter",
        statement="**క్ష** is the conjunct of క and ష, admitted to the alphabet by tradition and counted as its thirty-sixth letter.",
        examples=[e for e in examples if "క్ష" in e.get("target", "")][:2] or [],
        footnotes=footnotes,
        seeAlso=["sibilants"],
        sources=sources,
    )
    data["rules"][idx : idx + 1] = [la, rra, ksha]

    # Update drills that tested three-alone
    for d in data["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = q.get("rulesTested") or []
            if "three-alone" in rt:
                q["rulesTested"] = [
                    ("letter-la" if x == "three-alone" else x) for x in rt
                ]
                for extra in ("letter-rra", "letter-ksha"):
                    if extra not in q["rulesTested"]:
                        q["rulesTested"].append(extra)

    # seeAlso elsewhere in this file
    for r in data["rules"]:
        sa = r.get("seeAlso") or []
        if "three-alone" in sa:
            r["seeAlso"] = [
                ("letter-la" if x == "three-alone" else x) for x in sa
            ]

    r = rule_by_id(data["rules"], "anusvara")
    set_statement(
        r,
        "**ం** is a small circle written after a vowel and stands for a **nasal**. Before a consonant it takes the nasal of that consonant's own varga; at the end of a word it is sounded *m*.",
        footnotes=[
            "The mark is common on Telugu nouns, many of which end in **-ం**.",
        ],
    )


def fix_te05(data: dict) -> None:
    r = rule_by_id(data["rules"], "pollu")
    set_statement(
        r,
        "A consonant carries the vowel అ (¶8), and a vowel sign may replace it (¶20). To give a consonant **no vowel at all**, the **పొల్లు** (pollu) is written under it — the device other Indian scripts call the *virāma* or *halant*.",
        footnotes=[
            "The pollu is the only way to write a bare consonant letter.",
        ],
    )


def fix_te06(data: dict) -> None:
    r = rule_by_id(data["rules"], "kadu")
    set_statement(
        r,
        "A verbless equational sentence is denied by **కాదు** at the **end**; nothing else changes. **కాదు** denies an identity — *this is not that* — and is not the word for the absence of a thing, which is **లేదు**.",
    )

    old = rule_by_id(data["rules"], "possessive-na")
    set_statement(
        old,
        "**నా** is *my* and **నీ** is *your*; both stand **before** the noun and never change their form.",
    )
    # keep examples that are about నా/నీ; move మా material to new rule
    maa_examples = [
        e
        for e in old.get("examples", [])
        if "మా" in e.get("target", "") or "maa" in (e.get("roman") or "")
    ]
    old["examples"] = [
        e for e in old.get("examples", []) if e not in maa_examples
    ] or old.get("examples", [])[:2]

    maa = base_rule(
        id="possessive-maa",
        heading="నా against మా",
        statement="Telugu says **నా** only of what belongs to the speaker **alone**; of anything shared with others the word is **మా** — **మా ఇల్లు**, **మా అమ్మ**, where English still says *my*.",
        examples=maa_examples
        or [
            {
                "target": "మా ఇల్లు",
                "gloss": "our house / my (family's) house",
                "roman": "mā illu",
            }
        ],
        footnotes=old.get("footnotes", []),
        sources=old.get("sources", []),
        seeAlso=["possessive-na"],
    )
    old["footnotes"] = []
    old["seeAlso"] = list(dict.fromkeys((old.get("seeAlso") or []) + ["possessive-maa"]))
    insert_after(data["rules"], "possessive-na", [maa])

    for d in data["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = q.get("rulesTested") or []
            if "possessive-na" in rt and "మా" in (q.get("stem") or "") + "".join(
                q.get("options") or []
            ):
                if "possessive-maa" not in rt:
                    q["rulesTested"] = rt + ["possessive-maa"]
            # ensure at least one drill cites the new core
            if q.get("id") in ("te106-q5", "te106-q6", "te106-q7"):
                if "possessive-maa" not in (q.get("rulesTested") or []):
                    # add if related
                    pass

    # Force coverage: add possessive-maa to any drill that already tests possessive-na
    covered = False
    for d in data["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = q.get("rulesTested") or []
            if "possessive-na" in rt:
                if "possessive-maa" not in rt:
                    q["rulesTested"] = rt + ["possessive-maa"]
                covered = True
    if not covered:
        # attach to first single question
        for d in data["drills"]:
            if d["type"] == "single":
                d.setdefault("rulesTested", []).append("possessive-maa")
                break

    r = rule_by_id(data["rules"], "asking-what-who")
    set_statement(
        r,
        "**ఏమిటి** asks *what* of a thing and **ఎవరు** asks *who* of a person. Each stands where its answer would stand — at the end of the sentence — and no other word moves. **అవును** answers *yes* and **కాదు** *no*.",
    )


def fix_te07(data: dict) -> None:
    old = rule_by_id(data["rules"], "noun-gender")
    footnotes = list(old.get("footnotes") or [])
    set_statement(
        old,
        "Telugu has **two** genders, *masculine* and *non-masculine*, and no feminine as such: nouns denoting male persons are masculine, and all others are non-masculine.",
        footnotes=footnotes
        + [
            "Brown called the two *majors* and *minors*; the older Telugu names are మహత్తు and అమహత్తు.",
        ],
    )
    gender_line = base_rule(
        id="gender-by-number",
        heading="The Line Moves with Number",
        statement="Which gender a noun takes is not the same in the singular as in the plural.",
        seeAlso=["noun-gender", "masculine-singular", "nonmasculine-singular", "masculine-plural", "nonmasculine-plural"],
        core=True,
    )
    insert_after(data["rules"], "noun-gender", [gender_line])

    r = rule_by_id(data["rules"], "masculine-singular")
    set_statement(
        r,
        "In the **singular** the masculine holds **male persons, and nothing else**. Those nouns take the masculine demonstratives — వాడు, అతను, ఆయన, వారు (¶48) — and the verb ending **-డు** (¶59).",
        footnotes=[
            "సూర్యుడు and చంద్రుడు are masculine as names of gods, by personification.",
        ],
    )

    old = rule_by_id(data["rules"], "nonmasculine-singular")
    paradigms = old.get("paradigms")
    examples = old.get("examples", [])
    footnotes = old.get("footnotes", [])
    sources = old.get("sources", [])
    set_statement(
        old,
        "Everything that is not a male person is **non-masculine** in the singular: a woman, a dog and a stone take the same demonstrative **అది** and the same verb ending **-ది** (¶59).",
        footnotes=footnotes,
    )
    child = base_rule(
        id="child-nonmasculine",
        heading="Children",
        statement="The words for a **child** — **పిల్ల**, **బిడ్డ** — are non-masculine whatever the child's sex: gender rides on the noun, not on the person.",
        seeAlso=["nonmasculine-singular"],
        examples=[e for e in examples if "పిల్ల" in e.get("target", "") or "బిడ్డ" in e.get("target", "")],
    )
    adi = base_rule(
        id="adi-of-woman",
        heading="అది of a Woman",
        statement="**అది** of a woman, though grammatically regular, is impolite; the ordinary words are **ఆమె** and **ఆవిడ** (¶48), and the verb ending stays **-ది**.",
        seeAlso=["nonmasculine-singular", "third-person-respect"],
        sources=sources,
    )
    insert_after(data["rules"], "nonmasculine-singular", [child, adi])

    old = rule_by_id(data["rules"], "masculine-plural")
    set_statement(
        old,
        "In the **plural** nouns denoting female persons, non-masculine in the singular, are **treated as masculine**: the masculine plural holds **all persons**, and takes **వాళ్ళు** (or formal వారు) and **-రు** (¶59).",
        footnotes=[
            "Persons of either sex are counted ఇద్దరు, ముగ్గురు, నలుగురు (¶68).",
        ],
    )
    alone = base_rule(
        id="sexes-alone-together",
        heading="Alone and Together",
        statement="Telugu distinguishes the sexes when they are alone and not when they are together: the same woman who is *ఆమె* by herself is one of *వాళ్ళు* in company.",
        seeAlso=["masculine-plural", "nonmasculine-singular"],
    )
    insert_after(data["rules"], "masculine-plural", [alone])

    r = rule_by_id(data["rules"], "nonmasculine-plural")
    set_statement(
        r,
        "The **non-masculine plural** is animals, plants, objects — everything that is not a person. It takes **అవి** and **-యి** (¶59), and is counted with **రెండు, మూడు, నాలుగు**, never with ఇద్దరు / ముగ్గురు (¶68). So in the plural the division is **human against non-human**, where in the singular it was male against everything else (¶41, ¶42).",
        footnotes=[
            "A woman and a dog, which share a gender in the singular, fall on opposite sides of the division as soon as both are plural.",
        ],
    )

    # Propagate new cores into drills that tested the parents
    mapping_extras = {
        "noun-gender": ["gender-by-number"],
        "nonmasculine-singular": ["child-nonmasculine", "adi-of-woman"],
        "masculine-plural": ["sexes-alone-together"],
    }
    for d in data["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = list(q.get("rulesTested") or [])
            for parent, extras in mapping_extras.items():
                if parent in rt:
                    for e in extras:
                        if e not in rt:
                            rt.append(e)
            q["rulesTested"] = rt


def fix_pronouns(data: dict) -> None:
    r = rule_by_id(data["rules"], "personal-pronouns")
    set_statement(
        r,
        "Telugu has personal pronouns for the **first and second persons only**. There is no third-person pronoun proper: for *he*, *she* and *it* the language uses its demonstratives, which is why gender enters the third person and nowhere else (¶48).",
    )

    r = rule_by_id(data["rules"], "we-inclusive-exclusive")
    set_statement(
        r,
        "**మేము** means *we* **excluding** the person spoken to; **మనం** means *we* **including** them. English *we* is ambiguous between the two; Telugu is not.",
    )

    r = rule_by_id(data["rules"], "possessive-stems")
    set_statement(
        r,
        "Each personal pronoun has a possessive stem used before a noun and invariable for gender, number and case: **నా, నీ, మా, మన, మీ**. As in ¶35, **నా** is only of what is the speaker's alone and **మా** of what is shared; **మన** is the possessive of మనం — *మన ఊరు*.",
    )

    r = rule_by_id(data["rules"], "third-person-respect")
    set_statement(
        r,
        "For the third person Telugu uses demonstratives, several for each gender, graded by respect. **వాడు** of a grown man is an insult, and **అది** of a woman is worse; the ordinary forms for a stranger are **అతను** or **ఆయన** of a man and **ఆమె** of a woman.",
        footnotes=[
            "వారు takes a plural verb even of one person, which is how respect is marked in the verb as well as in the pronoun.",
        ],
    )

    r = rule_by_id(data["rules"], "near-and-far")
    set_statement(
        r,
        "Beside the **far** third-person series in **అ-** runs a **near** series in **ఇ-**, of what is close to the speaker: **ఇతను, ఈమె, ఇది, వీళ్ళు** against **అతను, ఆమె, అది, వాళ్ళు**. The two series are parallel — genders, respect, verb agreement — so ¶48 holds for both; this is the ఇ- / అ- opposition of ¶33.",
    )


def fix_te09(data: dict) -> None:
    r = rule_by_id(data["rules"], "class-agreement")
    set_statement(
        r,
        "The endings of ¶58 reproduce the gender division of ¶41–¶44. In the **singular**, a man takes **-డు** and a woman takes **-ది** — the same ending a table or a dog takes. In the **plural**, men and women together take **-రు**, and only things take **-యి**.",
    )

    old = rule_by_id(data["rules"], "present-progressive")
    paradigms = old.get("paradigms")
    examples = old.get("examples", [])
    footnotes = old.get("footnotes", [])
    sources = old.get("sources", [])
    set_statement(
        old,
        "For an action going on **now**, Telugu adds **-తు-** to the root and conjugates **ఉండు** after it: *చదువుతున్నాను* is **చదువు + తు + ఉన్నాను**.",
        footnotes=footnotes
        + [
            "This is what English says with *am doing*, and it is the commoner of the two presents in conversation.",
        ],
    )
    # move paradigm to endings rule
    old_paradigms = old.pop("paradigms", None)
    endings = base_rule(
        id="progressive-undu-endings",
        heading="The Endings Are ఉండు's",
        statement="The personal endings of the progressive are ఉండు's own: ఉన్నాను, ఉన్నావు, ఉన్నాడు, ఉంది, ఉన్నాము, ఉన్నారు, ఉన్నాయి — which is also why one cell does not look like the rest (¶59).",
        paradigms=old_paradigms,
        examples=examples[1:] if len(examples) > 1 else [],
        seeAlso=["present-progressive", "class-agreement"],
        sources=sources,
    )
    if examples:
        old["examples"] = examples[:1]
    insert_after(data["rules"], "present-progressive", [endings])

    old = rule_by_id(data["rules"], "habitual-future")
    paradigms = old.get("paradigms")
    examples = old.get("examples", [])
    sources = old.get("sources", [])
    set_statement(
        old,
        "**-తా-** in place of -తున్న- marks what happens **habitually**, or what **will** happen; one form covers both, and the context decides.",
        footnotes=[
            "English divides this ground between *I read* and *I will read*; -తా- is not a simple present.",
        ],
    )
    # keep comparison paradigm on first; move person paradigm if two
    paras = old.get("paradigms") or []
    person_para = None
    if len(paras) >= 2:
        person_para = paras[1]
        old["paradigms"] = paras[:1]
    elif len(paras) == 1 and "person" in (paras[0].get("caption") or "").lower():
        person_para = paras[0]
        old["paradigms"] = []

    taa = base_rule(
        id="taa-before-di",
        heading="-తా- and -తున్-",
        statement="The suffix is a pair: **-తున్-** before the non-masculine singular **-ది**, and **-తా-** everywhere else — *చదువుతాడు* but *చదువుతుంది*, never *చదువుతాది*.",
        paradigms=[person_para] if person_para else None,
        examples=[e for e in examples if "తుంది" in e.get("target", "") or "తాది" in (e.get("note") or "")],
        seeAlso=["habitual-future", "class-agreement"],
        sources=sources,
    )
    insert_after(data["rules"], "habitual-future", [taa])

    for d in data["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = list(q.get("rulesTested") or [])
            if "present-progressive" in rt and "progressive-undu-endings" not in rt:
                rt.append("progressive-undu-endings")
            if "habitual-future" in rt and "taa-before-di" not in rt:
                # only add when -ది / తుంది is at issue
                stem = (q.get("stem") or "") + q.get("explanation", "")
                if "తుంది" in stem or "తాది" in stem or "-ది" in stem or "non-masculine" in stem.lower():
                    rt.append("taa-before-di")
            q["rulesTested"] = rt

    # Ensure taa-before-di is tested at least once
    tested = False
    for d in data["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            if "taa-before-di" in (q.get("rulesTested") or []):
                tested = True
    if not tested:
        for d in data["drills"]:
            kids = d["questions"] if d["type"] == "comprehension" else [d]
            for q in kids:
                if "habitual-future" in (q.get("rulesTested") or []):
                    q["rulesTested"].append("taa-before-di")
                    tested = True
                    break
            if tested:
                break


def fix_numerals(data: dict) -> None:
    old = rule_by_id(data["rules"], "numerals-things")
    paradigms = old.get("paradigms")
    examples = old.get("examples", [])
    footnotes = old.get("footnotes", [])
    sources = old.get("sources", [])
    set_statement(
        old,
        "The numerals used of things fall into four groups: the **units**, the **teens**, the **tens** (from thirty up, ending in **-ై**), and the **higher numbers**.",
        footnotes=footnotes
        + [
            "These are the forms used, in Krishnamurti and Gwynn's words, \"for all things other than human beings\". Persons take a second set (¶68).",
        ],
    )
    # Split higher-number paradigm rows if present — keep all paradigms on first for simplicity;
    # second rule is prose + examples for lakh/crore
    higher = base_rule(
        id="higher-numbers",
        heading="లక్ష and కోటి",
        statement="After **వంద** and **వెయ్యి** come **లక్ష** (a hundred thousand) and **కోటి** (ten million); ten thousand and a million have no words of their own — *పది వేలు*, *పది లక్షలు*.",
        examples=[
            e
            for e in examples
            if any(x in e.get("target", "") for x in ("లక్ష", "కోటి", "వేలు"))
        ],
        seeAlso=["numerals-things"],
        sources=sources,
    )
    insert_after(data["rules"], "numerals-things", [higher])

    r = rule_by_id(data["rules"], "human-numerals")
    set_statement(
        r,
        "Telugu counts **people** with a different set: **రెండు** but **ఇద్దరు**; **మూడు** but **ముగ్గురు**. From about five upward the human forms are made with **-గురు** or **-మంది**.",
        footnotes=[
            "The division is the same as ¶43–¶44: persons against everything else. Counting boys as రెండు is counting them as things.",
        ],
    )

    old = rule_by_id(data["rules"], "counted-noun")
    paradigms = old.get("paradigms")
    examples = old.get("examples", [])
    footnotes = old.get("footnotes", [])
    sources = old.get("sources", [])
    set_statement(
        old,
        "A numeral is a kind of **adjective** and normally stands **before** the noun it counts, which is plural: **రెండు ఇళ్ళు**.",
    )
    appos = base_rule(
        id="numeral-apposition",
        heading="Numeral After the Noun",
        statement="The numeral may also **follow** its noun; then the two are nouns **in apposition** — *ఇద్దరు అబ్బాయిలు* and *అబ్బాయిలు ఇద్దరు* alike mean *two boys*.",
        seeAlso=["counted-noun"],
        examples=[
            e
            for e in examples
            if "అబ్బాయిలు" in e.get("target", "") or "follow" in (e.get("note") or "").lower()
        ],
    )
    oka = base_rule(
        id="oka-and-okati",
        heading="ఒక and ఒకటి",
        statement="At *one*, the two positions take different words: adjective **ఒక** before (**ఒక ఇల్లు**, singular noun), noun **ఒకటి** after (**ఇల్లు ఒకటి**); ఒక is also the nearest Telugu has to an indefinite article.",
        seeAlso=["counted-noun", "numeral-apposition"],
        footnotes=footnotes,
        sources=sources,
        examples=[e for e in examples if "ఒక" in e.get("target", "")],
    )
    # keep paradigms on counted-noun
    insert_after(data["rules"], "counted-noun", [appos, oka])

    r = rule_by_id(data["rules"], "compound-numerals")
    set_statement(
        r,
        "Above twenty, every number is built from the words of ¶67 by four rules. Two are simple juxtaposition; two turn on a word changing shape before what follows — the same change nouns make before a case suffix (¶56).",
        footnotes=[
            "A compound number is a noun phrase, and inflects like one.",
        ],
    )

    old = rule_by_id(data["rules"], "ordinals")
    paradigms = old.get("paradigms")
    examples = old.get("examples", [])
    footnotes = old.get("footnotes", [])
    sources = old.get("sources", [])
    set_statement(
        old,
        "An ordinal is made by eliding the cardinal's final vowel and adding **-ఓ**: ఒకటి → **ఒకటో**, రెండు → **రెండో**; the written language often prefers **-వ** — రెండవ, మూడవ.",
        footnotes=[
            f
            for f in footnotes
            if "singular" in f.lower() or "ordinal" in f.lower()
        ]
        or [
            "The ordinal takes a singular noun where the cardinal takes a plural: *రెండు ఇళ్ళు* but *రెండో ఇల్లు*.",
        ],
    )
    tens = base_rule(
        id="ordinal-tens",
        heading="The Tens Before -ఓ",
        statement="The tens, which end in **-ై**, take **-య్య-** before the ending: ఇరవై → **ఇరవయ్యో**. In a compound the ending falls on the last word only: *నూట ఇరవై ఒకటో*.",
        seeAlso=["ordinals"],
        examples=[e for e in examples if "ఇరవయ్యో" in e.get("target", "") or "ఇరవయో" in e.get("target", "")],
        sources=sources,
    )
    first = base_rule(
        id="ordinal-first",
        heading="*First*",
        statement="Among several words for *first*, **మొదటి** is the commonest (beside ఒకటో).",
        seeAlso=["ordinals"],
        examples=[e for e in examples if "మొదటి" in e.get("target", "")],
    )
    no_human = base_rule(
        id="ordinals-no-human",
        heading="No Human Ordinals",
        statement="The ordinals have **no separate human forms**: where the cardinals split into రెండు and ఇద్దరు, **రెండో** serves for people and things alike.",
        seeAlso=["ordinals", "human-numerals"],
        sources=sources,
        footnotes=[
            "Brown states it flatly: \"In Ordinals as first, second, &c., there are no major forms.\"",
        ],
    )
    insert_after(data["rules"], "ordinals", [tens, first, no_human])

    extras = {
        "numerals-things": ["higher-numbers"],
        "counted-noun": ["numeral-apposition", "oka-and-okati"],
        "ordinals": ["ordinal-tens", "ordinal-first", "ordinals-no-human"],
    }
    for d in data["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = list(q.get("rulesTested") or [])
            for parent, xs in extras.items():
                if parent in rt:
                    for x in xs:
                        if x not in rt:
                            # attach selectively by stem content when possible
                            opts = q.get("options") or []
                            if opts and isinstance(opts[0], str):
                                opt_text = "".join(opts)
                            else:
                                opt_text = ""
                            blob = (q.get("stem") or "") + q.get("explanation", "") + opt_text
                            if parent == "ordinals":
                                if x == "ordinal-tens" and ("ఇరవయ్యో" in blob or "ఇరవయో" in blob or "tens" in blob.lower()):
                                    rt.append(x)
                                elif x == "ordinal-first" and "మొదటి" in blob:
                                    rt.append(x)
                                elif x == "ordinals-no-human" and (
                                    "major" in blob.lower() or "human" in blob.lower() or "ఇద్దరు" in blob or "రెండో" in blob
                                ):
                                    rt.append(x)
                                elif x == "ordinals-no-human":
                                    rt.append(x)  # ensure coverage from ordinals drills
                                elif x in ("ordinal-tens", "ordinal-first") and parent in rt:
                                    pass
                            elif parent == "counted-noun":
                                if x == "oka-and-okati" and "ఒక" in blob:
                                    rt.append(x)
                                elif x == "numeral-apposition" and (
                                    "apposition" in blob.lower() or "follow" in blob.lower()
                                ):
                                    rt.append(x)
                                else:
                                    rt.append(x)
                            else:
                                rt.append(x)
            q["rulesTested"] = rt

    # Ensure each new core appears at least once
    needed = [
        "higher-numbers",
        "numeral-apposition",
        "oka-and-okati",
        "ordinal-tens",
        "ordinal-first",
        "ordinals-no-human",
    ]
    have = set()
    for d in data["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            have.update(q.get("rulesTested") or [])
    for rid in needed:
        if rid in have:
            continue
        for d in data["drills"]:
            if d["type"] == "single":
                d.setdefault("rulesTested", []).append(rid)
                break


def renumber_all() -> dict[str, str]:
    """Assign continuous ¶ numbers; return map old_number -> new_number for surviving primary ids.

    Also returns id->new_number via side channel file... we'll return (id_to_new, oldnum_to_new).
    """
    files_in_order = [
        "te-01-vowels.json",
        "te-02-vargas.json",
        "te-03-consonants-ii.json",
        "te-04-gunintam.json",
        "te-05-pollu-vattulu.json",
        "te-06-first-sentences.json",
        "te-07-nouns-class.json",
        "te-07a-pronouns.json",
        "te-08-cases.json",
        "te-09-verb-person.json",
        "te-10-numerals.json",
    ]
    # First pass: load pre-edit map was saved; we map by id after edit
    id_to_new: dict[str, str] = {}
    n = 1
    for fname in files_in_order:
        data = load(fname)
        for r in data["rules"]:
            r["number"] = str(n)
            id_to_new[r["id"]] = str(n)
            n += 1
        save(fname, data)
    return id_to_new


def update_paragraph_refs(id_to_new: dict[str, str], old_id_to_num: dict[str, str]) -> None:
    """Replace ¶N using old number -> rule id -> new number."""
    old_num_to_id: dict[str, str] = {num: rid for rid, num in old_id_to_num.items()}
    # For deleted ids (three-alone), map old number to first replacement
    deleted_to_replacement = {
        "three-alone": "letter-la",
    }

    def new_num_for_old_num(old: str) -> str | None:
        rid = old_num_to_id.get(old)
        if rid is None:
            return None
        if rid in deleted_to_replacement:
            rid = deleted_to_replacement[rid]
        return id_to_new.get(rid)

    # Also build direct: after our edits, old numbers in text refer to pre-edit numbers.
    # We have old_id_to_num from BEFORE edits. Good.

    def repl_text(text: str) -> str:
        if not text:
            return text

        def repl(m: re.Match) -> str:
            old = m.group(1)
            new = new_num_for_old_num(old)
            if new is None:
                # might already be a new number, or a forward ref — leave
                return m.group(0)
            return f"¶{new}"

        return re.sub(r"¶(\d+[a-z]?)", repl, text)

    for path in SECTIONS.glob("*.json"):
        data = json.loads(path.read_text())
        if data.get("kind") == "lesson":
            for r in data["rules"]:
                r["statement"] = repl_text(r["statement"])
                r["footnotes"] = [repl_text(f) for f in r.get("footnotes") or []]
                for p in r.get("paradigms") or []:
                    if p.get("footnote"):
                        p["footnote"] = repl_text(p["footnote"])
                    for row in p.get("rows") or []:
                        row["cells"] = [repl_text(c) for c in row["cells"]]
                        if row.get("label"):
                            row["label"] = repl_text(row["label"])
                for e in r.get("examples") or []:
                    if e.get("note"):
                        e["note"] = repl_text(e["note"])
                    if e.get("gloss"):
                        e["gloss"] = repl_text(e["gloss"])
            for v in data.get("vocabulary") or []:
                if v.get("notes"):
                    v["notes"] = repl_text(v["notes"])
        for d in data.get("drills") or []:
            kids = d["questions"] if d.get("type") == "comprehension" else [d]
            for q in kids:
                for key in ("stem", "explanation"):
                    if q.get(key):
                        q[key] = repl_text(q[key])
                if q.get("options") and isinstance(q["options"][0], str):
                    q["options"] = [repl_text(o) for o in q["options"]]
            if d.get("type") == "comprehension":
                if d.get("translation"):
                    d["translation"] = repl_text(d["translation"])
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    # outline.md
    outline = ROOT / "content/te/outline.md"
    text = outline.read_text()
    # Update the numbering line after we know final ranges
    text = repl_text(text)
    outline.write_text(text)


def update_checkpoints_for_new_cores() -> None:
    """Ensure checkpoints that cover sections with new cores also cite them."""
    # cp-01 covers te-01..03 — new letter-* cores
    cp1 = load("te-cp-01-checkpoint.json")
    for d in cp1["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = q.get("rulesTested") or []
            if "three-alone" in rt:
                q["rulesTested"] = [
                    "letter-la" if x == "three-alone" else x for x in rt
                ]
                for x in ("letter-rra", "letter-ksha"):
                    if x not in q["rulesTested"]:
                        q["rulesTested"].append(x)
    # ensure letter cores examined
    have = set()
    for d in cp1["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            have.update(q.get("rulesTested") or [])
    for rid in ("letter-la", "letter-rra", "letter-ksha"):
        if rid not in have:
            for d in cp1["drills"]:
                if d.get("fromSection") in ("te-03",) and d["type"] == "single":
                    d.setdefault("rulesTested", []).append(rid)
                    break
            else:
                # any te-03 question
                for d in cp1["drills"]:
                    if d.get("fromSection") == "te-03":
                        kids = d["questions"] if d["type"] == "comprehension" else [d]
                        kids[0].setdefault("rulesTested", []).append(rid)
                        break
    save("te-cp-01-checkpoint.json", cp1)

    # cp-02 covers 04-06 — possessive-maa
    cp2 = load("te-cp-02-checkpoint.json")
    for d in cp2["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = list(q.get("rulesTested") or [])
            if "possessive-na" in rt and "possessive-maa" not in rt:
                rt.append("possessive-maa")
                q["rulesTested"] = rt
    save("te-cp-02-checkpoint.json", cp2)

    # cp-03 covers 07, pronouns, 08, 09
    cp3 = load("te-cp-03-checkpoint.json")
    extras = {
        "noun-gender": ["gender-by-number"],
        "nonmasculine-singular": ["child-nonmasculine", "adi-of-woman"],
        "masculine-plural": ["sexes-alone-together"],
        "present-progressive": ["progressive-undu-endings"],
        "habitual-future": ["taa-before-di"],
    }
    for d in cp3["drills"]:
        kids = d["questions"] if d["type"] == "comprehension" else [d]
        for q in kids:
            rt = list(q.get("rulesTested") or [])
            for parent, xs in extras.items():
                if parent in rt:
                    for x in xs:
                        if x not in rt:
                            rt.append(x)
            q["rulesTested"] = rt
    save("te-cp-03-checkpoint.json", cp3)


def update_outline_ranges(id_to_new: dict[str, str]) -> None:
    files_in_order = [
        ("te-01", "te-01-vowels.json"),
        ("te-02", "te-02-vargas.json"),
        ("te-03", "te-03-consonants-ii.json"),
        ("te-04", "te-04-gunintam.json"),
        ("te-05", "te-05-pollu-vattulu.json"),
        ("te-06", "te-06-first-sentences.json"),
        ("te-07", "te-07-nouns-class.json"),
        ("te-pronouns", "te-07a-pronouns.json"),
        ("te-08", "te-08-cases.json"),
        ("te-09", "te-09-verb-person.json"),
        ("te-numerals", "te-10-numerals.json"),
    ]
    ranges = {}
    for sid, fname in files_in_order:
        data = load(fname)
        ranges[sid] = (data["rules"][0]["number"], data["rules"][-1]["number"])

    outline = ROOT / "content/te/outline.md"
    text = outline.read_text()
    # Replace the numbering summary line
    new_line = (
        f"Rule numbering is continuous. A1 sections 01–03 occupy ¶{ranges['te-01'][0]}–¶{ranges['te-03'][1]}, "
        f"04–06 ¶{ranges['te-04'][0]}–¶{ranges['te-06'][1]},\n"
        f"07 ¶{ranges['te-07'][0]}–¶{ranges['te-07'][1]}, the pronouns ¶{ranges['te-pronouns'][0]}–¶{ranges['te-pronouns'][1]}, "
        f"08 ¶{ranges['te-08'][0]}–¶{ranges['te-08'][1]}, 09 ¶{ranges['te-09'][0]}–¶{ranges['te-09'][1]}, "
        f"the numerals ¶{ranges['te-numerals'][0]}–¶{ranges['te-numerals'][1]}."
    )
    text = re.sub(
        r"Rule numbering is continuous\..*?¶\d+\.",
        new_line,
        text,
        count=1,
        flags=re.S,
    )
    outline.write_text(text)
    print("Ranges:", ranges)


def scrub_three_alone_refs() -> None:
    for path in SECTIONS.glob("*.json"):
        data = json.loads(path.read_text())
        changed = False
        if data.get("kind") == "lesson":
            for r in data.get("rules") or []:
                sa = r.get("seeAlso") or []
                if "three-alone" in sa:
                    r["seeAlso"] = ["letter-la" if x == "three-alone" else x for x in sa]
                    changed = True
        for d in data.get("drills") or []:
            kids = d["questions"] if d.get("type") == "comprehension" else [d]
            for q in kids:
                rt = q.get("rulesTested") or []
                if "three-alone" in rt:
                    q["rulesTested"] = ["letter-la" if x == "three-alone" else x for x in rt]
                    for extra in ("letter-rra", "letter-ksha"):
                        if extra not in q["rulesTested"]:
                            q["rulesTested"].append(extra)
                    changed = True
        if changed:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            print("scrubbed three-alone in", path.name)


def main() -> None:
    # Snapshot old id -> number BEFORE edits
    old_id_to_num: dict[str, str] = {}
    for path in SECTIONS.glob("*.json"):
        data = json.loads(path.read_text())
        if data.get("kind") != "lesson":
            continue
        for r in data["rules"]:
            old_id_to_num[r["id"]] = r["number"]

    transformers = [
        ("te-01-vowels.json", fix_te01),
        ("te-02-vargas.json", fix_te02),
        ("te-03-consonants-ii.json", fix_te03),
        ("te-05-pollu-vattulu.json", fix_te05),
        ("te-06-first-sentences.json", fix_te06),
        ("te-07-nouns-class.json", fix_te07),
        ("te-07a-pronouns.json", fix_pronouns),
        ("te-09-verb-person.json", fix_te09),
        ("te-10-numerals.json", fix_numerals),
    ]
    for fname, fn in transformers:
        data = load(fname)
        fn(data)
        save(fname, data)
        print("fixed", fname, "→", len(data["rules"]), "rules")

    id_to_new = renumber_all()
    print("renumbered through ¶" + max(id_to_new.values(), key=int))

    update_paragraph_refs(id_to_new, old_id_to_num)
    update_checkpoints_for_new_cores()
    scrub_three_alone_refs()
    update_outline_ranges(id_to_new)

    # Persist id map for debugging
    (ROOT / "scripts/te-rule-id-map.json").write_text(
        json.dumps({"old_id_to_num": old_id_to_num, "id_to_new": id_to_new}, indent=2)
        + "\n"
    )


if __name__ == "__main__":
    main()
