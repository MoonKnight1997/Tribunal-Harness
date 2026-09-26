/**
 * Processes — grievance, disciplinary, appeals, Acas Early Conciliation.
 *
 * A process is a stateful record inside the case. It stores structured data
 * (dates, references, summaries), allegations (disciplinary) and appeal
 * grounds, and records every transition. Acas dates written here are also
 * recorded as structured facts so the deadline engine can read them.
 */

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
    allegations,
    appealGrounds,
    processes,
    processTransitions,
    APPEAL_GROUND_CATEGORIES,
    PROCESS_TYPES,
    type AcasProcessData,
    type ProcessData,
    type ProcessType,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { isIsoDate, todayISO } from "@/lib/dates";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { markStale } from "@/cases/staleness";
import { acasCodeForDate } from "@/legal/rules/acas-code";
import { canTransition, initialState, stateDef } from "./machines";
export { APPEAL_GROUND_LABELS } from "./machines";
import { setStructuredFact } from "@/facts/service";

export type ProcessRow = typeof processes.$inferSelect;
export type AllegationRow = typeof allegations.$inferSelect;
export type AppealGroundRow = typeof appealGrounds.$inferSelect;

const isoDate = z.string().refine(isIsoDate, "Expected YYYY-MM-DD");

export const StartProcessInput = z.object({
    type: z.enum(PROCESS_TYPES),
    startedOn: isoDate.optional(),
    parentProcessId: z.string().optional(),
    initialState: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
});

export async function startProcess(actor: Actor, caseId: string, raw: z.input<typeof StartProcessInput>): Promise<ProcessRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = StartProcessInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the process details.", parsed.error.flatten());
    const input = parsed.data;
    const db = await getDb();
    const id = newId();
    const startedOn = input.startedOn ?? todayISO();
    const state = input.initialState && stateDef(input.type, input.initialState) ? input.initialState : initialState(input.type);
    const code = input.type === "acas_early_conciliation" || input.type === "informal" ? null : acasCodeForDate(startedOn).id;
    await db.insert(processes).values({
        id,
        caseId,
        type: input.type,
        state,
        data: (input.data ?? {}) as ProcessData,
        parentProcessId: input.parentProcessId ?? null,
        acasCodeVersion: code,
        startedAt: new Date(`${startedOn}T00:00:00Z`),
    });
    await db.insert(processTransitions).values({ id: newId(), processId: id, fromState: null, toState: state });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "process.started", targetType: "process", targetId: id, details: { type: input.type, state } });
    return getProcess(actor, caseId, id);
}

export async function getProcess(actor: Actor, caseId: string, processId: string): Promise<ProcessRow> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const rows = await db.select().from(processes).where(and(eq(processes.id, processId), eq(processes.caseId, caseId))).limit(1);
    if (!rows[0]) throw new ValidationError("Process not found.");
    return rows[0];
}

export async function listProcesses(actor: Actor, caseId: string, type?: ProcessType): Promise<ProcessRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const where = type ? and(eq(processes.caseId, caseId), eq(processes.type, type)) : eq(processes.caseId, caseId);
    return db.select().from(processes).where(where).orderBy(asc(processes.startedAt));
}

export async function transitionProcess(actor: Actor, caseId: string, processId: string, to: string, note?: string): Promise<ProcessRow> {
    const proc = await getProcess(actor, caseId, processId);
    if (!canTransition(proc.type, proc.state, to)) {
        const def = stateDef(proc.type, proc.state);
        throw new ValidationError(`You cannot move from "${def?.label ?? proc.state}" to "${to}". Allowed next steps: ${def?.next.join(", ") || "none"}.`);
    }
    const db = await getDb();
    const terminal = stateDef(proc.type, to)?.terminal ?? false;
    await db.update(processes).set({ state: to, updatedAt: new Date(), closedAt: terminal ? new Date() : null }).where(eq(processes.id, processId));
    await db.insert(processTransitions).values({ id: newId(), processId, fromState: proc.state, toState: to, note: note ?? null });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "process.transition", targetType: "process", targetId: processId, details: { type: proc.type, from: proc.state, to } });
    return getProcess(actor, caseId, processId);
}

export async function listTransitions(actor: Actor, caseId: string, processId: string) {
    await getProcess(actor, caseId, processId);
    const db = await getDb();
    return db.select().from(processTransitions).where(eq(processTransitions.processId, processId)).orderBy(asc(processTransitions.occurredAt));
}

