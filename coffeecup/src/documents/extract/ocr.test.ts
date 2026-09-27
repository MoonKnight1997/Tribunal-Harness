import { describe, it, expect, afterAll, afterEach, beforeAll } from "vitest";
import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import { createCase } from "@/cases/service";
import { uploadDocument } from "@/documents/service";
import { listProposedEvents } from "@/timeline/service";
import { extractText } from "./index";
import { getOcrProvider, parseTesseractTsv, setOcrProviderForTests, TesseractCliOcr, type OcrProvider } from "./ocr";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeOcr(pages: Array<{ page: number; text: string; confidence: number | null }>): OcrProvider {
    return { name: "fake_ocr", available: async () => true, recognise: async () => ({ pages }) };
}

let alice: { userId: string };
let caseId: string;

beforeAll(async () => {
    const a = await signUp({ email: "ocr@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
    caseId = (await createCase(alice, { entryRoute: "disciplinary" })).id;
});

afterEach(() => setOcrProviderForTests(undefined));

afterAll(async () => {
    await closeDb();
});

describe("OCR capability", () => {
    it("is absent by default: images stay unsupported with the manual-fallback message", async () => {
        delete process.env.OCR_PROVIDER;
        setOcrProviderForTests(undefined);
        expect(await getOcrProvider()).toBeNull();
        const res = await extractText("image", PNG);
        expect(res.status).toBe("unsupported");
        expect(res.note).toMatch(/kept as evidence/);
    });

    it("is absent when configured but the binary is missing", async () => {
        process.env.OCR_PROVIDER = "tesseract_cli";
        process.env.TESSERACT_BIN = "/definitely/not/installed/tesseract";
        setOcrProviderForTests(undefined);
        expect(await getOcrProvider()).toBeNull();
        expect(await new TesseractCliOcr("/definitely/not/installed/tesseract").available()).toBe(false);
        expect((await extractText("image", PNG)).status).toBe("unsupported");
    });

    it("parses tesseract TSV into lines/paragraphs with a mean word confidence", () => {
        const tsv = [
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
            "1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t",
            "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t96\tHearing",
            "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t90\ton",
            "5\t1\t1\t1\t2\t1\t0\t0\t10\t10\t80\t3",
            "5\t1\t1\t1\t2\t2\t0\t0\t10\t10\t70\tMarch",
            "5\t1\t1\t2\t1\t1\t0\t0\t10\t10\t64\tRegards",
        ].join("\n");
        const r = parseTesseractTsv(tsv);
        expect(r.text).toBe("Hearing on\n3 March\n\nRegards");
        expect(r.confidence).toBe(0.8);
    });

    it("with an injected provider, image text is read with page identity and a quality report", async () => {
        setOcrProviderForTests(fakeOcr([
            { page: 1, text: "Dear Priya, you are invited to a disciplinary hearing on 3 March 2026 at 10am.", confidence: 0.93 },
            { page: 2, text: "You were suspended on 20 January 2026 pending investigation.", confidence: 0.88 },
        ]));
        const res = await extractText("image", PNG);
        expect(res.status).toBe("completed");
        expect(res.detail.method).toBe("ocr");
        expect(res.detail.pages).toEqual([{ page: 1, chars: expect.any(Number), confidence: 0.93 }, { page: 2, chars: expect.any(Number), confidence: 0.88 }]);
        expect(res.detail.pageBoundaries).toHaveLength(2);

        const { document } = await uploadDocument(alice, caseId, { filename: "scan.png", mimeType: "image/png", body: PNG });
        expect(document.extractionStatus).toBe("completed");
        expect(document.extractionReport?.method).toBe("ocr");
        expect(document.extractionReport?.coverage.pages?.map((p) => p.page)).toEqual([1, 2]);
        const proposed = (await listProposedEvents(alice, caseId)).filter((e) => e.sourceDocumentIds.includes(document.id));
        expect(proposed.length).toBeGreaterThanOrEqual(2);
        const hearing = proposed.find((e) => e.date === "2026-03-03")!;
        const suspension = proposed.find((e) => e.date === "2026-01-20")!;
        expect(hearing.quoteVerified).toBe(true);
        expect(hearing.sourceLocation?.page).toBe(1);
        expect(suspension.sourceLocation?.page).toBe(2);
        expect(proposed.every((e) => e.status === "proposed")).toBe(true);
    });

    it("marks low-confidence OCR as requires_review instead of proposing from it silently", async () => {
        setOcrProviderForTests(fakeOcr([{ page: 1, text: "Yuo wer3 dism1ssed on 3 Mrch 2026 for gross m1sconduct, see attached.", confidence: 0.41 }]));
        const res = await extractText("image", PNG);
        expect(res.status).toBe("requires_review");
        expect(res.note).toMatch(/confidence was low \(41%\)/);
        const { document } = await uploadDocument(alice, caseId, { filename: "blurry.jpg", mimeType: "image/jpeg", body: PNG });
        expect(document.extractionStatus).toBe("requires_review");
        expect(document.extractionReport?.coverage.pages?.[0].confidence).toBe(0.41);
        expect(document.extractedText).toMatch(/dism1ssed/); // text kept for the user to check
    });

    it("marks very short OCR output as requires_review", async () => {
        setOcrProviderForTests(fakeOcr([{ page: 1, text: "HR", confidence: 0.99 }]));
        const res = await extractText("image", PNG);
        expect(res.status).toBe("requires_review");
        expect(res.note).toMatch(/very little readable text/);
    });
});
