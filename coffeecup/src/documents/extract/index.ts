/**
 * Text extraction for uploaded documents.
 *
 * Extracted text is never treated as perfectly reliable. The pipeline keeps
 * original → extraction → parsed propositions → user-confirmed facts as
 * distinct layers; this module only produces the second, and it says what it
 * did and did not manage to read (`detail`) so the job can never report an
 * unqualified success for a partially read file.
 */

import { pdfBufferToMarkdown, tidyToMarkdown } from "./pdf";
import { parseEmlBuffer } from "./eml";
import { getOcrProvider, canRasterisePdf, recognisePdf, OCR_MIN_CHARS, OCR_MIN_CONFIDENCE, type OcrPage } from "./ocr";
import type { PageBoundary } from "./chunking";
import type { ExtractionReport } from "@/db/schema";

export { parseEml } from "./eml";

/** What the reader covered. Mirrors the persisted `ExtractionReport.coverage` fields. */
export interface ExtractionDetail {
    /** "text" | "eml" | "pdf" | "docx" | "ocr" | "none" */
    method: string;
    parts?: ExtractionReport["coverage"]["parts"];
    pages?: ExtractionReport["coverage"]["pages"];
    attachments?: ExtractionReport["attachments"];
    /** Offsets of each page's text in `text` (PDF/OCR), for quote → page mapping. */
    pageBoundaries?: PageBoundary[];
    pageCount?: number | null;
}

export type ExtractionOutcome =
    /** Everything readable was read. */
    | { status: "completed"; text: string; note?: string; detail: ExtractionDetail }
    /** Some content was read but some could not be (e.g. an undecodable email part). */
    | { status: "partial"; text: string; note: string; detail: ExtractionDetail }
    /** The type is kept as evidence but not read (image without OCR). */
    | { status: "unsupported"; text: null; note: string; detail: ExtractionDetail }
    /** Text may exist but is too thin or too uncertain to propose from. */
    | { status: "requires_review"; text: string | null; note: string; detail: ExtractionDetail }
    /** Nothing could be read. */
    | { status: "failed"; text: null; note: string; detail: ExtractionDetail };

export const SUPPORTED_MIME_TYPES: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/markdown": "txt",
    "message/rfc822": "eml",
    "image/png": "image",
    "image/jpeg": "image",
    "image/webp": "image",
    "image/heic": "image",
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const IMAGE_UNSUPPORTED_NOTE = "Images are kept as evidence but their text is not read automatically. Add a description and link the image to the relevant event.";
export const SCANNED_PDF_NOTE = "No readable text was found. This PDF may be a scan; you can still describe it and link it to events by hand.";

export function kindForUpload(mimeType: string, filename: string): string | null {
    const byMime = SUPPORTED_MIME_TYPES[mimeType.toLowerCase()];
    if (byMime) return byMime;
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    if (ext === "pdf") return "pdf";
    if (ext === "docx") return "docx";
    if (ext === "txt" || ext === "md") return "txt";
    if (ext === "eml") return "eml";
    if (["png", "jpg", "jpeg", "webp", "heic"].includes(ext)) return "image";
    return null;
}

/** Turn OCR pages into text + a quality report. Exported for tests. */
export function assembleOcrPages(pages: OcrPage[]): { text: string; pageBoundaries: PageBoundary[]; pageReport: NonNullable<ExtractionReport["coverage"]["pages"]>; meanConfidence: number | null } {
    let text = "";
    const pageBoundaries: PageBoundary[] = [];
    const pageReport: NonNullable<ExtractionReport["coverage"]["pages"]> = [];
    let confSum = 0;
    let confN = 0;
    for (const p of pages) {
        const t = tidyToMarkdown(p.text);
        pageReport.push({ page: p.page, chars: t.length, confidence: p.confidence });
        if (p.confidence != null) {
            confSum += p.confidence;
            confN++;
        }
        if (!t) continue;
        if (text) text += "\n\n";
        pageBoundaries.push({ page: p.page, startOffset: text.length, endOffset: text.length + t.length });
        text += t;
    }
    return { text, pageBoundaries, pageReport, meanConfidence: confN ? confSum / confN : null };
}

