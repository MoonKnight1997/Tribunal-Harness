/**
 * Documents — upload, store, extract, classify, link.
 *
 * Flow: original bytes (object storage) → extracted text (documents row) →
 * proposals (events/facts/allegations, status proposed) → user confirmation.
 * The original is never overwritten. Bytes are only served through
 * `getDocumentBytes`, which passes the tenancy guard first.
 *
 * Three layers are kept distinct and never blurred:
 *   - extracted propositions: `events`/`facts` rows with provenance
 *     DOCUMENT_EXTRACTED, status `proposed`;
 *   - employer allegations: `allegations` rows with provenance
 *     EMPLOYER_ALLEGATION, status `proposed`, attached to a process that has
 *     been verified to belong to the same case;
 *   - user-confirmed facts: only ever produced by a user action elsewhere.
 *
 * Every extraction run writes an `extractionReport` (coverage manifest, item
 * diagnostics, counts) so the status can never claim more than was done.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { allegations, cases, documentLinks, documents, events, facts, jobs, processes, DOCUMENT_TYPES, type DocumentType, type ExtractionReport, type ExtractionStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/dates";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { markStale } from "@/cases/staleness";
import { getStorage } from "./storage";
import { extractText, kindForUpload, MAX_UPLOAD_BYTES, type ExtractionDetail } from "./extract";
import { eventKey, statementKey } from "./extract/chunking";
import { cancelJob, enqueueJob, isJobCancelled, registerJobHandler, runPendingJobs, runsInline, type JobOutcome } from "@/jobs/service";
import { getProvider } from "@/ai/routing";
import { runExtractDocumentChunked, type ExtractionDiagnostic } from "@/ai/tasks/extract-document";
import { proposeEvent } from "@/timeline/service";
import { proposeFact } from "@/facts/service";
import { getProcess } from "@/processes/service";
import { checkAndCountUsage } from "@/entitlements/fair-use";

export type DocumentRow = typeof documents.$inferSelect;

export const EXTRACTION_TASK = "extract_document_v1";

export interface UploadInput {
    filename: string;
    mimeType: string;
    body: Buffer;
    userDescription?: string | null;
    /** Process (disciplinary) to attach extracted allegations to. Must belong to the case. */
    processId?: string | null;
}

/** Idempotency key for the nth extraction run of a document. */
export function extractionJobKey(documentId: string, series: number): string {
    return `document.extract:${documentId}:${series}`;
}

/** Resolve a process id to a process of THIS case, or 404. A foreign id looks exactly like a missing one. */
async function requireProcessInCase(actor: Actor, caseId: string, processId: string): Promise<void> {
    try {
        await getProcess(actor, caseId, processId);
    } catch (err) {
        if (err instanceof AppError) throw new NotFoundError("Process not found.");
        throw err;
    }
}

export async function uploadDocument(actor: Actor, caseId: string, input: UploadInput): Promise<{ document: DocumentRow; jobId: string | null }> {
    await requireCaseAccess(actor, caseId);
    if (!input.body || input.body.length === 0) throw new ValidationError("The file is empty.");
    if (input.body.length > MAX_UPLOAD_BYTES) throw new ValidationError(`Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`);
    const filename = (input.filename || "document").replace(/[\r\n]/g, "").slice(0, 200);
    const kind = kindForUpload(input.mimeType || "", filename);
    if (!kind) throw new ValidationError("That file type is not supported. Use PDF, Word (.docx), text, email (.eml) or an image.");
    // F03: a process id must belong to this case, checked BEFORE any bytes are stored or a job enqueued.
    const processId = input.processId?.trim() || null;
    if (processId) await requireProcessInCase(actor, caseId, processId);

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
        processId,
        extractionStatus: "queued",
    });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "document.uploaded", targetType: "document", targetId: id, details: { kind, sizeBytes: input.body.length, hasProcess: !!processId } });

    const job = await enqueueJob({ type: "document.extract", caseId, userId: actor.userId, payload: { documentId: id, kind, processId }, idempotencyKey: extractionJobKey(id, 1) });
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
    // Any queued extraction for this document is pointless now; a processing one will notice deletedAt.
    const pending = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.caseId, caseId), eq(jobs.type, "document.extract"), inArray(jobs.status, ["queued", "processing"]), sql`${jobs.payload} ->> 'documentId' = ${documentId}`));
    for (const j of pending) await cancelJob(j.id);
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