/** Shallow-merge structured process data. Acas dates are mirrored to facts. */
export async function updateProcessData(actor: Actor, caseId: string, processId: string, patch: Record<string, unknown>): Promise<ProcessRow> {
    const proc = await getProcess(actor, caseId, processId);
    const db = await getDb();
    for (const [k, v] of Object.entries(patch)) {
        if (/date$/i.test(k) && typeof v === "string" && v !== "" && !isIsoDate(v)) throw new ValidationError(`"${k}" must be a date in YYYY-MM-DD format.`);
    }
    const data = { ...(proc.data as Record<string, unknown>), ...patch } as ProcessData;
    await db.update(processes).set({ data, updatedAt: new Date() }).where(eq(processes.id, processId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "process.data_updated", targetType: "process", targetId: processId, details: { fields: Object.keys(patch) } });

    if (proc.type === "acas_early_conciliation") {
        const acas = data as AcasProcessData;
        if ("notificationDate" in patch) await setStructuredFact(actor, caseId, "acas_day_a", acas.notificationDate || null, acas.notificationDate ? `Acas Early Conciliation notified on ${acas.notificationDate} (Day A).` : undefined);
        if ("certificateIssueDate" in patch) await setStructuredFact(actor, caseId, "acas_day_b", acas.certificateIssueDate || null, acas.certificateIssueDate ? `Acas certificate issued on ${acas.certificateIssueDate} (Day B).` : undefined);
        if ("notificationDate" in patch || "certificateIssueDate" in patch) await markStale(caseId, "Acas dates changed", ["deadlines", "claims", "artifacts"]);
    }
    await markStale(caseId, "process details changed", ["artifacts"]);
    return getProcess(actor, caseId, processId);
}

// ---------------------------------------------------------------------------
// Allegations (disciplinary)
// ---------------------------------------------------------------------------

export const AllegationInput = z.object({
    employerAllegation: z.string().trim().min(3).max(4000),
    employerEvidence: z.string().trim().max(4000).nullable().optional(),
    workerResponse: z.string().trim().max(8000).nullable().optional(),
    workerEvidence: z.string().trim().max(4000).nullable().optional(),
    missingInformation: z.string().trim().max(4000).nullable().optional(),
    proceduralEventIds: z.array(z.string()).optional(),
    hearingQuestions: z.array(z.string().trim().max(500)).optional(),
    sourceDocumentId: z.string().nullable().optional(),
});

export async function addAllegation(actor: Actor, caseId: string, processId: string, raw: z.input<typeof AllegationInput>): Promise<AllegationRow> {
    await getProcess(actor, caseId, processId);
    const parsed = AllegationInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the allegation details.", parsed.error.flatten());
    const db = await getDb();
    const id = newId();
    await db.insert(allegations).values({
        id,
        caseId,
        processId,
        employerAllegation: parsed.data.employerAllegation,
        employerEvidence: parsed.data.employerEvidence ?? null,
        workerResponse: parsed.data.workerResponse ?? null,
        workerEvidence: parsed.data.workerEvidence ?? null,
        missingInformation: parsed.data.missingInformation ?? null,
        proceduralEventIds: parsed.data.proceduralEventIds ?? [],
        hearingQuestions: parsed.data.hearingQuestions ?? [],
        sourceDocumentId: parsed.data.sourceDocumentId ?? null,
        provenance: parsed.data.sourceDocumentId ? "EMPLOYER_ALLEGATION" : "USER_ALLEGATION",
        status: "open",
    });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "allegation.added", targetType: "allegation", targetId: id });
    await markStale(caseId, "allegations changed", ["artifacts"]);
    return (await db.select().from(allegations).where(eq(allegations.id, id)))[0];
}

export async function listAllegations(actor: Actor, caseId: string, processId: string): Promise<AllegationRow[]> {
    await getProcess(actor, caseId, processId);
    const db = await getDb();
    return db.select().from(allegations).where(eq(allegations.processId, processId)).orderBy(asc(allegations.createdAt));
}

