/**
 * Pure helpers for extraction fidelity: windowing long text, locating a
 * model-supplied quote in the source, and the normalisation used to detect
 * equivalent proposals (across chunks and across retries).
 *
 * No I/O and no model calls, so every rule here is unit-testable.
 */

/** Window size sent to the model per call, in characters. */
export const CHUNK_SIZE = 40_000;
/** Overlap between adjacent windows so a sentence on a boundary is seen whole at least once. */
export const CHUNK_OVERLAP = 1_000;
/** Absolute cap on text considered for extraction. Beyond this the run is reported as truncated. */
export const HARD_CAP_CHARS = 1_500_000;

export interface Chunk {
    /** 0-based window index. */
    index: number;
    /** Offset of the first character of this window in the source text. */
    start: number;
    /** Offset one past the last character. */
    end: number;
    text: string;
}

/** Split text into overlapping windows, breaking at whitespace where possible. */
export function splitIntoChunks(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): Chunk[] {
    if (size <= 0) throw new Error("chunk size must be positive");
    if (overlap < 0 || overlap >= size) throw new Error("overlap must be smaller than the chunk size");
    if (text.length <= size) return [{ index: 0, start: 0, end: text.length, text }];
    const chunks: Chunk[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + size, text.length);
        if (end < text.length) {
            // Prefer to end on whitespace within the last 5% of the window.
            const floor = end - Math.floor(size * 0.05);
            for (let i = end; i > floor; i--) {
                if (/\s/.test(text[i - 1])) {
                    end = i;
                    break;
                }
            }
        }
        chunks.push({ index: chunks.length, start, end, text: text.slice(start, end) });
        if (end >= text.length) break;
        start = Math.max(end - overlap, start + 1);
    }
    return chunks;
}

/** Lower-case, straighten curly quotes/dashes, collapse whitespace. Used for quote matching. */
export function normaliseForMatch(s: string): string {
    return s
        .toLowerCase()
        .replace(/[‘’‚′]/g, "'")
        .replace(/[“”„″]/g, '"')
        .replace(/[–—−]/g, "-")
        .replace(/ /g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** Normalised key for "the same event title" / "the same statement". */
export function normaliseTitle(s: string): string {
    return normaliseForMatch(s)
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function eventKey(date: string, title: string): string {
    return `${date}|${normaliseTitle(title)}`;
}

export function statementKey(statement: string): string {
    return normaliseTitle(statement);
}

/**
 * Find `quote` in `text`, case-insensitive and whitespace-normalised. Returns
 * offsets into the ORIGINAL text, or null when the quote is not present.
 */
export function locateQuote(text: string, quote: string | null | undefined): { startOffset: number; endOffset: number } | null {
    if (!quote) return null;
    const needle = normaliseForMatch(quote);
    if (needle.length < 3) return null;

    // Build a normalised haystack with a map back to original offsets.
    const map: number[] = [];
    let hay = "";
    let pendingSpace = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (/\s/.test(ch) || ch === " ") {
            pendingSpace = hay.length > 0;
            continue;
        }
        if (pendingSpace) {
            hay += " ";
            map.push(i);
            pendingSpace = false;
        }
        const norm = normaliseForMatch(ch);
        // normaliseForMatch on a single character yields "" for whitespace (handled above) or one char.
        hay += norm || ch.toLowerCase();
        map.push(i);
    }
    const at = hay.indexOf(needle);
    if (at === -1) return null;
    const startOffset = map[at];
    const endOffset = map[at + needle.length - 1] + 1;
    return { startOffset, endOffset };
}

export interface PageBoundary {
    /** 1-based page number. */
    page: number;
    startOffset: number;
    endOffset: number;
}

/** Which page an offset falls on, given page boundaries in the extracted text. */
export function pageForOffset(pages: PageBoundary[] | null | undefined, offset: number): number | null {
    if (!pages || pages.length === 0) return null;
    for (const p of pages) if (offset >= p.startOffset && offset < p.endOffset) return p.page;
    // Offsets in the joins between pages belong to the preceding page.
    let last: PageBoundary | null = null;
    for (const p of pages) if (p.startOffset <= offset) last = p;
    return last?.page ?? null;
}

/** Coverage manifest for a chunked run. `charsSent` counts distinct source characters covered by successful windows. */
export interface CoverageManifest {
    totalChars: number;
    charsSent: number;
    chunks: number;
    chunksSucceeded: number;
    truncated: boolean;
}

export function coverageFor(totalChars: number, chunks: Chunk[], succeeded: ReadonlySet<number>, truncated: boolean): CoverageManifest {
    // Distinct coverage: merge the [start, end) ranges of successful chunks.
    const ranges = chunks.filter((c) => succeeded.has(c.index)).map((c) => [c.start, c.end] as const).sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let cursor = -1;
    for (const [s, e] of ranges) {
        const from = Math.max(s, cursor);
        if (e > from) covered += e - from;
        cursor = Math.max(cursor, e);
    }
    return { totalChars, charsSent: covered, chunks: chunks.length, chunksSucceeded: succeeded.size, truncated };
}
