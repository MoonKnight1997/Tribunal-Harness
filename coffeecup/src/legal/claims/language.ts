/**
 * Strength / outcome language the product must never emit about a case.
 *
 * One list, used by the claim-analysis sanitiser (`review.ts`) and the
 * post-generation draft checks (`src/artifacts/checks.ts`) so the two cannot
 * drift. Detection is word-bounded and case-insensitive and always finds
 * EVERY occurrence; callers get fresh regex instances so no `lastIndex`
 * state leaks between calls.
 *
 * A word filter is not proof of correctness: it flags wording for a human
 * to review (or redacts it in structured output); it never certifies text.
 */

export const STRENGTH_PHRASES: readonly string[] = [
    "strong",
    "weak",
    "winner",
    "winners",
    "hopeless",
    "likely to win",
    "likely to lose",
    "likely to succeed",
    "likely to fail",
    "will succeed",
    "will fail",
    "will win",
    "will lose",
    "good prospects",
    "poor prospects",
    "strong prospects",
    "weak prospects",
    "bound to",
    "certain to win",
    "certain to lose",
    "open and shut",
    "slam dunk",
];

/** Percentages in any of the usual spellings. */
export const PERCENTAGE_SOURCE = String.raw`\d{1,3}(?:\.\d+)?\s?%|\d{1,3}(?:\.\d+)?\s?(?:per\s?cent|percent)\b|\bper\s?cent\b|\bpercent\b`;

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

const STRENGTH_SOURCE = `\\b(?:${STRENGTH_PHRASES.map(escapeRe).join("|")})\\b`;

/** Fresh global, case-insensitive regex for strength/outcome language. */
export function strengthLanguageRegex(): RegExp {
    return new RegExp(STRENGTH_SOURCE, "gi");
}

/** Fresh global, case-insensitive regex for percentages. */
export function percentageRegex(): RegExp {
    return new RegExp(PERCENTAGE_SOURCE, "gi");
}

/** Fresh regex matching either kind (used by the structured-output sanitiser). */
export function forbiddenLanguageRegex(): RegExp {
    return new RegExp(`${STRENGTH_SOURCE}|${PERCENTAGE_SOURCE}`, "gi");
}

export interface LanguageMatch {
    text: string;
    index: number;
}

/** Every strength/outcome or percentage match in `text`, in order. */
export function findForbiddenLanguage(text: string): LanguageMatch[] {
    const out: LanguageMatch[] = [];
    const re = forbiddenLanguageRegex();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        out.push({ text: m[0], index: m.index });
        if (m[0].length === 0) re.lastIndex++;
    }
    return out;
}

export function findStrengthLanguage(text: string): LanguageMatch[] {
    const out: LanguageMatch[] = [];
    const re = strengthLanguageRegex();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ text: m[0], index: m.index });
    return out;
}

export function findPercentages(text: string): LanguageMatch[] {
    const out: LanguageMatch[] = [];
    const re = percentageRegex();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ text: m[0], index: m.index });
    return out;
}

export function containsForbiddenLanguage(text: string): boolean {
    return forbiddenLanguageRegex().test(text);
}

/** Replace EVERY forbidden match with the placeholder. */
export function redactForbiddenLanguage(text: string, placeholder = "[assessment removed]"): string {
    return text.replace(forbiddenLanguageRegex(), placeholder);
}
