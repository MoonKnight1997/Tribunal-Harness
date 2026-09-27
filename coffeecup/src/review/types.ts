/**
 * Evidence inbox payload types. Pure: no server imports, so client components
 * may import from here. The server builds these in `src/review/service.ts`.
 *
 * Deliberately absent: any numeric model confidence. Provenance and whether
 * the quoted passage was found in the document are the trust signals.
 */

import type { SourceLocation } from "@/db/schema";

export type ReviewKind = "event" | "fact" | "allegation";
export type ProvenanceLabel = "The document says" | "The employer alleges" | "The model inferred" | "You said";
export type ReviewAction = "confirm" | "correct" | "reject" | "accept_as_allegation" | "withdraw";
export type ConflictKind = "differs_from_confirmed" | "possible_duplicate" | "unverified_quote";

export interface ReviewExcerpt {
    before: string;
    match: string;
    after: string;
}

export interface ReviewSource {
    documentId: string | null;
    filename: string | null;
    /** The verbatim passage the proposal was drawn from, when the pipeline recorded one. */
    quote: string | null;
    /** True when the passage was found in the extracted text; false when the pipeline checked and it was not; null when nothing was checked. */
    quoteVerified: boolean | null;
    location: SourceLocation | null;
    excerpt: ReviewExcerpt | null;
    page: number | null;
}

export interface ReviewConflict {
    kind: ConflictKind;
    message: string;
    /** The confirmed row this proposal clashes with (fact id or event id). */
    relatedId?: string;
    /** For differs_from_confirmed: the value currently confirmed, for the "keep" option. */
    confirmedValue?: string | null;
}

export interface ReviewItem {
    id: string;
    kind: ReviewKind;
    title: string;
    detail: string | null;
    date: string | null;
    /** "exact" | "approximate" | "month" | "year" for facts; "approximate"/"exact" for events. */
    datePrecision: string | null;
    provenanceLabel: ProvenanceLabel;
    /** Structured fact key, when the proposal is a structured fact. */
    factKey: string | null;
    factValue: string | null;
    /** Process the allegation belongs to (allegations only). */
    processId: string | null;
    source: ReviewSource;
    conflicts: ReviewConflict[];
    actions: ReviewAction[];
}

export interface ReviewQueue {
    items: ReviewItem[];
    remaining: number;
    byKind: { events: number; facts: number; allegations: number };
}
