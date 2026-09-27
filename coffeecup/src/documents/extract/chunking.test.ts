import { describe, it, expect } from "vitest";
import { splitIntoChunks, locateQuote, normaliseTitle, eventKey, pageForOffset, coverageFor, CHUNK_SIZE, CHUNK_OVERLAP } from "./chunking";

describe("splitIntoChunks", () => {
    it("returns one window for short text", () => {
        const c = splitIntoChunks("hello world");
        expect(c).toEqual([{ index: 0, start: 0, end: 11, text: "hello world" }]);
    });
    it("covers every character with overlapping windows and offsets that map back to the source", () => {
        let text = "";
        for (let i = 0; text.length < 100_000; i++) text += `w${i} `;
        const chunks = splitIntoChunks(text);
        expect(chunks.length).toBeGreaterThanOrEqual(3);
        expect(chunks[0].start).toBe(0);
        expect(chunks[chunks.length - 1].end).toBe(text.length);
        for (const c of chunks) {
            expect(text.slice(c.start, c.end)).toBe(c.text);
            expect(c.text.length).toBeLessThanOrEqual(CHUNK_SIZE);
        }
        for (let i = 1; i < chunks.length; i++) {
            const gap = chunks[i].start - chunks[i - 1].end;
            expect(gap).toBeLessThanOrEqual(0); // overlaps, never skips
            expect(chunks[i - 1].end - chunks[i].start).toBeLessThanOrEqual(CHUNK_OVERLAP);
        }
    });
    it("breaks at whitespace rather than mid-word where it can", () => {
        const text = Array.from({ length: 5000 }, (_, i) => `word${i}`).join(" ");
        const chunks = splitIntoChunks(text, 1000, 100);
        for (const c of chunks.slice(0, -1)) expect(/\s$/.test(c.text)).toBe(true);
    });
});

describe("locateQuote", () => {
    const text = "Dear Ms Patel,\n\nYou were   suspended on 20 January 2026 pending\ninvestigation. It’s “serious”.";
    it("finds a quote ignoring case and whitespace differences and returns original offsets", () => {
        const loc = locateQuote(text, "you were suspended ON 20 january 2026 pending investigation.")!;
        expect(loc).not.toBeNull();
        expect(text.slice(loc.startOffset, loc.endOffset)).toBe("You were   suspended on 20 January 2026 pending\ninvestigation.");
    });
    it("treats curly and straight quotes as equivalent", () => {
        const loc = locateQuote(text, `It's "serious".`)!;
        expect(text.slice(loc.startOffset, loc.endOffset)).toBe("It’s “serious”.");
    });
    it("returns null when the quote is not in the source", () => {
        expect(locateQuote(text, "the worker admitted theft")).toBeNull();
        expect(locateQuote(text, null)).toBeNull();
        expect(locateQuote(text, "")).toBeNull();
    });
});

describe("normalisation keys", () => {
    it("treats punctuation/case/whitespace variants of a title as the same event", () => {
        expect(normaliseTitle("Suspended  pending investigation!")).toBe("suspended pending investigation");
        expect(eventKey("2026-01-20", "Suspended, pending investigation")).toBe(eventKey("2026-01-20", "suspended pending   investigation"));
        expect(eventKey("2026-01-21", "Suspended")).not.toBe(eventKey("2026-01-20", "Suspended"));
    });
});

describe("pageForOffset", () => {
    const pages = [{ page: 1, startOffset: 0, endOffset: 100 }, { page: 2, startOffset: 102, endOffset: 250 }];
    it("maps offsets to pages, attributing join whitespace to the preceding page", () => {
        expect(pageForOffset(pages, 0)).toBe(1);
        expect(pageForOffset(pages, 99)).toBe(1);
        expect(pageForOffset(pages, 101)).toBe(1);
        expect(pageForOffset(pages, 102)).toBe(2);
        expect(pageForOffset(pages, 249)).toBe(2);
        expect(pageForOffset([], 5)).toBeNull();
        expect(pageForOffset(null, 5)).toBeNull();
    });
});

describe("coverageFor", () => {
    it("counts distinct characters covered by successful chunks", () => {
        const chunks = splitIntoChunks("x".repeat(100), 40, 10);
        expect(chunks.map((c) => [c.start, c.end])).toEqual([[0, 40], [30, 70], [60, 100]]);
        expect(coverageFor(100, chunks, new Set([0, 1, 2]), false)).toEqual({ totalChars: 100, charsSent: 100, chunks: 3, chunksSucceeded: 3, truncated: false });
        expect(coverageFor(100, chunks, new Set([0, 2]), false).charsSent).toBe(80);
        expect(coverageFor(100, chunks, new Set(), true)).toMatchObject({ charsSent: 0, chunksSucceeded: 0, truncated: true });
    });
});
