/**
 * Timeline — first-class chronology.
 *
 * Manual events are confirmed on creation. Extracted events are `proposed`
 * and sit in a review queue until the user confirms, corrects, merges or
 * rejects them. Proposals never silently become confirmed facts.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { documentLinks, events, EVENT_CATEGORIES, type Provenance } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/dates";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { markStale } from "@/cases/staleness";

export type EventRow = typeof events.$inferSelect;

const isoDate = z.string().refine(isIsoDate, "Expected a date in YYYY-MM-DD format");

export const EventInput = z.object({
    date: isoDate,
    dateEnd: isoDate.nullable().optional(),
    dateApproximate: z.boolean().default(false),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(8000).nullable().optional(),
    category: z.enum(EVENT_CATEGORIES).default("other"),
    actorIds: z.array(z.string()).default([]),
    sourceDocumentIds: z.array(z.string()).default([]),
    disputed: z.boolean().default(false),
});

export async function addEvent(actor: Actor, caseId: string, raw: z.input<typeof EventInput>): Promise<EventRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = EventInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the event details.", parsed.error.flatten());
    const input = parsed.data;
    if (input.dateEnd && input.dateEnd < input.date) throw new ValidationError("The end date cannot be before the start date.");
    const db = await getDb();
    const id = newId();
    await db.insert(events).values({
        id,
        caseId,
        ...input,
        description: input.description ?? null,
        dateEnd: input.dateEnd ?? null,
        status: "confirmed",
        userConfirmed: true,
        provenance: input.disputed ? "DISPUTED" : "USER_CONFIRMED",
    });
    await linkDocuments(caseId, id, input.sourceDocumentIds);
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "event.added", targetType: "event", targetId: id, details: { category: input.category } });
    await markStale(caseId, "an event was added", ["claims", "artifacts", "summary"]);
    return getEvent(caseId, id);
}

/** Pipeline entry point: propose an event for review. */
export async function proposeEvent(
    caseId: string,
    input: { date: string; dateEnd?: string | null; dateApproximate?: boolean; title: string; description?: string | null; category?: string; confidence?: number; sourceDocumentId?: string | null; jobId?: string | null; provenance?: Provenance },
): Promise<EventRow | null> {
    if (!isIsoDate(input.date)) return null;
    const db = await getDb();
    const category = (EVENT_CATEGORIES as readonly string[]).includes(input.category ?? "") ? (input.category as EventRow["category"]) : "other";
    const id = newId();
    await db.insert(events).values({
        id,
        caseId,
        date: input.date,
        dateEnd: input.dateEnd && isIsoDate(input.dateEnd) ? input.dateEnd : null,
        dateApproximate: input.dateApproximate ?? false,
        title: input.title.slice(0, 300),
        description: input.description?.slice(0, 8000) ?? null,
        category,
        sourceDocumentIds: input.sourceDocumentId ? [input.sourceDocumentId] : [],
        status: "proposed",
        userConfirmed: false,
        confidence: input.confidence ?? null,
        provenance: input.provenance ?? "DOCUMENT_EXTRACTED",
        proposedByJobId: input.jobId ?? null,
    });
    if (input.sourceDocumentId) await linkDocuments(caseId, id, [input.sourceDocumentId]);
    return getEvent(caseId, id);
}

async function linkDocuments(caseId: string, eventId: string, documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;
    const db = await getDb();
    await db.insert(documentLinks).values(documentIds.map((documentId) => ({ id: newId(), caseId, documentId, targetType: "event", targetId: eventId })));
}

async function getEvent(caseId: string, eventId: string): Promise<EventRow> {
    const db = await getDb();
    const rows = await db.select().from(events).where(and(eq(events.id, eventId), eq(events.caseId, caseId))).limit(1);
    if (!rows[0]) throw new ValidationError("Event not found.");
    return rows[0];
}

export async function listEvents(actor: Actor, caseId: string, opts?: { status?: "proposed" | "confirmed" | "rejected" }): Promise<EventRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const where = opts?.status ? and(eq(events.caseId, caseId), eq(events.status, opts.status)) : eq(events.caseId, caseId);
    return db.select().from(events).where(where).orderBy(asc(events.date), asc(events.createdAt));
}

/** Confirmed, un-merged events in date order — the chronology engines use. */
export async function listConfirmedEvents(caseId: string): Promise<EventRow[]> {
    const db = await getDb();
    const rows = await db.select().from(events).where(and(eq(events.caseId, caseId), eq(events.status, "confirmed"))).orderBy(asc(events.date), asc(events.createdAt));
    return rows.filter((r) => !r.mergedIntoId);
}

/** Review queue: proposals awaiting a decision. */
export async function listProposedEvents(actor: Actor, caseId: string): Promise<EventRow[]> {
    return listEvents(actor, caseId, { status: "proposed" });
}

export const UpdateEventInput = EventInput.partial();

