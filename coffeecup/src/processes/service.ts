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
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isIsoDate, todayISO } from "@/lib/dates";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { markStale } from "@/cases/staleness";
import { assertCaseOwns } from "@/cases/references";
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
    await assertCaseOwns(caseId, { processIds: [input.parentProcessId] });
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
    // A process id from another case is indistinguishable from a missing one.
    if (!rows[0]) throw new NotFoundError("Process not found.");
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

// ---------------------------------------------------------------------------
// Acas dates: validation shared with intake
// ---------------------------------------------------------------------------

/** Empty strings from forms mean "cleared"; store null. */
const optionalDate = z.preprocess((v) => (v === "" ? null : v), isoDate.nullable().optional());

/**
 * Acas Early Conciliation date fields (ERA 1996 s207B(2)):
 * - notificationDate = Day A (the day Acas received the notification);
 * - certificateIssueDate = the date on the certificate (NOT Day B by itself);
 * - certificateReceivedDate = Day B when the worker knows it;
 * - certificateDeliveryMethod drives deemed receipt (email → sent date; post
 *   → we still use the issue date conservatively rather than invent a delay).
 */
export const AcasDatesInput = z.object({
    notificationDate: optionalDate,
    certificateIssueDate: optionalDate,
    certificateReceivedDate: optionalDate,
    certificateDeliveryMethod: z.preprocess((v) => (v === "" ? null : v), z.enum(["email", "post", "unknown"]).nullable().optional()),
});
export type AcasDatesInputType = z.input<typeof AcasDatesInput>;

export const ACAS_DATE_FIELDS = ["notificationDate", "certificateIssueDate", "certificateReceivedDate", "certificateDeliveryMethod"] as const;

/**
 * Reject reversed or inconsistent Acas dates at input. The engine also
 * refuses to clamp them, but the user should be told at the point of entry.
 */
export function validateAcasDates(d: { notificationDate?: string | null; certificateIssueDate?: string | null; certificateReceivedDate?: string | null }): void {
    const a = d.notificationDate ?? null;
    const issued = d.certificateIssueDate ?? null;
    const received = d.certificateReceivedDate ?? null;
    if ((issued || received) && !a) {
        throw new ValidationError("Please enter the date Acas received your notification (Day A) before the certificate dates. Day B cannot come before Day A.");
    }
    if (a && issued && issued < a) throw new ValidationError(`The certificate date (${issued}) cannot be before the date Acas received your notification (${a}).`);
    if (a && received && received < a) throw new ValidationError(`The date you received the certificate (${received}) cannot be before the date Acas received your notification (${a}).`);
    if (issued && received && received < issued) throw new ValidationError(`The date you received the certificate (${received}) cannot be before the date on the certificate (${issued}).`);
}

/**
 * Day B for the engine, from Acas process data. Receipt date when the worker
 * gave it; otherwise the issue date (conservative: never later than the true
 * Day B). Email delivery makes the issue date a deemed receipt date.
 */
export function resolveAcasDayB(acas: AcasProcessData): { dayB: string | null; basis: "received" | "issue_date_assumed" | "deemed_received" | "pending" | "none"; statement: string | null } {
    if (acas.certificateReceivedDate) return { dayB: acas.certificateReceivedDate, basis: "received", statement: `I received my Acas certificate on ${acas.certificateReceivedDate} (Day B).` };
    if (acas.certificateIssueDate) {
        if (acas.certificateDeliveryMethod === "email") return { dayB: acas.certificateIssueDate, basis: "deemed_received", statement: `My Acas certificate is dated ${acas.certificateIssueDate} and was sent by email, so it is treated as received that day (Day B).` };
        return { dayB: acas.certificateIssueDate, basis: "issue_date_assumed", statement: `My Acas certificate is dated ${acas.certificateIssueDate}; the date I received it is not recorded, so this is used as Day B.` };
    }
    if (acas.notificationDate) return { dayB: null, basis: "pending", statement: null };
    return { dayB: null, basis: "none", statement: null };
}

const APPEAL_WINDOW_MAX_DAYS = 60;

/**
 * Shallow-merge structured process data. Acas dates are validated and
 * mirrored to facts (acas_day_a / acas_day_b); outcome dates and appeal
 * windows mark deadlines stale so the employer-policy appeal deadline is
 * recomputed.
 */
