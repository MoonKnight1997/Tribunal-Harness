/**
 * Evidence inbox — one review queue for everything a document or the model
 * has PROPOSED and the user has not yet decided on: events, facts and the
 * employer's allegations.
 *
 * The queue puts the source passage beside each proposal so the user can check
 * it without opening the file. The excerpt is computed here, server-side, from
 * the document's extracted text; the client never receives the whole document.
 *
 * Trust signals are provenance ("The document says" / "The employer alleges" /
 * "The model inferred") and whether the quoted passage was actually found in
 * the text. Numeric model confidence is deliberately not exposed: it is not a
 * calibrated reliability score and must not be read as one.
 *
 * Nothing here changes state. Decisions go through the existing timeline,
 * facts and processes services, which enforce provenance rules and staleness.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { allegations, documents, events, facts, type Provenance, type SourceLocation } from "@/db/schema";
import { requireCaseAccess, type Actor } from "@/cases/access";
import { formatLongDate } from "@/lib/dates";

import type { ProvenanceLabel, ReviewConflict, ReviewExcerpt, ReviewItem, ReviewQueue, ReviewSource } from "./types";

export type { ConflictKind, ProvenanceLabel, ReviewAction, ReviewConflict, ReviewExcerpt, ReviewItem, ReviewKind, ReviewQueue, ReviewSource } from "./types";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const EXCERPT_CONTEXT = 240;

/** Move `pos` outwards to the nearest whitespace so the excerpt does not cut a word. */
function snapBack(text: string, pos: number): number {
    let p = Math.max(0, Math.min(pos, text.length));
    while (p > 0 && !/\s/.test(text[p - 1])) p--;
    return p;
}
function snapForward(text: string, pos: number): number {
    let p = Math.max(0, Math.min(pos, text.length));
    while (p < text.length && !/\s/.test(text[p])) p++;
    return p;
}

function tidy(s: string): string {
    return s.replace(/\s+/g, " ");
}

/**
 * Build a short excerpt of `text` around the passage a proposal came from.
 * Uses `location.startOffset/endOffset` when they are usable; otherwise looks
 * for `quote` (case-insensitive, whitespace-normalised). Returns null when
 * nothing can be located, so the UI can say so plainly.
 */
export function computeExcerpt(text: string | null | undefined, opts: { quote?: string | null; location?: SourceLocation | null }): ReviewExcerpt | null {
    if (!text) return null;
    let start: number | null = null;
    let end: number | null = null;
    const loc = opts.location;
    if (loc && typeof loc.startOffset === "number" && typeof loc.endOffset === "number" && loc.startOffset >= 0 && loc.endOffset > loc.startOffset && loc.endOffset <= text.length) {
        start = loc.startOffset;
        end = loc.endOffset;
    } else if (opts.quote) {
        const found = findQuote(text, opts.quote);
        if (found) [start, end] = found;
    }
    if (start === null || end === null) return null;
    const beforeStart = snapBack(text, start - EXCERPT_CONTEXT);
    const afterEnd = snapForward(text, end + EXCERPT_CONTEXT);
    return {
        before: tidy((beforeStart > 0 ? "…" : "") + text.slice(beforeStart, start)),
        match: tidy(text.slice(start, end)),
        after: tidy(text.slice(end, afterEnd) + (afterEnd < text.length ? "…" : "")),
    };
}

/**
 * Locate `quote` in `text` ignoring case and runs of whitespace. Returns
 * [start, end] offsets into the original text, or null.
 */
export function findQuote(text: string, quote: string): [number, number] | null {
    const q = quote.trim();
    if (q.length < 3) return null;
    // Fast path: exact, case-insensitive.
    const direct = text.toLowerCase().indexOf(q.toLowerCase());
    if (direct >= 0) return [direct, direct + q.length];
    // Whitespace-insensitive: build a regex from the quote's tokens.
    const tokens = q.split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(tokens.join("\\s+"), "i");
    const m = re.exec(text);
    if (!m) return null;
    return [m.index, m.index + m[0].length];
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "on", "in", "at", "for", "with", "was", "were", "is", "are", "you", "your", "that", "this", "by", "from", "be", "it", "as", "we", "our"]);

