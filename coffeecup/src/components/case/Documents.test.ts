import { describe, it, expect } from "vitest";
import { reportSummary, type ReportView } from "./Documents";

const base: ReportView = {
    coverage: { totalChars: 1000, charsSent: 1000, chunks: 1, chunksSucceeded: 1, truncated: false },
    diagnostics: [],
    counts: { events: 2, facts: 1, allegations: 0, duplicatesSkipped: 0, quotesUnverified: 0 },
    method: "text",
};

describe("reportSummary", () => {
    it("says nothing while a document is still being read", () => {
        expect(reportSummary({ extractionStatus: "processing", extractionReport: base, pageCount: null })).toEqual([]);
        expect(reportSummary({ extractionStatus: "completed", extractionReport: null, pageCount: null })).toEqual([]);
    });
    it("describes sections, attachments, dropped items and OCR confidence in plain English", () => {
        const lines = reportSummary({
            extractionStatus: "partial",
            pageCount: 3,
            extractionReport: {
                ...base,
                method: "ocr",
                coverage: { totalChars: 90_000, charsSent: 60_000, chunks: 3, chunksSucceeded: 2, truncated: false, pages: [{ page: 1, chars: 400, confidence: 0.5 }, { page: 2, chars: 300, confidence: 0.55 }] },
                attachments: [{ filename: "payslip.pdf", contentType: "application/pdf", sizeBytes: 1200 }],
                diagnostics: [{ chunk: 0, kind: "event", index: 3, problem: "date: bad" }, { chunk: 1, kind: "fact", index: 0, problem: "statement: too short" }, { chunk: -1, kind: "document", index: -1, problem: "informational" }],
                counts: { events: 4, facts: 0, allegations: 1, duplicatesSkipped: 2, quotesUnverified: 1 },
            },
        });
        expect(lines).toEqual([
            "Read 2 of 3 sections",
            "1 attachment not read: payslip.pdf",
            "2 suggested items could not be used",
            "1 suggestion could not be matched to the wording — check before confirming",
            "2 duplicate suggestions skipped",
            "OCR confidence low — check the wording",
            "3 pages",
            "4 events, 0 facts, 1 allegation suggested",
        ]);
    });
    it("reports truncation", () => {
        const lines = reportSummary({ extractionStatus: "partial", pageCount: null, extractionReport: { ...base, coverage: { ...base.coverage, totalChars: 1_550_000, charsSent: 1_500_000, chunks: 38, chunksSucceeded: 38, truncated: true } } });
        expect(lines[0]).toBe("Read 38 of 38 sections");
        expect(lines[1]).toBe("Only the first 1,500,000 of 1,550,000 characters were read");
    });
});