export async function updateProcessData(actor: Actor, caseId: string, processId: string, patch: Record<string, unknown>): Promise<ProcessRow> {
    const proc = await getProcess(actor, caseId, processId);
    const db = await getDb();
    for (const [k, v] of Object.entries(patch)) {
        if (/date$/i.test(k) && typeof v === "string" && v !== "" && !isIsoDate(v)) throw new ValidationError(`"${k}" must be a date in YYYY-MM-DD format.`);
    }
    if ("appealWindowDays" in patch && patch.appealWindowDays !== null && patch.appealWindowDays !== undefined) {
        const n = patch.appealWindowDays;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > APPEAL_WINDOW_MAX_DAYS) {
            throw new ValidationError(`The number of days allowed to appeal must be a whole number between 1 and ${APPEAL_WINDOW_MAX_DAYS} (check the outcome letter).`);
        }
    }

    const before = proc.data as Record<string, unknown>;
    let effectivePatch: Record<string, unknown> = patch;
    const acasDatesTouched = proc.type === "acas_early_conciliation" && ACAS_DATE_FIELDS.some((f) => f in patch);
    if (proc.type === "acas_early_conciliation") {
        const parsed = AcasDatesInput.safeParse(patch);
        if (!parsed.success) throw new ValidationError("Please check the Acas dates.", parsed.error.flatten());
        const normalised: Record<string, unknown> = {};
        for (const f of ACAS_DATE_FIELDS) if (f in patch) normalised[f] = parsed.data[f] ?? null;
        effectivePatch = { ...patch, ...normalised };
        validateAcasDates({ ...(before as AcasProcessData), ...(normalised as Partial<AcasProcessData>) });
    }

    const data = { ...before, ...effectivePatch } as ProcessData;
    await db.update(processes).set({ data, updatedAt: new Date() }).where(eq(processes.id, processId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "process.data_updated", targetType: "process", targetId: processId, details: { fields: Object.keys(patch) } });

    if (proc.type === "acas_early_conciliation" && acasDatesTouched) {
        const acas = data as AcasProcessData;
        await setStructuredFact(actor, caseId, "acas_day_a", acas.notificationDate || null, acas.notificationDate ? `Acas Early Conciliation notified on ${acas.notificationDate} (Day A).` : undefined);
        const dayB = resolveAcasDayB(acas);
        await setStructuredFact(actor, caseId, "acas_day_b", dayB.dayB, dayB.statement ?? undefined);
        await markStale(caseId, "Acas dates changed", ["deadlines", "claims", "artifacts"]);
    }
    if ((proc.type === "grievance" || proc.type === "disciplinary") && (("outcomeDate" in patch && patch.outcomeDate !== before.outcomeDate) || ("appealWindowDays" in patch && patch.appealWindowDays !== before.appealWindowDays))) {
        await markStale(caseId, "outcome date or appeal window changed", ["deadlines", "artifacts"]);
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
    await assertCaseOwns(caseId, { documentIds: [parsed.data.sourceDocumentId], eventIds: parsed.data.proceduralEventIds });
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

/** (caseId, allegationId) lookup: foreign and missing ids raise the same NotFoundError. */
async function getAllegation(caseId: string, allegationId: string): Promise<AllegationRow> {
    const db = await getDb();
    const rows = await db.select().from(allegations).where(and(eq(allegations.id, allegationId), eq(allegations.caseId, caseId))).limit(1);
    if (!rows[0]) throw new NotFoundError("Allegation not found.");
    return rows[0];
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
    const existing = await getAllegation(caseId, allegationId);
    await assertCaseOwns(caseId, { documentIds: [parsed.data.sourceDocumentId], eventIds: parsed.data.proceduralEventIds });
    const patch: Partial<typeof allegations.$inferInsert> = { ...parsed.data, updatedAt: new Date() };
    if (existing.status === "proposed" && !parsed.data.status) patch.status = "open";
    await db.update(allegations).set(patch).where(and(eq(allegations.id, allegationId), eq(allegations.caseId, caseId)));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "allegation.updated", targetType: "allegation", targetId: allegationId, details: { fields: Object.keys(parsed.data) } });
    await markStale(caseId, "allegations changed", ["artifacts"]);
    return (await db.select().from(allegations).where(eq(allegations.id, allegationId)))[0];
}

