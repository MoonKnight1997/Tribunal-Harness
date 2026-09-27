/**
 * Deterministic post-generation checks on a drafted document.
 *
 * Every check compares the draft against the exact payload that was sent to
 * the model and returns flags for a HUMAN to review. They are heuristics:
 * they can miss things and they can flag things that are fine. Passing them
 * proves nothing about correctness; failing them means "look at this before
 * you use it". Nothing here edits the draft.
 *
 * Pure: no I/O, no clock, no randomness.
 */

import type { ArtifactReviewFlag } from "@/db/schema";
import { isIsoDate } from "@/lib/dates";
import { findPercentages, findStrengthLanguage } from "@/legal/claims/language";

const MONTHS: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

const pad = (n: number) => String(n).padStart(2, "0");

interface FoundDate {
    iso: string;
    raw: string;
    index: number;
}

/** ISO, "3 March 2026" / "3rd March 2026", "March 3, 2026" and 03/03/2026 forms. */
export function findDatesInText(text: string): FoundDate[] {
    const out: FoundDate[] = [];
    let m: RegExpExecArray | null;
    const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = isoRe.exec(text)) !== null) {
        const iso = `${m[1]}-${m[2]}-${m[3]}`;
        if (isIsoDate(iso)) out.push({ iso, raw: m[0], index: m.index });
    }
    const longRe = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_RE})\.?,?\s+(\d{4})\b`, "gi");
    while ((m = longRe.exec(text)) !== null) {
        const iso = `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
        if (isIsoDate(iso)) out.push({ iso, raw: m[0], index: m.index });
    }
    const usRe = new RegExp(String.raw`\b(${MONTH_RE})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, "gi");
    while ((m = usRe.exec(text)) !== null) {
        const iso = `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(Number(m[2]))}`;
        if (isIsoDate(iso)) out.push({ iso, raw: m[0], index: m.index });
    }
    const slashRe = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;
    while ((m = slashRe.exec(text)) !== null) {
        const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
        if (isIsoDate(iso)) out.push({ iso, raw: m[0], index: m.index });
    }
    return out.sort((a, b) => a.index - b.index);
}

/** Every string value anywhere in the payload (keys are ignored). */
export function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
    if (depth > 12) return out;
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
    else if (value && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out, depth + 1);
    return out;
}

function normalise(s: string): string {
    return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
}

function excerptAround(text: string, index: number, length: number, radius = 60): string {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + length + radius);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

/** Capitalised words that look like names but are not (headings, institutions, salutations…). */
const NAME_STOPWORDS = new Set(
    [
        ...Object.keys(MONTHS),
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
        "acas", "early", "conciliation", "employment", "tribunal", "tribunals", "act", "code", "practice", "equality", "rights",
        "human", "resources", "hr", "head", "office", "manager", "director", "ltd", "limited", "plc", "llp", "company",
        "united", "kingdom", "uk", "england", "wales", "scotland", "northern", "ireland", "great", "britain", "gov",
        "dear", "yours", "sincerely", "faithfully", "sir", "madam", "regards", "kind", "best", "thank", "you",
        "grievance", "appeal", "disciplinary", "hearing", "meeting", "statement", "section", "chronology", "summary",
        "preparation", "note", "notes", "letter", "response", "outcome", "confirmed", "facts", "fact", "points",
        "what", "when", "where", "who", "why", "how", "the", "this", "that", "these", "those", "please", "date",
        "subject", "re", "to", "from", "cc", "documents", "document", "evidence", "issues", "issue", "questions",
        "case", "pass", "claim", "pack", "readiness", "et1", "et3", "pay", "holiday", "notice", "contract",
        "monday", "occupational", "health", "trade", "union", "citizens", "advice", "law", "centre", "legal", "aid",
        "day", "month", "year", "week", "confirm", "not", "record", "in", "the", "generated", "please",
        "i", "my", "me", "we", "our",
    ].map((w) => w.toLowerCase()),
);

const HONORIFIC_RE = /\b(Mr|Mrs|Ms|Mx|Miss|Dr|Prof|Professor)\.?\s+([A-Z][a-z'’-]+)(?:\s+([A-Z][a-z'’-]+))?/g;
const TWO_WORD_RE = /([^\n#\-*.:!?"“]\s)([A-Z][a-z'’-]{2,})\s+([A-Z][a-z'’-]{2,})\b/g;

const CITATION_RES: Array<{ re: RegExp; what: string }> = [
    { re: /\[(?:19|20)\d{2}\]\s+[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*\s+\d+/g, what: "a neutral citation" },
    { re: /\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)*\s+v\.?\s+[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)*/g, what: "a case name" },
    { re: /\bsections?\s+\d+[A-Za-z]?(?:\(\d+\))*/gi, what: "a statutory section" },
    { re: /\bss?\.?\s?\d{1,3}[A-Za-z]?(?:\(\d+\))+|\bss?\.\s?\d{1,3}[A-Za-z]?\b|\bss?\d{1,3}[A-Za-z]?\b/g, what: "a statutory section" },
    { re: /\b(?:[A-Z][A-Za-z]+\s+)+Act\s+(?:19|20)\d{2}\b/g, what: "an Act of Parliament" },
    { re: /\b(?:[A-Z][A-Za-z]+\s+)*Regulations(?:\s+(?:19|20)\d{2})?\b/g, what: "regulations" },
];

const QUOTE_RE = /"([^"\n]{25,})"|“([^”\n]{25,})”|'([^'\n]{40,})'/g;

export interface CheckPayload {
    authoritative: unknown;
    supplementary?: unknown;
}

/**
 * Run every check against the draft body (before any disclaimer is appended).
 * `payload` is the exact object sent to the model, so anything supplied to
 * the model (including the user's own supplementary notes) counts as
 * supported; anything else is flagged.
 */
export function checkDraft(content: string, payload: CheckPayload | Record<string, unknown>): ArtifactReviewFlag[] {
    const flags: ArtifactReviewFlag[] = [];
    const strings = collectStrings(payload);
    const corpus = strings.join("\n");
    const corpusNorm = normalise(corpus);
    const corpusWords = new Set(corpusNorm.split(/[^a-z0-9'’-]+/).filter(Boolean));

    // ── dates ──────────────────────────────────────────────────────────────
    const supportedDates = new Set(findDatesInText(corpus).map((d) => d.iso));
    const seenDates = new Set<string>();
    for (const d of findDatesInText(content)) {
        if (supportedDates.has(d.iso) || seenDates.has(d.iso)) continue;
        seenDates.add(d.iso);
        flags.push({ kind: "unsupported_date", excerpt: excerptAround(content, d.index, d.raw.length), note: `The date "${d.raw}" is not in your case record. Check it or remove it.` });
    }

    // ── percentages ────────────────────────────────────────────────────────
    for (const p of findPercentages(content)) {
        if (corpusNorm.includes(normalise(p.text))) continue; // e.g. a recorded "10% deduction"
        flags.push({ kind: "percentage", excerpt: excerptAround(content, p.index, p.text.length), note: "A percentage appears here. This tool does not give likelihood-of-success figures; check that any percentage is a recorded fact, not an assessment." });
    }

    // ── strength / outcome language (all occurrences) ─────────────────────
    for (const s of findStrengthLanguage(content)) {
        flags.push({ kind: "strength_assertion", excerpt: excerptAround(content, s.index, s.text.length), note: `"${s.text}" reads as a judgement about how the case will go. Remove or reword it; this tool does not assess merits.` });
    }

    // ── quotations ─────────────────────────────────────────────────────────
    let qm: RegExpExecArray | null;
    const quoteRe = new RegExp(QUOTE_RE.source, "g");
    while ((qm = quoteRe.exec(content)) !== null) {
        const inner = qm[1] ?? qm[2] ?? qm[3];
        if (!inner) continue;
        if (corpusNorm.includes(normalise(inner))) continue;
        flags.push({ kind: "unsupported_quote", excerpt: excerptAround(content, qm.index, qm[0].length, 20), note: "This quotation does not appear word-for-word in your record. Only quote what you can point to in a document." });
    }

    // ── legal-source-like citations (heuristic) ────────────────────────────
    // The drafting prompt forbids citing law at all, so anything that looks like
    // a citation and was not in the input is flagged for review. Plain words
    // such as "the Regulations" will also be caught; that is intentional.
    const citationSeen = new Set<string>();
    for (const { re, what } of CITATION_RES) {
        const r = new RegExp(re.source, re.flags);
        let cm: RegExpExecArray | null;
        while ((cm = r.exec(content)) !== null) {
            const text = cm[0].trim();
            const key = normalise(text);
            if (citationSeen.has(key)) continue;
            if (corpusNorm.includes(key)) continue;
            citationSeen.add(key);
            flags.push({ kind: "fabricated_source", excerpt: excerptAround(content, cm.index, cm[0].length), note: `"${text}" looks like ${what} that was not in your record. Generated documents must not cite law or cases; delete it or verify it against an official source.` });
        }
    }

    // ── person names (heuristic) ───────────────────────────────────────────
    // Limits: only Latin-script capitalised tokens; two-word sequences at the
    // start of a sentence or list item are skipped (they are usually headings
    // or ordinary sentence openers), and a stop-list removes institutions,
    // salutations and calendar words. A name is "supported" when each of its
    // words appears anywhere in the payload (people, employer, documents,
    // facts, supplementary notes). Names split across a line break, lower-case
    // surnames and single-word names without an honorific are not detected.
    const nameSeen = new Set<string>();
    const bare = (w: string) => normalise(w).replace(/['’]s$/, "");
    const nameSupported = (words: string[]) => words.every((w) => corpusWords.has(bare(w)));
    const hon = new RegExp(HONORIFIC_RE.source, HONORIFIC_RE.flags);
    let nm: RegExpExecArray | null;
    while ((nm = hon.exec(content)) !== null) {
        const words = [nm[2], nm[3]].filter((w): w is string => !!w);
        if (words.every((w) => NAME_STOPWORDS.has(w.toLowerCase()))) continue;
        const key = normalise(words.join(" "));
        if (nameSeen.has(key) || nameSupported(words)) continue;
        nameSeen.add(key);
        flags.push({ kind: "unsupported_name", excerpt: excerptAround(content, nm.index, nm[0].length), note: `"${nm[0].trim()}" is not among the people recorded on this case. Check the name.` });
    }
    const two = new RegExp(TWO_WORD_RE.source, TWO_WORD_RE.flags);
    while ((nm = two.exec(content)) !== null) {
        const words = [nm[2], nm[3]];
        if (words.some((w) => NAME_STOPWORDS.has(w.toLowerCase()))) continue;
        const key = normalise(words.join(" "));
        if (nameSeen.has(key) || nameSupported(words)) continue;
        nameSeen.add(key);
        const idx = nm.index + nm[1].length;
        flags.push({ kind: "unsupported_name", excerpt: excerptAround(content, idx, nm[0].length - nm[1].length), note: `"${words.join(" ")}" may be a person's name that is not on this case. Check it.` });
    }

    return flags;
}