/**
 * Re-run extraction (self-service recovery). Works whether or not text was
 * extracted before — the file is re-read from storage — and keeps the
 * document's process link. Each run gets a fresh idempotency key in the
 * document's attempt series, so a retry is a new job rather than a re-run of
 * one that may still be finishing.
 */
export async function reprocessDocument(actor: Actor, caseId: string, documentId: string): Promise<string> {
    const doc = await getDocument(actor, caseId, documentId);
    const kind = kindForUpload(doc.mimeType, doc.filename) ?? "txt";
    const db = await getDb();
    const existing = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.caseId, caseId), eq(jobs.type, "document.extract"), sql`${jobs.payload} ->> 'documentId' = ${documentId}`));
    const series = existing.length + 1;
    await db.update(documents).set({ extractionStatus: "queued", extractionError: null, updatedAt: new Date() }).where(eq(documents.id, documentId));
    await recordAudit({ userId: actor.userId, caseId, action: "document.reprocess_requested", targetType: "document", targetId: documentId, details: { series } });
    const job = await enqueueJob({ type: "document.extract", caseId, userId: actor.userId, payload: { documentId, kind, processId: doc.processId ?? null }, idempotencyKey: extractionJobKey(documentId, series) });
    if (runsInline()) await runPendingJobs();
    return job.id;
}

/** Cancel a queued (or flag a processing) extraction for a document. Returns true if a job was cancelled. */
export async function cancelExtraction(actor: Actor, caseId: string, documentId: string): Promise<boolean> {
    await getDocument(actor, caseId, documentId);
    const db = await getDb();
    const pending = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.caseId, caseId), eq(jobs.type, "document.extract"), inArray(jobs.status, ["queued", "processing"]), sql`${jobs.payload} ->> 'documentId' = ${documentId}`));
    if (pending.length === 0) return false;
    for (const j of pending) await cancelJob(j.id, actor);
    await db.update(documents).set({ extractionStatus: "requires_review", extractionError: "Reading was cancelled. You can try again or describe the document by hand.", updatedAt: new Date() }).where(eq(documents.id, documentId));
    return true;
}

// ---------------------------------------------------------------------------
// Extraction job handler
// ---------------------------------------------------------------------------

async function setExtraction(documentId: string, status: ExtractionStatus, patch: Partial<typeof documents.$inferInsert> = {}): Promise<void> {
    const db = await getDb();
    await db.update(documents).set({ extractionStatus: status, updatedAt: new Date(), ...patch }).where(eq(documents.id, documentId));
}

function emptyCoverage(text: string | null): ExtractionReport["coverage"] {
    return { totalChars: text?.length ?? 0, charsSent: 0, chunks: 0, chunksSucceeded: 0, truncated: false };
}

function baseReport(detail: ExtractionDetail, text: string | null, extra: Partial<ExtractionReport> = {}): ExtractionReport {
    return {
        coverage: { ...emptyCoverage(text), parts: detail.parts, pages: detail.pages },
        diagnostics: [],
        counts: { events: 0, facts: 0, allegations: 0, duplicatesSkipped: 0, quotesUnverified: 0 },
        method: detail.method,
        task: EXTRACTION_TASK,
        attachments: detail.attachments,
        completedAt: new Date().toISOString(),
        ...extra,
    };
}

/** Is the document (or its case) still live and the job not cancelled? Checked before every write phase. */
async function stillWanted(documentId: string, caseId: string, jobId: string): Promise<"ok" | "deleted" | "cancelled"> {
    const db = await getDb();
    const doc = (await db.select({ deletedAt: documents.deletedAt }).from(documents).where(eq(documents.id, documentId)))[0];
    if (!doc || doc.deletedAt) return "deleted";
    const c = (await db.select({ deletedAt: cases.deletedAt }).from(cases).where(eq(cases.id, caseId)))[0];
    if (!c || c.deletedAt) return "deleted";
    if (await isJobCancelled(jobId)) return "cancelled";
    return "ok";
}

