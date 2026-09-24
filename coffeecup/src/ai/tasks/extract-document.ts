/**
 * Task: extract_document_v1
 *
 * Reads a document's extracted text and PROPOSES: a document type, a document
 * date, author/recipients, a short summary, candidate timeline events,
 * candidate structured facts and (for disciplinary material) the employer's
 * allegations. Everything is a proposal for the review queue.
 */

import { z } from "zod";
import { DOCUMENT_TYPES, EVENT_CATEGORIES } from "@/db/schema";
import { isIsoDate } from "@/lib/dates";
import type { LLMProvider } from "../provider";

const isoOrNull = z.string().nullable().transform((v) => (v && isIsoDate(v) ? v : null));

export const ExtractDocumentOutput = z.object({
    documentType: z.enum(DOCUMENT_TYPES).catch("unknown"),
    documentDate: isoOrNull,
    author: z.string().max(200).nullable().catch(null),
    recipients: z.array(z.string().max(200)).catch([]),
    summary: z.string().max(2000),
    events: z
        .array(
            z.object({
                date: z.string(),
                dateEnd: isoOrNull.optional(),
                approximate: z.boolean().catch(false),
                title: z.string().min(1).max(300),
                description: z.string().max(4000).nullable().catch(null),
                category: z.enum(EVENT_CATEGORIES).catch("other"),
                confidence: z.number().min(0).max(100).catch(50),
                quote: z.string().max(400).nullable().catch(null),
            }),
        )
        .max(50)
        .catch([]),
    facts: z
        .array(
            z.object({
                statement: z.string().min(3).max(2000),
                key: z.string().max(80).nullable().catch(null),
                value: z.string().max(400).nullable().catch(null),
                provenance: z.enum(["DOCUMENT_EXTRACTED", "EMPLOYER_ALLEGATION"]).catch("DOCUMENT_EXTRACTED"),
                confidence: z.number().min(0).max(100).catch(50),
                quote: z.string().max(400).nullable().catch(null),
            }),
        )
        .max(50)
        .catch([]),
    allegations: z.array(z.object({ allegation: z.string().min(3).max(2000), evidence: z.string().max(2000).nullable().catch(null) })).max(30).catch([]),
});
export type ExtractDocumentOutput = z.infer<typeof ExtractDocumentOutput>;

export const EXTRACT_DOCUMENT_SYSTEM = `You read a document from a UK workplace dispute and extract structured information for a chronology.

RULES
- Extract only what the text actually says. Never invent dates, names, allegations or events.
- Dates must be ISO YYYY-MM-DD. If a date is partial or unclear, set "approximate": true and use the earliest plausible date, or omit the event.
- An employer's statement that the worker did something is an ALLEGATION, not a fact: put it in "allegations" and, if you also list it as a fact, use provenance "EMPLOYER_ALLEGATION".
- Quote the sentence you relied on in "quote" so the reader can check it.
- Confidence is 0-100 and should be low when the text is ambiguous.
- Do not give legal opinions, assess merits or suggest claims.`;

export const EXTRACT_DOCUMENT_SCHEMA_DESCRIPTION = `{
  "documentType": one of ${DOCUMENT_TYPES.map((d) => `"${d}"`).join(" | ")},
  "documentDate": "YYYY-MM-DD" | null,
  "author": string | null,
  "recipients": string[],
  "summary": string (max 2 sentences, plain English),
  "events": [{ "date": "YYYY-MM-DD", "dateEnd": "YYYY-MM-DD" | null, "approximate": boolean, "title": string, "description": string | null, "category": one of ${EVENT_CATEGORIES.map((c) => `"${c}"`).join(" | ")}, "confidence": 0-100, "quote": string | null }],
  "facts": [{ "statement": string, "key": "dismissal_date" | "employment_start" | "employment_end" | "date_of_last_act" | "acas_day_a" | "acas_day_b" | null, "value": string | null, "provenance": "DOCUMENT_EXTRACTED" | "EMPLOYER_ALLEGATION", "confidence": 0-100, "quote": string | null }],
  "allegations": [{ "allegation": string, "evidence": string | null }]
}`;

export async function runExtractDocument(provider: LLMProvider, input: { text: string; filename: string; userDescription?: string | null }) {
    return provider.structuredGenerate({
        task: "extract_document_v1",
        capability: "extraction",
        system: EXTRACT_DOCUMENT_SYSTEM,
        input: JSON.stringify({ filename: input.filename, userDescription: input.userDescription ?? null, text: input.text.slice(0, 60_000) }),
        schema: ExtractDocumentOutput,
        schemaDescription: EXTRACT_DOCUMENT_SCHEMA_DESCRIPTION,
        maxOutputTokens: 6000,
        temperature: 0.1,
    });
}