export async function updateEvent(actor: Actor, caseId: string, eventId: string, raw: z.input<typeof UpdateEventInput>): Promise<EventRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = UpdateEventInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the event details.", parsed.error.flatten());
    const existing = await getEvent(caseId, eventId);
    const input = parsed.data;
    const date = input.date ?? existing.date;
    const dateEnd = input.dateEnd === undefined ? existing.dateEnd : input.dateEnd;
    if (dateEnd && dateEnd < date) throw new ValidationError("The end date cannot be before the start date.");
    const db = await getDb();
    const patch: Partial<typeof events.$inferInsert> = { ...input, updatedAt: new Date() };
    // Editing a proposal is an implicit user review: the user has looked at it.
    if (existing.status === "proposed") {
        patch.status = "confirmed";
        patch.userConfirmed = true;
        patch.provenance = existing.provenance === "DOCUMENT_EXTRACTED" ? "DOCUMENT_CONFIRMED" : "USER_CONFIRMED";
    }
    if (input.disputed !== undefined) patch.provenance = input.disputed ? "DISPUTED" : patch.provenance ?? (existing.provenance === "DISPUTED" ? "USER_CONFIRMED" : existing.provenance);
    await db.update(events).set(patch).where(eq(events.id, eventId));
    if (input.sourceDocumentIds) {
        await db.delete(documentLinks).where(and(eq(documentLinks.targetType, "event"), eq(documentLinks.targetId, eventId)));
        await linkDocuments(caseId, eventId, input.sourceDocumentIds);
    }
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "event.updated", targetType: "event", targetId: eventId, details: { fields: Object.keys(input), wasProposed: existing.status === "proposed" } });
    if (input.date !== undefined && input.date !== existing.date) {
        await markStale(caseId, "an event date changed", ["deadlines", "claims", "artifacts", "summary"]);
    } else {
        await markStale(caseId, "an event changed", ["claims", "artifacts", "summary"]);
    }
    return getEvent(caseId, eventId);
}

export async function confirmEvent(actor: Actor, caseId: string, eventId: string): Promise<EventRow> {
    await requireCaseAccess(actor, caseId);
    const existing = await getEvent(caseId, eventId);
    const db = await getDb();
    await db
        .update(events)
        .set({
            status: "confirmed",
            userConfirmed: true,
            provenance: existing.provenance === "DOCUMENT_EXTRACTED" ? "DOCUMENT_CONFIRMED" : existing.provenance === "MODEL_INFERENCE" ? "USER_CONFIRMED" : existing.provenance,
            updatedAt: new Date(),
        })
        .where(eq(events.id, eventId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "event.confirmed", targetType: "event", targetId: eventId });
    await markStale(caseId, "an event was confirmed", ["claims", "artifacts", "summary"]);
    return getEvent(caseId, eventId);
}

export async function rejectEvent(actor: Actor, caseId: string, eventId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    await getEvent(caseId, eventId);
    const db = await getDb();
    await db.update(events).set({ status: "rejected", updatedAt: new Date() }).where(eq(events.id, eventId));
    await recordAudit({ userId: actor.userId, caseId, action: "event.rejected", targetType: "event", targetId: eventId });
}

export async function deleteEvent(actor: Actor, caseId: string, eventId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    await getEvent(caseId, eventId);
    const db = await getDb();
    await db.delete(documentLinks).where(and(eq(documentLinks.targetType, "event"), eq(documentLinks.targetId, eventId)));
    await db.delete(events).where(and(eq(events.id, eventId), eq(events.caseId, caseId)));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "event.deleted", targetType: "event", targetId: eventId });
    await markStale(caseId, "an event was deleted", ["claims", "artifacts", "summary"]);
}

/**
 * Merge duplicates: keep `keepId`, fold the others' documents and actors into
 * it, mark the others merged (kept for audit, hidden from the chronology).
 */
export async function mergeEvents(actor: Actor, caseId: string, keepId: string, mergeIds: string[]): Promise<EventRow> {
    await requireCaseAccess(actor, caseId);
    const keep = await getEvent(caseId, keepId);
    const ids = mergeIds.filter((id) => id !== keepId);
    if (ids.length === 0) throw new ValidationError("Choose at least one other event to merge.");
    const db = await getDb();
    const others = await db.select().from(events).where(and(eq(events.caseId, caseId), inArray(events.id, ids)));
    if (others.length !== ids.length) throw new ValidationError("One or more events were not found.");
    const docIds = new Set(keep.sourceDocumentIds);
    const actorIds = new Set(keep.actorIds);
    const descriptions = [keep.description ?? ""];
    for (const o of others) {
        o.sourceDocumentIds.forEach((d) => docIds.add(d));
        o.actorIds.forEach((a) => actorIds.add(a));
        if (o.description && !descriptions.includes(o.description)) descriptions.push(o.description);
    }
    await db
        .update(events)
        .set({
            sourceDocumentIds: [...docIds],
            actorIds: [...actorIds],
            description: descriptions.filter(Boolean).join("\n\n") || null,
            status: "confirmed",
            userConfirmed: true,
            provenance: keep.provenance === "DOCUMENT_EXTRACTED" ? "DOCUMENT_CONFIRMED" : keep.provenance === "MODEL_INFERENCE" ? "USER_CONFIRMED" : keep.provenance,
            updatedAt: new Date(),
        })
        .where(eq(events.id, keepId));
    await db.update(events).set({ mergedIntoId: keepId, status: "rejected", updatedAt: new Date() }).where(inArray(events.id, ids));
    await db.update(documentLinks).set({ targetId: keepId }).where(and(eq(documentLinks.targetType, "event"), inArray(documentLinks.targetId, ids)));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "event.merged", targetType: "event", targetId: keepId, details: { merged: ids.length } });
    await markStale(caseId, "events were merged", ["claims", "artifacts", "summary"]);
    return getEvent(caseId, keepId);
}