/** Existing proposals for this document so a retry cannot multiply equivalent items. */
async function existingKeys(caseId: string, documentId: string, processId: string | null) {
    const db = await getDb();
    const evs = await db
        .select({ date: events.date, title: events.title })
        .from(events)
        .where(and(eq(events.caseId, caseId), inArray(events.status, ["proposed", "confirmed"]), isNull(events.mergedIntoId), sql`${events.sourceDocumentIds} @> ${JSON.stringify([documentId])}::jsonb`));
    const fs = await db
        .select({ statement: facts.statement })
        .from(facts)
        .where(and(eq(facts.caseId, caseId), eq(facts.sourceDocumentId, documentId), inArray(facts.status, ["proposed", "confirmed"])));
    const als = processId
        ? await db
              .select({ employerAllegation: allegations.employerAllegation })
              .from(allegations)
              .where(and(eq(allegations.caseId, caseId), eq(allegations.processId, processId), eq(allegations.sourceDocumentId, documentId), inArray(allegations.status, ["proposed", "confirmed"])))
        : [];
    return {
        events: new Set(evs.map((e) => eventKey(e.date, e.title))),
        facts: new Set(fs.map((f) => statementKey(f.statement))),
        allegations: new Set(als.map((a) => statementKey(a.employerAllegation))),
    };
}

