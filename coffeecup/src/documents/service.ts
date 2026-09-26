/**
 * Documents — upload, store, extract, classify, link.
 *
 * Flow: original bytes (object storage) → extracted text (documents row) →
 * proposals (events/facts/allegations, status proposed) → user confirmation.
 * The original is never overwritten. Bytes are only served through
 * `getDocumentBytes`, which passes the tenancy guard first.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { allegations, documentLinks, documents, DOCUMENT_TYPES, type DocumentType, type ExtractionStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/dates";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { markStale } from "@/cases/staleness";
import { getStorage } from "./storage";
import { extractText, kindForUpload, MAX_UPLOAD_BYTES } from "./extract";
import { enqueueJob, registerJobHandler, runPendingJobs, runsInline, type JobOutcome } from "@/jobs/service";
import { getProvider } from "@/ai/routing";
import { runExtractDocument } from "@/ai/tasks/extract-document";
import { proposeEvent } from "@/timeline/service";
import { proposeFact } from "@/facts/service";
import { checkAndCountUsage } from "@/entitlements/fair-use";

export type DocumentRow = typeof documents.$inferSelect;

export interface UploadInput {
    filename: string;
    mimeType: string;
    body: Buffer;
    userDescription?: string | null;
    /** Process type to attach extracted allegations to (disciplinary). */
    processId?: string | null;
}

export async function uploadDocument(actor: Actor, caseId: string, input: UploadInput): Promise<{ document: DocumentRow; jobId: string | null }> {
    await requireCaseAccess(actor, caseId);
    if (!input.body || input.body.length === 0) throw new ValidationError("The file is empty.");
    if (input.body.length > MAX_UPLOAD_BYTES) throw new ValidationError(`Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`);
    const filename = (input.filename || "document").replace(/[\r\n]/g, "").slice(0, 200);
    const kind = kindForUpload(input.mimeType || "", filename);
    if (!kind) throw new ValidationError("That file type is not supported. Use PDF, Word (.docx), text, email (.eml) or an image.");

    const db = await getDb();
    const id = newId();
    const storageKey = `${caseId}/${id}`;
    const sha256 = createHash("sha256").update(input.body).digest("hex");
    await getStorage().put(storageKey, caseId, input.body);
    await db.insert(documents).values({
        id,
        caseId,
        filename,
        mimeType: input.mimeType || "application/octet-stream",
        sizeBytes: input.body.length,
        storageKey,
        sha256,
        userDescription: input.userDescription ?? null,
        extractionStatus: "queued",
    });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "document.uploaded", targetType: "document", targetId: id, details: { kind, sizeBytes: input.body.length } });

    const job = await enqueueJob({ type: "document.extract", caseId, userId: actor.userId, payload: { documentId: id, kind, processId: input.processId ?? null } });
    if (runsInline()) await runPendingJobs();
    return { document: await getDocument(actor, caseId, id), jobId: job.id };
}

export async function listDocuments(actor: Actor, caseId: string): Promise<DocumentRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    return db.select().from(documents).where(and(eq(documents.caseId, caseId), isNull(documents.deletedAt))).orderBy(desc(documents.uploadedAt));
}

export async function getDocument(actor: Actor, caseId: string, documentId: string): Promise<DocumentRow> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const rows = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.caseId, caseId), isNull(documents.deletedAt))).limit(1);
    if (!rows[0]) throw new NotFoundError("Document not found.");
    return rows[0];
}

export async function getDocumentBytes(actor: Actor, caseId: string, documentId: string): Promise<{ document: DocumentRow; body: Buffer }> {
    const document = await getDocument(actor, caseId, documentId);
    const body = await getStorage().get(document.storageKey);
    if (!body) throw new NotFoundError("The file could not be found in storage.");
    await recordAudit({ userId: actor.userId, caseId, action: "document.downloaded", targetType: "document", targetId: documentId });
    return { document, body };
}

export const UpdateDocumentInput = z.object({
    docType: z.enum(DOCUMENT_TYPES).optional(),
    docDate: z.string().refine(isIsoDate, "Expected YYYY-MM-DD").nullable().optional(),
    author: z.string().trim().max(200).nullable().optional(),
    recipients: z.array(z.string().trim().max(200)).optional(),
    userDescription: z.string().trim().max(2000).nullable().optional(),
});

export async function updateDocument(actor: Actor, caseId: string, documentId: string, raw: z.input<typeof UpdateDocumentInput>): Promise<DocumentRow> {
    await getDocument(actor, caseId, documentId);
    const parsed = UpdateDocumentInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the document details.", parsed.error.flatten());
    const db = await getDb();
    const patch: Partial<typeof documents.$inferInsert> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.docType !== undefined) patch.docTypeConfirmed = true;
    await db.update(documents).set(patch).where(eq(documents.id, documentId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "document.updated", targetType: "document", targetId: documentId, details: { fields: Object.keys(parsed.data) } });
    if (parsed.data.docType !== undefined || parsed.data.docDate !== undefined) await markStale(caseId, "a document was reclassified", ["claims", "artifacts"]);
    return getDocument(actor, caseId, documentId);
}

export async function deleteDocument(actor: Actor, caseId: string, documentId: string): Promise<void> {
    const doc = await getDocument(actor, caseId, documentId);
    const db = await getDb();
    await getStorage().delete(doc.storageKey);
    await db.update(documents).set({ deletedAt: new Date(), extractedText: null }).where(eq(documents.id, documentId));
    await db.delete(documentLinks).where(eq(documentLinks.documentId, documentId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "document.deleted", targetType: "document", targetId: documentId });
}