export async function deleteAllegation(actor: Actor, caseId: string, allegationId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    await getAllegation(caseId, allegationId);
    const db = await getDb();
    await db.delete(allegations).where(and(eq(allegations.id, allegationId), eq(allegations.caseId, caseId)));
    await recordAudit({ userId: actor.userId, caseId, action: "allegation.deleted", targetType: "allegation", targetId: allegationId });
    await markStale(caseId, "allegations changed", ["artifacts"]);
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
    await assertCaseOwns(caseId, { factIds: parsed.data.supportingFactIds, documentIds: parsed.data.supportingDocumentIds });
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

/** (caseId, groundId) lookup: foreign and missing ids raise the same NotFoundError. */
async function getAppealGround(caseId: string, groundId: string): Promise<AppealGroundRow> {
    const db = await getDb();
    const rows = await db.select().from(appealGrounds).where(and(eq(appealGrounds.id, groundId), eq(appealGrounds.caseId, caseId))).limit(1);
    if (!rows[0]) throw new NotFoundError("Appeal ground not found.");
    return rows[0];
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
    await getAppealGround(caseId, groundId);
    await assertCaseOwns(caseId, { factIds: parsed.data.supportingFactIds, documentIds: parsed.data.supportingDocumentIds });
    const db = await getDb();
    await db.update(appealGrounds).set(parsed.data).where(and(eq(appealGrounds.id, groundId), eq(appealGrounds.caseId, caseId)));
    const row = await getAppealGround(caseId, groundId);
    await recordAudit({ userId: actor.userId, caseId, action: "appeal_ground.updated", targetType: "appeal_ground", targetId: groundId, details: { fields: Object.keys(parsed.data) } });
    await markStale(caseId, "appeal grounds changed", ["artifacts"]);
    return row;
}

export async function deleteAppealGround(actor: Actor, caseId: string, groundId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    await getAppealGround(caseId, groundId);
    const db = await getDb();
    await db.delete(appealGrounds).where(and(eq(appealGrounds.id, groundId), eq(appealGrounds.caseId, caseId)));
    await recordAudit({ userId: actor.userId, caseId, action: "appeal_ground.deleted", targetType: "appeal_ground", targetId: groundId });
    await markStale(caseId, "appeal grounds changed", ["artifacts"]);
}

/** Convenience: the single Acas process for a case, if any. */
export async function getAcasProcess(caseId: string): Promise<ProcessRow | null> {
    const db = await getDb();
    const rows = await db.select().from(processes).where(and(eq(processes.caseId, caseId), eq(processes.type, "acas_early_conciliation"))).orderBy(asc(processes.startedAt));
    return rows[rows.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Evidence inbox decisions on proposed allegations (appended; see src/review)
// ---------------------------------------------------------------------------

/**
 * Record a proposed allegation as the employer's allegation (status proposed →
 * open). Provenance stays EMPLOYER_ALLEGATION: recording what the employer says
 * is not agreeing with it, and it never becomes a confirmed fact by itself.
 */
export async function acceptAllegation(actor: Actor, caseId: string, allegationId: string): Promise<AllegationRow> {
    await requireCaseAccess(actor, caseId);
    const existing = await getAllegation(caseId, allegationId);
    const db = await getDb();
    if (existing.status === "proposed") {
        await db.update(allegations).set({ status: "open", provenance: "EMPLOYER_ALLEGATION", updatedAt: new Date() }).where(and(eq(allegations.id, allegationId), eq(allegations.caseId, caseId)));
        await touchCase(caseId);
        await recordAudit({ userId: actor.userId, caseId, action: "allegation.accepted", targetType: "allegation", targetId: allegationId });
        await markStale(caseId, "allegations changed", ["artifacts"]);
    }
    return getAllegation(caseId, allegationId);
}

/** The proposal was not an allegation (or was wrong): withdraw it. The row is kept for audit. */
export async function withdrawAllegation(actor: Actor, caseId: string, allegationId: string): Promise<AllegationRow> {
    await requireCaseAccess(actor, caseId);
    const existing = await getAllegation(caseId, allegationId);
    const db = await getDb();
    await db.update(allegations).set({ status: "withdrawn", updatedAt: new Date() }).where(and(eq(allegations.id, allegationId), eq(allegations.caseId, caseId)));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "allegation.withdrawn", targetType: "allegation", targetId: allegationId, details: { wasProposed: existing.status === "proposed" } });
    await markStale(caseId, "allegations changed", ["artifacts"]);
    return getAllegation(caseId, allegationId);
}