function ocrOutcome(pages: OcrPage[], pageCount: number, providerName: string): ExtractionOutcome {
    const { text, pageBoundaries, pageReport, meanConfidence } = assembleOcrPages(pages);
    const detail: ExtractionDetail = { method: "ocr", pages: pageReport, pageBoundaries, pageCount };
    if (text.length < OCR_MIN_CHARS) {
        return { status: "requires_review", text: text || null, note: `Text recognition (${providerName}) found very little readable text. Add a description and link the image to the relevant event.`, detail };
    }
    if (meanConfidence != null && meanConfidence < OCR_MIN_CONFIDENCE) {
        return { status: "requires_review", text, note: `Text recognition confidence was low (${Math.round(meanConfidence * 100)}%). Check the wording against the original before relying on any suggestion.`, detail };
    }
    return { status: "completed", text, note: meanConfidence == null ? "Text recognised by OCR; the engine did not report a confidence." : undefined, detail };
}

export async function extractText(kind: string, body: Buffer): Promise<ExtractionOutcome> {
    try {
        if (kind === "txt") {
            const text = tidyToMarkdown(body.toString("utf8"));
            const detail: ExtractionDetail = { method: "text" };
            return text ? { status: "completed", text, detail } : { status: "requires_review", text: "", note: "The file was empty.", detail };
        }
        if (kind === "eml") {
            const r = parseEmlBuffer(body);
            const detail: ExtractionDetail = { method: "eml", parts: r.parts, attachments: r.attachments };
            if (r.status === "failed") return { status: "failed", text: null, note: r.note ?? "The email could not be read.", detail };
            if (r.status === "partial") return { status: "partial", text: r.text, note: r.note ?? "Part of the email could not be read.", detail };
            if (!r.text) return { status: "requires_review", text: "", note: "No readable email content was found.", detail };
            return { status: "completed", text: r.text, note: r.note, detail };
        }
        if (kind === "pdf") {
            const res = await pdfBufferToMarkdown(body);
            if (res.status === "ok" && res.markdown) {
                return { status: "completed", text: res.markdown, detail: { method: "pdf", pageBoundaries: res.pageBoundaries, pageCount: res.pages ?? null } };
            }
            if (res.status === "empty") {
                // No text layer: try OCR when it is configured AND we can rasterise pages.
                const ocr = await getOcrProvider();
                if (ocr && (await canRasterisePdf())) {
                    try {
                        const r = await recognisePdf(ocr, body);
                        return ocrOutcome(r.pages, res.pages ?? r.pages.length, ocr.name);
                    } catch (err) {
                        return { status: "requires_review", text: null, note: `${SCANNED_PDF_NOTE} (OCR failed: ${err instanceof Error ? err.message : "unknown error"}.)`, detail: { method: "pdf", pageCount: res.pages ?? null } };
                    }
                }
                const why = ocr ? " Scanned-PDF OCR needs pdftoppm (poppler-utils) on the server." : "";
                return { status: "requires_review", text: null, note: `${SCANNED_PDF_NOTE}${why}`, detail: { method: "pdf", pageCount: res.pages ?? null } };
            }
            return { status: "failed", text: null, note: res.detail ?? "The PDF could not be read.", detail: { method: "pdf" } };
        }
        if (kind === "docx") {
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({ buffer: body });
            const text = tidyToMarkdown(result.value ?? "");
            const detail: ExtractionDetail = { method: "docx" };
            return text ? { status: "completed", text, detail } : { status: "requires_review", text: "", note: "The Word document had no readable text.", detail };
        }
        if (kind === "image") {
            const ocr = await getOcrProvider();
            if (!ocr) return { status: "unsupported", text: null, note: IMAGE_UNSUPPORTED_NOTE, detail: { method: "none" } };
            const r = await ocr.recognise(body, "image");
            return ocrOutcome(r.pages, 1, ocr.name);
        }
        return { status: "unsupported", text: null, note: "This file type is not supported.", detail: { method: "none" } };
    } catch (err) {
        return { status: "failed", text: null, note: err instanceof Error ? err.message : "Extraction failed.", detail: { method: "none" } };
    }
}
