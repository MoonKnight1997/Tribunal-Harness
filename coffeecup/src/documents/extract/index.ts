/**
 * Text extraction for uploaded documents.
 *
 * Extracted text is never treated as perfectly reliable. The pipeline keeps
 * original → extraction → parsed propositions → user-confirmed facts as
 * distinct layers; this module only produces the second.
 */

import { pdfBufferToMarkdown, tidyToMarkdown } from "./pdf";

export type ExtractionOutcome =
    | { status: "completed"; text: string; note?: string }
    | { status: "unsupported"; text: null; note: string }
    | { status: "requires_review"; text: string | null; note: string }
    | { status: "failed"; text: null; note: string };

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

/** Minimal RFC 822 parsing: headers + body, good enough for exported emails. */
export function parseEml(raw: string): string {
    const split = raw.indexOf("\n\n");
    const headerBlock = split === -1 ? raw : raw.slice(0, split);
    const body = split === -1 ? "" : raw.slice(split + 2);
    const headers: Record<string, string> = {};
    for (const line of headerBlock.split(/\r?\n/)) {
        const m = line.match(/^(From|To|Cc|Date|Subject):\s*(.*)$/i);
        if (m) headers[m[1].toLowerCase()] = m[2].trim();
    }
    const head = ["from", "to", "cc", "date", "subject"].filter((k) => headers[k]).map((k) => `${k[0].toUpperCase()}${k.slice(1)}: ${headers[k]}`);
    return tidyToMarkdown(`${head.join("\n")}\n\n${body}`);
}

export async function extractText(kind: string, body: Buffer): Promise<ExtractionOutcome> {
    try {
        if (kind === "txt") {
            const text = tidyToMarkdown(body.toString("utf8"));
            return text ? { status: "completed", text } : { status: "requires_review", text: "", note: "The file was empty." };
        }
        if (kind === "eml") {
            const text = parseEml(body.toString("utf8"));
            return text ? { status: "completed", text } : { status: "requires_review", text: "", note: "No readable email content was found." };
        }
        if (kind === "pdf") {
            const res = await pdfBufferToMarkdown(body);
            if (res.status === "ok" && res.markdown) return { status: "completed", text: res.markdown };
            if (res.status === "empty") return { status: "requires_review", text: null, note: "No readable text was found. This PDF may be a scan; you can still describe it and link it to events by hand." };
            return { status: "failed", text: null, note: res.detail ?? "The PDF could not be read." };
        }
        if (kind === "docx") {
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({ buffer: body });
            const text = tidyToMarkdown(result.value ?? "");
            return text ? { status: "completed", text } : { status: "requires_review", text: "", note: "The Word document had no readable text." };
        }
        if (kind === "image") {
            return { status: "unsupported", text: null, note: "Images are kept as evidence but their text is not read automatically. Add a description and link the image to the relevant event." };
        }
        return { status: "unsupported", text: null, note: "This file type is not supported." };
    } catch (err) {
        return { status: "failed", text: null, note: err instanceof Error ? err.message : "Extraction failed." };
    }
}