/** Content tokens of a title: lower-case words of three letters or more, minus common function words. */
export function titleTokens(title: string): Set<string> {
    return new Set(
        title
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 3 && !STOP.has(w)),
    );
}

/**
 * Similarity between two event titles: shared content tokens over the smaller
 * token set. 1 when one title's words all appear in the other.
 */
export function titleSimilarity(a: string, b: string): number {
    const ta = titleTokens(a);
    const tb = titleTokens(b);
    if (ta.size === 0 || tb.size === 0) return 0;
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    return shared / Math.min(ta.size, tb.size);
}

export const DUPLICATE_THRESHOLD = 0.6;

export function provenanceLabel(p: Provenance): ProvenanceLabel {
    switch (p) {
        case "EMPLOYER_ALLEGATION":
            return "The employer alleges";
        case "MODEL_INFERENCE":
        case "UNKNOWN":
            return "The model inferred";
        case "USER_ALLEGATION":
        case "USER_CONFIRMED":
        case "DISPUTED":
            return "You said";
        default:
            return "The document says";
    }
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

type DocInfo = { id: string; filename: string; extractedText: string | null };

function buildSource(docs: Map<string, DocInfo>, documentId: string | null, quote: string | null, location: SourceLocation | null, quoteVerified: boolean | null, fallbacks: Array<string | null | undefined>): ReviewSource {
    const doc = documentId ? docs.get(documentId) ?? null : null;
    let excerpt = doc ? computeExcerpt(doc.extractedText, { quote, location }) : null;
    // No recorded quote (or it was not found): try the proposal's own wording, which the mock and
    // some extractors copy verbatim from the text.
    if (!excerpt && doc) {
        for (const f of fallbacks) {
            if (!f) continue;
            excerpt = computeExcerpt(doc.extractedText, { quote: f });
            if (excerpt) break;
        }
    }
    const verified: boolean | null = quoteVerified === false ? false : quoteVerified === true || excerpt ? true : null;
    return {
        documentId: doc?.id ?? null,
        filename: doc?.filename ?? null,
        quote,
        quoteVerified: verified,
        location: location ?? null,
        excerpt,
        page: location?.page ?? null,
    };
}

function unverified(source: ReviewSource): ReviewConflict[] {
    if (source.quoteVerified === false) {
        return [{ kind: "unverified_quote", message: "The quoted passage was not found word-for-word in the document. Read the original carefully before confirming." }];
    }
    return [];
}

export async function buildReviewQueue(actor: Actor, caseId: string): Promise<ReviewQueue> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();

    const [proposedEvents, confirmedEvents, proposedFacts, confirmedFacts, proposedAllegations, docRows] = await Promise.all([
        db.select().from(events).where(and(eq(events.caseId, caseId), eq(events.status, "proposed"))).orderBy(events.date, events.createdAt),
        db.select().from(events).where(and(eq(events.caseId, caseId), eq(events.status, "confirmed"))),
        db.select().from(facts).where(and(eq(facts.caseId, caseId), eq(facts.status, "proposed"))).orderBy(facts.createdAt),
        db.select().from(facts).where(and(eq(facts.caseId, caseId), eq(facts.status, "confirmed"))),
        db.select().from(allegations).where(and(eq(allegations.caseId, caseId), eq(allegations.status, "proposed"))).orderBy(allegations.createdAt),
        db.select({ id: documents.id, filename: documents.filename, extractedText: documents.extractedText }).from(documents).where(and(eq(documents.caseId, caseId), isNull(documents.deletedAt))),
    ]);
    const docs = new Map<string, DocInfo>(docRows.map((d) => [d.id, d]));
    const liveConfirmedEvents = confirmedEvents.filter((e) => !e.mergedIntoId);

    const items: ReviewItem[] = [];

    for (const e of proposedEvents) {
        const documentId = e.sourceDocumentIds[0] ?? null;
        const source = buildSource(docs, documentId, e.sourceQuote, e.sourceLocation, e.quoteVerified, [e.description, e.title]);
        const conflicts: ReviewConflict[] = [];
        for (const c of liveConfirmedEvents) {
            if (c.date === e.date && titleSimilarity(c.title, e.title) >= DUPLICATE_THRESHOLD) {
                conflicts.push({ kind: "possible_duplicate", message: `This looks like the event already on your timeline for ${formatLongDate(c.date)}: “${c.title}”.`, relatedId: c.id });
                break;
            }
        }
        conflicts.push(...unverified(source));
        items.push({
            id: e.id,
            kind: "event",
            title: e.title,
            detail: e.description && e.description !== e.title ? e.description : null,
            date: e.date,
            datePrecision: e.dateApproximate ? "approximate" : "exact",
            provenanceLabel: provenanceLabel(e.provenance),
            factKey: null,
            factValue: null,
            processId: null,
            source,
            conflicts,
            actions: ["confirm", "correct", "reject"],
        });
    }

    for (const f of proposedFacts) {
        const source = buildSource(docs, f.sourceDocumentId, f.sourceQuote, f.sourceLocation, f.quoteVerified, [f.statement]);
        const conflicts: ReviewConflict[] = [];
        if (f.key) {
            const current = confirmedFacts.filter((c) => c.key === f.key).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
            if (current && (current.value ?? null) !== (f.value ?? null)) {
                const isDate = /^\d{4}-\d{2}-\d{2}$/.test(current.value ?? "");
                const shown = isDate ? formatLongDate(current.value) : current.value ?? "nothing";
                conflicts.push({ kind: "differs_from_confirmed", message: `Your record already has ${shown} for “${f.key.replace(/_/g, " ")}”. This document suggests a different value.`, relatedId: current.id, confirmedValue: current.value ?? null });
            }
        }
        conflicts.push(...unverified(source));
        const isDateValue = f.value ? /^\d{4}-\d{2}-\d{2}$/.test(f.value) : false;
        items.push({
            id: f.id,
            kind: "fact",
            title: f.statement,
            detail: f.key ? `${f.key.replace(/_/g, " ")}: ${isDateValue ? formatLongDate(f.value) : f.value ?? "—"}` : null,
            date: isDateValue ? f.value : null,
            datePrecision: isDateValue ? f.valuePrecision : null,
            provenanceLabel: provenanceLabel(f.provenance),
            factKey: f.key,
            factValue: f.value,
            processId: null,
            source,
            conflicts,
            actions: ["confirm", "correct", "reject"],
        });
    }

    for (const a of proposedAllegations) {
        const source = buildSource(docs, a.sourceDocumentId, a.sourceQuote, a.sourceLocation, a.quoteVerified, [a.employerAllegation]);
        items.push({
            id: a.id,
            kind: "allegation",
            title: a.employerAllegation,
            detail: a.employerEvidence,
            date: null,
            datePrecision: null,
            provenanceLabel: "The employer alleges",
            factKey: null,
            factValue: null,
            processId: a.processId,
            source,
            conflicts: unverified(source),
            actions: ["accept_as_allegation", "withdraw"],
        });
    }

    return {
        items,
        remaining: items.length,
        byKind: { events: proposedEvents.length, facts: proposedFacts.length, allegations: proposedAllegations.length },
    };
}

/** Cheap count for the navigation badge: three COUNT(*) queries, no document text. */
export async function countReviewItems(actor: Actor, caseId: string): Promise<number> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const count = sql<number>`count(*)::int`;
    const [[e], [f], [a]] = await Promise.all([
        db.select({ n: count }).from(events).where(and(eq(events.caseId, caseId), eq(events.status, "proposed"))),
        db.select({ n: count }).from(facts).where(and(eq(facts.caseId, caseId), eq(facts.status, "proposed"))),
        db.select({ n: count }).from(allegations).where(and(eq(allegations.caseId, caseId), eq(allegations.status, "proposed"))),
    ]);
    return Number(e?.n ?? 0) + Number(f?.n ?? 0) + Number(a?.n ?? 0);
}