export async function linkDocument(actor: Actor, caseId: string, documentId: string, target: { type: "event" | "issue" | "fact" | "allegation" | "process"; id: string }, note?: string): Promise<void> {
    await getDocument(actor, caseId, documentId);
    const db = await getDb();
    await db.insert(documentLinks).values({ id: newId(), caseId, documentId, targetType: target.type, targetId: target.id, note: note ?? null });
}

export async function listDocumentLinks(actor: Actor, caseId: string, documentId: string) {
    await getDocument(actor, caseId, documentId);
    const db = await getDb();
    return db.select().from(documentLinks).where(eq(documentLinks.documentId, documentId));
}

/** Re-run extraction (self-service recovery after a failure). */
export async function reprocessDocument(actor: Actor, caseId: string, documentId: string): Promise<string> {
    const doc = await getDocument(actor, caseId, documentId);
    const kind = kindForUpload(doc.mimeType, doc.filename) ?? "txt";
    const db = await getDb();
    await db.update(documents).set({ extractionStatus: "queued", extractionError: null }).where(eq(documents.id, documentId));
    const job = await enqueueJob({ type: "document.extract", caseId, userId: actor.userId, payload: { documentId, kind } });
    if (runsInline()) await runPendingJobs();
    return job.id;
}

// ---------------------------------------------------------------------------
// Extraction job handler
// ---------------------------------------------------------------------------

async function setExtraction(documentId: string, status: ExtractionStatus, patch: Partial<typeof documents.$inferInsert> = {}): Promise<void> {
    const db = await getDb();
    await db.update(documents).set({ extractionStatus: status, updatedAt: new Date(), ...patch }).where(eq(documents.id, documentId));
}

registerJobHandler("document.extract", async ({ job }): Promise<JobOutcome> => {
    const documentId = String(job.payload.documentId ?? "");
    const kind = String(job.payload.kind ?? "txt");
    const processId = typeof job.payload.processId === "string" ? job.payload.processId : null;
    const db = await getDb();
    const doc = (await db.select().from(documents).where(eq(documents.id, documentId)))[0];
    if (!doc || doc.deletedAt) return { status: "completed", result: { skipped: "document missing" } };
    const caseId = doc.caseId;

    await setExtraction(documentId, "processing");
    const body = await getStorage().get(doc.storageKey);
    if (!body) {
        await setExtraction(documentId, "failed", { extractionError: "File not found in storage." });
        throw new Error("File not found in storage.");
    }

    const extraction = await extractText(kind, body);
    if (extraction.status === "unsupported") {
        await setExtraction(documentId, "unsupported", { extractionError: extraction.note, docType: kind === "image" ? "photo" : "other" });
        return { status: "requires_review", note: extraction.note };
    }
    if (extraction.status === "failed") {
        await setExtraction(documentId, "failed", { extractionError: extraction.note });
        throw new Error(extraction.note);
    }
    if (extraction.status === "requires_review") {
        await setExtraction(documentId, "requires_review", { extractedText: extraction.text, extractionError: extraction.note });
        return { status: "requires_review", note: extraction.note };
    }

    await setExtraction(documentId, "processing", { extractedText: extraction.text });

    // Fair use: extraction proposals count as one AI generation.
    const allowed = await checkAndCountUsage(job.userId ?? "", caseId, "document_extraction");
    if (!allowed.ok) {
        await setExtraction(documentId, "requires_review", { extractionError: allowed.reason });
        return { status: "requires_review", note: allowed.reason };
    }

    let proposals;
    try {
        const provider = await getProvider();
        proposals = await runExtractDocument(provider, { text: extraction.text, filename: doc.filename, userDescription: doc.userDescription });
    } catch (err) {
        // Text is kept; only the proposal step failed. The user can retry.
        const message = err instanceof Error ? err.message : "Proposal step failed.";
        await setExtraction(documentId, "requires_review", { extractionError: `We read the file but could not propose events automatically (${message}). You can add events by hand or retry.` });
        return { status: "requires_review", note: message };
    }

    const out = proposals.data;
    let eventCount = 0;
    for (const ev of out.events) {
        const created = await proposeEvent(caseId, {
            date: ev.date,
            dateEnd: ev.dateEnd ?? null,
            dateApproximate: ev.approximate,
            title: ev.title,
            description: ev.description ?? ev.quote ?? null,
            category: ev.category,
            confidence: Math.round(ev.confidence),
            sourceDocumentId: documentId,
            jobId: job.id,
        });
        if (created) eventCount++;
    }
    let factCount = 0;
    for (const f of out.facts) {
        await proposeFact(caseId, { statement: f.statement, provenance: f.provenance, confidence: Math.round(f.confidence), key: f.key, value: f.value, sourceDocumentId: documentId });
        factCount++;
    }
    let allegationCount = 0;
    if (processId) {
        for (const a of out.allegations) {
            await db.insert(allegations).values({ id: newId(), caseId, processId, employerAllegation: a.allegation, employerEvidence: a.evidence, sourceDocumentId: documentId, provenance: "EMPLOYER_ALLEGATION", status: "proposed" });
            allegationCount++;
        }
    }

    const docType: DocumentType = out.documentType;
    await setExtraction(documentId, "completed", {
        extractionError: null,
        docType: doc.docTypeConfirmed ? doc.docType : docType,
        docDate: doc.docDate ?? out.documentDate,
        author: doc.author ?? out.author,
        recipients: doc.recipients.length ? doc.recipients : out.recipients,
    });
    await recordAudit({ userId: job.userId, caseId, action: "document.extracted", targetType: "document", targetId: documentId, details: { events: eventCount, facts: factCount, allegations: allegationCount, model: proposals.model, provider: proposals.provider, retried: proposals.retried } });
    return { status: "completed", result: { events: eventCount, facts: factCount, allegations: allegationCount, summary: out.summary } };
});