registerJobHandler("document.extract", async ({ job }): Promise<JobOutcome> => {
    const documentId = String(job.payload.documentId ?? "");
    const kind = String(job.payload.kind ?? "txt");
    const payloadProcessId = typeof job.payload.processId === "string" ? job.payload.processId : null;
    const db = await getDb();
    const doc = (await db.select().from(documents).where(eq(documents.id, documentId)))[0];
    if (!doc || doc.deletedAt) return { status: "completed", result: { skipped: "document missing" } };
    const caseId = doc.caseId;
    const skippedDeleted: JobOutcome = { status: "completed", result: { skipped: "deleted during processing" } };
    const skippedCancelled: JobOutcome = { status: "completed", result: { skipped: "cancelled" } };

    await setExtraction(documentId, "processing");
    const body = await getStorage().get(doc.storageKey);
    if (!body) {
        await setExtraction(documentId, "failed", { extractionError: "File not found in storage.", extractionReport: baseReport({ method: "none" }, null) });
        throw new Error("File not found in storage.");
    }

    // ── Phase 1: read the file ─────────────────────────────────────────
    const extraction = await extractText(kind, body);
    const detail = extraction.detail;
    const pageCount = detail.pageCount ?? null;
    if (extraction.status === "unsupported") {
        await setExtraction(documentId, "unsupported", { extractionError: extraction.note, docType: doc.docTypeConfirmed ? doc.docType : kind === "image" ? "photo" : "other", extractionReport: baseReport(detail, null), pageCount });
        return { status: "requires_review", note: extraction.note };
    }
    if (extraction.status === "failed") {
        await setExtraction(documentId, "failed", { extractionError: extraction.note, extractionReport: baseReport(detail, null), pageCount });
        throw new Error(extraction.note);
    }
    if (extraction.status === "requires_review") {
        await setExtraction(documentId, "requires_review", { extractedText: extraction.text, extractionError: extraction.note, extractionReport: baseReport(detail, extraction.text), pageCount, docType: doc.docTypeConfirmed ? doc.docType : kind === "image" ? "photo" : doc.docType });
        return { status: "requires_review", note: extraction.note };
    }
    const text = extraction.text;
    const readNote = extraction.note ?? null; // e.g. "1 attachment not read: payslip.pdf"
    const readPartial = extraction.status === "partial";

    let wanted = await stillWanted(documentId, caseId, job.id);
    if (wanted !== "ok") return wanted === "deleted" ? skippedDeleted : skippedCancelled;
    await setExtraction(documentId, "processing", { extractedText: text, pageCount });

    // Fair use: extraction proposals count as one AI generation.
    const allowed = await checkAndCountUsage(job.userId ?? "", caseId, "document_extraction");
    if (!allowed.ok) {
        await setExtraction(documentId, "requires_review", { extractionError: allowed.reason, extractionReport: baseReport(detail, text) });
        return { status: "requires_review", note: allowed.reason };
    }

    // ── Phase 2: propose (model) ───────────────────────────────────────
    // Which process may receive allegations: the document's own link first,
    // then the job payload — and either way only if it belongs to THIS case.
    const diagnostics: ExtractionDiagnostic[] = [];
    let processId: string | null = null;
    const candidateProcess = doc.processId ?? payloadProcessId;
    if (candidateProcess) {
        const proc = (await db.select({ id: processes.id }).from(processes).where(and(eq(processes.id, candidateProcess), eq(processes.caseId, caseId))).limit(1))[0];
        if (proc) processId = proc.id;
        else diagnostics.push({ chunk: -1, kind: "allegation", index: -1, problem: "The process linked to this document does not belong to this case; allegations were not recorded." });
    }

    let run;
    try {
        const provider = await getProvider();
        run = await runExtractDocumentChunked(provider, { text, filename: doc.filename, userDescription: doc.userDescription, documentId, pages: detail.pageBoundaries ?? null });
    } catch (err) {
        // Text is kept; only the proposal step failed. The user can retry.
        const message = err instanceof Error ? err.message : "Proposal step failed.";
        const report = baseReport(detail, text, { diagnostics: [...diagnostics, { chunk: -1, kind: "document", index: -1, problem: message.slice(0, 300) }] });
        await setExtraction(documentId, "requires_review", { extractionError: `We read the file but could not propose events automatically (${message}). You can add events by hand or retry.`, extractionReport: report });
        return { status: "requires_review", note: message };
    }
    diagnostics.push(...run.diagnostics);
    for (const ce of run.chunkErrors) diagnostics.push({ chunk: ce.chunk, kind: "document", index: -1, problem: `Section not read: ${ce.error.slice(0, 200)}` });

    // ── Phase 3: write proposals ───────────────────────────────────────
    wanted = await stillWanted(documentId, caseId, job.id);
    if (wanted !== "ok") return wanted === "deleted" ? skippedDeleted : skippedCancelled;

    const out = run.data;
    const seen = await existingKeys(caseId, documentId, processId);
    let duplicatesSkipped = run.duplicatesMerged;
    let eventCount = 0;
    for (const ev of out.events) {
        const key = eventKey(ev.date, ev.title);
        if (seen.events.has(key)) {
            duplicatesSkipped++;
            continue;
        }
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
            sourceQuote: ev.quote,
            sourceLocation: ev.location,
            quoteVerified: ev.quote ? ev.quoteVerified : null,
        });
        if (created) {
            eventCount++;
            seen.events.add(key);
        }
    }
    let factCount = 0;
    for (const f of out.facts) {
        const key = statementKey(f.statement);
        if (seen.facts.has(key)) {
            duplicatesSkipped++;
            continue;
        }
        await proposeFact(caseId, {
            statement: f.statement,
            provenance: f.provenance,
            confidence: Math.round(f.confidence),
            key: f.key,
            value: f.value,
            sourceDocumentId: documentId,
            sourceQuote: f.quote,
            sourceLocation: f.location,
            quoteVerified: f.quote ? f.quoteVerified : null,
        });
        factCount++;
        seen.facts.add(key);
    }
    let allegationCount = 0;
    if (processId) {
        for (const [index, a] of out.allegations.entries()) {
            const key = statementKey(a.allegation);
            if (seen.allegations.has(key)) {
                duplicatesSkipped++;
                continue;
            }
            try {
                await db.insert(allegations).values({
                    id: newId(),
                    caseId,
                    processId,
                    employerAllegation: a.allegation,
                    employerEvidence: a.evidence,
                    sourceDocumentId: documentId,
                    provenance: "EMPLOYER_ALLEGATION",
                    status: "proposed",
                    sourceQuote: a.quote,
                    sourceLocation: a.location,
                    quoteVerified: a.quote ? a.quoteVerified : null,
                    proposedByJobId: job.id,
                });
                allegationCount++;
                seen.allegations.add(key);
            } catch (err) {
                // The composite FK (process_id, case_id) refuses a cross-case pair; report, never crash the job.
                diagnostics.push({ chunk: -1, kind: "allegation", index, problem: `Allegation not recorded: ${err instanceof Error ? err.message.slice(0, 200) : "database refused the write"}` });
            }
        }
    } else if (out.allegations.length > 0 && !candidateProcess) {
        // Informational (kind "document", chunk -1): the user did not link a process, so nothing was asked for.
        diagnostics.push({ chunk: -1, kind: "document", index: -1, problem: `${out.allegations.length} allegation(s) found but the document is not linked to a disciplinary process, so they were not recorded.` });
    }

    // ── Status ─────────────────────────────────────────────────────────
    const droppedItems = diagnostics.filter((d) => d.kind !== "document" || d.chunk >= 0);
    const coverageGap = run.coverage.truncated || run.coverage.chunksSucceeded < run.coverage.chunks || readPartial;
    const proposalsMade = eventCount + factCount + allegationCount + duplicatesSkipped;
    let status: ExtractionStatus;
    let note: string | null = null;
    if (proposalsMade === 0 && droppedItems.length > 0) {
        status = "requires_review";
        note = "We read the file, but none of the suggested items could be used. You can add events by hand or try again.";
    } else if (coverageGap || droppedItems.length > 0) {
        status = "partial";
        const bits: string[] = [];
        if (run.coverage.truncated) bits.push(`only the first ${run.coverage.charsSent.toLocaleString("en-GB")} of ${run.coverage.totalChars.toLocaleString("en-GB")} characters were read`);
        if (run.coverage.chunksSucceeded < run.coverage.chunks) bits.push(`${run.coverage.chunks - run.coverage.chunksSucceeded} of ${run.coverage.chunks} sections could not be read`);
        if (readPartial && readNote) bits.push(readNote.replace(/\.$/, ""));
        if (droppedItems.length > 0) bits.push(`${droppedItems.length} suggested item${droppedItems.length === 1 ? "" : "s"} could not be used`);
        note = `Read with gaps: ${bits.join("; ")}. Check the timeline suggestions against the original.`;
    } else {
        status = "completed";
        note = readNote; // attachments not read, OCR confidence caveat
    }

    const report: ExtractionReport = {
        coverage: { ...run.coverage, parts: detail.parts, pages: detail.pages },
        diagnostics,
        counts: { events: eventCount, facts: factCount, allegations: allegationCount, duplicatesSkipped, quotesUnverified: run.quotesUnverified },
        method: detail.method,
        task: EXTRACTION_TASK,
        provider: run.provider ?? undefined,
        model: run.model ?? undefined,
        attachments: detail.attachments,
        completedAt: new Date().toISOString(),
    };

    const docType: DocumentType = out.documentType;
    await setExtraction(documentId, status, {
        extractionError: note,
        extractionReport: report,
        pageCount,
        docType: doc.docTypeConfirmed ? doc.docType : docType,
        docDate: doc.docDate ?? out.documentDate,
        author: doc.author ?? out.author,
        recipients: doc.recipients.length ? doc.recipients : out.recipients,
    });
    await recordAudit({
        userId: job.userId,
        caseId,
        action: "document.extracted",
        targetType: "document",
        targetId: documentId,
        details: { status, events: eventCount, facts: factCount, allegations: allegationCount, duplicatesSkipped, quotesUnverified: run.quotesUnverified, dropped: droppedItems.length, chunks: run.coverage.chunks, truncated: run.coverage.truncated, model: run.model, provider: run.provider, retried: run.retried },
    });
    return { status: "completed", result: { extractionStatus: status, events: eventCount, facts: factCount, allegations: allegationCount, duplicatesSkipped, summary: out.summary } };
});