export async function updateAllegation(actor: Actor, caseId: string, allegationId: string, raw: Partial<z.input<typeof AllegationInput>> & { status?: "proposed" | "open" | "responded" | "withdrawn" }): Promise<AllegationRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = AllegationInput.partial().extend({ status: z.enum(["proposed", "open", "responded", "withdrawn"]).optional() }).safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the allegation details.", parsed.error.flatten());
    const db = await getDb();
    const existing = (await db.select().from(allegations).where(and(eq(allegations.id, allegationId), eq(allegations.caseId, caseId))))[0];
    if (!existing) throw new ValidationError("Allegation not found.");
    const patch: Partial<typeof allegations.$inferInsert> = { ...parsed.data, updatedAt: new Date() };
    if (existing.status === "proposed" && !parsed.data.status) patch.status = "open";
    await db.update(allegations).set(patch).where(eq(allegations.id, allegationId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "allegation.updated", targetType: "allegation", targetId: allegationId, details: { fields: Object.keys(parsed.data) } });
    await markStale(caseId, "allegations changed", ["artifacts"]);
    return (await db.select().from(allegations).where(eq(allegations.id, allegationId)))[0];
}

export async function deleteAllegation(actor: Actor, caseId: string, allegationId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.delete(allegations).where(and(eq(allegations.id, allegationId), eq(allegations.caseId, caseId)));
    await recordAudit({ userId: actor.userId, caseId, action: "allegation.deleted", targetType: "allegation", targetId: allegationId });
}

// ---------------------------------------------------------------------------
// Appeal grounds
// ---------------------------------------------------------------------------

export const AppealGroundInput = z.object({
    category: z.enum(APPEAL_GROUND_CATEGORIES),
    summary: z.string().trim().min(3).max(1000),
    detail: z.string().trim().max(8000).nullable().optional(),
    supportingFactIds: z.array(z.string()).optional(),
    supportingDocumentIds: z.array(z.string()).optional(),
    selected: z.boolean().optional(),
});


export async function addAppealGround(actor: Actor, caseId: string, processId: string, raw: z.input<typeof AppealGroundInput>): Promise<AppealGroundRow> {
    await getProcess(actor, caseId, processId);
    const parsed = AppealGroundInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the appeal ground.", parsed.error.flatten());
    const db = await getDb();
    const id = newId();
    await db.insert(appealGrounds).values({
        id,
        caseId,
        processId,
        category: parsed.data.category,
        summary: parsed.data.summary,
        detail: parsed.data.detail ?? null,
        supportingFactIds: parsed.data.supportingFactIds ?? [],
        supportingDocumentIds: parsed.data.supportingDocumentIds ?? [],
        selected: parsed.data.selected ?? true,
    });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "appeal_ground.added", targetType: "appeal_ground", targetId: id, details: { category: parsed.data.category } });
    await markStale(caseId, "appeal grounds changed", ["artifacts"]);
    return (await db.select().from(appealGrounds).where(eq(appealGrounds.id, id)))[0];
}

export async function listAppealGrounds(actor: Actor, caseId: string, processId: string): Promise<AppealGroundRow[]> {
    await getProcess(actor, caseId, processId);
    const db = await getDb();
    return db.select().from(appealGrounds).where(eq(appealGrounds.processId, processId)).orderBy(asc(appealGrounds.createdAt));
}

export async function updateAppealGround(actor: Actor, caseId: string, groundId: string, raw: Partial<z.input<typeof AppealGroundInput>>): Promise<AppealGroundRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = AppealGroundInput.partial().safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the appeal ground.", parsed.error.flatten());
    const db = await getDb();
    await db.update(appealGrounds).set(parsed.data).where(and(eq(appealGrounds.id, groundId), eq(appealGrounds.caseId, caseId)));
    const row = (await db.select().from(appealGrounds).where(and(eq(appealGrounds.id, groundId), eq(appealGrounds.caseId, caseId))))[0];
    if (!row) throw new ValidationError("Appeal ground not found.");
    await markStale(caseId, "appeal grounds changed", ["artifacts"]);
    return row;
}

export async function deleteAppealGround(actor: Actor, caseId: string, groundId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.delete(appealGrounds).where(and(eq(appealGrounds.id, groundId), eq(appealGrounds.caseId, caseId)));
}

/** Convenience: the single Acas process for a case, if any. */
export async function getAcasProcess(caseId: string): Promise<ProcessRow | null> {
    const db = await getDb();
    const rows = await db.select().from(processes).where(and(eq(processes.caseId, caseId), eq(processes.type, "acas_early_conciliation"))).orderBy(asc(processes.startedAt));
    return rows[rows.length - 1] ?? null;
}
