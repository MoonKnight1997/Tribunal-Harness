/**
 * Case service — the authoritative record for a workplace problem.
 *
 * Every function takes an `Actor` and enforces tenancy through
 * requireCaseAccess. Mutations write an audit event and touch the case.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
    cases,
    employmentRelationships,
    persons,
    CASE_STAGES,
    EMPLOYMENT_STATUSES,
    ENTRY_ROUTES,
    JURISDICTIONS,
    type CaseStage,
    type EntryRoute,
    type IntakeAnswers,
    type Jurisdiction,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/dates";
import { recordAudit } from "./audit";
import { requireCaseAccess, touchCase, type Actor, type CaseRow } from "./access";
import { stageForEntryRoute } from "./stages";
import { markStale } from "./staleness";

const isoDate = z.string().refine(isIsoDate, "Expected a date in YYYY-MM-DD format");

export const CreateCaseInput = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    jurisdiction: z.enum(JURISDICTIONS).default("england_wales"),
    entryRoute: z.enum(ENTRY_ROUTES).default("not_sure"),
    intake: z
        .object({
            situationDescription: z.string().max(20_000).optional(),
            stillEmployed: z.boolean().optional(),
            keyDates: z.record(z.string(), isoDate).optional(),
            currentProceduralStage: z.string().max(200).optional(),
            urgencyNotes: z.string().max(2_000).optional(),
            inferredRoutes: z.array(z.enum(ENTRY_ROUTES)).optional(),
        })
        .default({}),
});
export type CreateCaseInputType = z.input<typeof CreateCaseInput>;

export async function createCase(actor: Actor, raw: CreateCaseInputType): Promise<CaseRow> {
    const parsed = CreateCaseInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the details you entered.", parsed.error.flatten());
    const input = parsed.data;
    const db = await getDb();
    const id = newId();
    const title = input.title ?? defaultTitle(input.entryRoute);
    await db.insert(cases).values({
        id,
        userId: actor.userId,
        title,
        jurisdiction: input.jurisdiction,
        entryRoute: input.entryRoute,
        stage: stageForEntryRoute(input.entryRoute),
        intake: input.intake as IntakeAnswers,
    });
    await db.insert(employmentRelationships).values({
        id: newId(),
        caseId: id,
        stillEmployed: input.intake.stillEmployed ?? null,
    });
    await recordAudit({ userId: actor.userId, caseId: id, action: "case.created", details: { entryRoute: input.entryRoute, jurisdiction: input.jurisdiction } });
    return requireCaseAccess(actor, id);
}

function defaultTitle(route: EntryRoute): string {
    const labels: Partial<Record<EntryRoute, string>> = {
        grievance: "My grievance",
        disciplinary: "My disciplinary process",
        appeal: "My appeal",
        dismissal: "My dismissal",
        redundancy: "My redundancy",
        discrimination: "Unfair treatment at work",
        disability_adjustments: "Adjustments at work",
        whistleblowing: "Raising a concern at work",
        pay: "My pay problem",
        contract_change: "Changes to my contract",
        acas_early_conciliation: "Acas Early Conciliation",
        acas_certificate_received: "After my Acas certificate",
        considering_tribunal: "Considering a tribunal claim",
        et1_preparation: "Preparing my ET1",
    };
    return labels[route] ?? "My problem at work";
}

export async function listCases(actor: Actor): Promise<CaseRow[]> {
    const db = await getDb();
    return db
        .select()
        .from(cases)
        .where(and(eq(cases.userId, actor.userId), isNull(cases.deletedAt)))
        .orderBy(desc(cases.lastActivityAt));
}

export async function getCase(actor: Actor, caseId: string): Promise<CaseRow> {
    return requireCaseAccess(actor, caseId);
}

export const UpdateCaseInput = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    jurisdiction: z.enum(JURISDICTIONS).optional(),
    stage: z.enum(CASE_STAGES).optional(),
    status: z.enum(["active", "paused", "resolved", "closed"]).optional(),
    situationSummary: z.string().max(5_000).nullable().optional(),
    intake: CreateCaseInput.shape.intake.optional(),
});

export async function updateCase(actor: Actor, caseId: string, raw: z.input<typeof UpdateCaseInput>): Promise<CaseRow> {
    const existing = await requireCaseAccess(actor, caseId);
    const parsed = UpdateCaseInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the details you entered.", parsed.error.flatten());
    const input = parsed.data;
    const db = await getDb();
    const patch: Partial<typeof cases.$inferInsert> = { updatedAt: new Date(), lastActivityAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.jurisdiction !== undefined) patch.jurisdiction = input.jurisdiction as Jurisdiction;
    if (input.stage !== undefined) patch.stage = input.stage as CaseStage;
    if (input.status !== undefined) patch.status = input.status;
    if (input.situationSummary !== undefined) {
        patch.situationSummary = input.situationSummary;
        patch.summaryStale = false;
    }
    if (input.intake !== undefined) patch.intake = { ...existing.intake, ...input.intake } as IntakeAnswers;
    await db.update(cases).set(patch).where(eq(cases.id, caseId));
    await recordAudit({ userId: actor.userId, caseId, action: "case.updated", details: { fields: Object.keys(input) } });
    if (input.jurisdiction !== undefined && input.jurisdiction !== existing.jurisdiction) {
        await markStale(caseId, "jurisdiction changed", ["deadlines", "claims", "artifacts", "summary"]);
    }
    return requireCaseAccess(actor, caseId);
}

export async function setStage(actor: Actor, caseId: string, stage: CaseStage): Promise<CaseRow> {
    return updateCase(actor, caseId, { stage });
}

/** Soft delete: the row is kept for the retention window, then purged (see retention.ts). */
export async function deleteCase(actor: Actor, caseId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.update(cases).set({ deletedAt: new Date(), status: "deleted" }).where(eq(cases.id, caseId));
    await recordAudit({ userId: actor.userId, caseId, action: "case.deleted" });
}

// ---------------------------------------------------------------------------
// Employment relationship
// ---------------------------------------------------------------------------

export const EmploymentInput = z.object({
    employerName: z.string().trim().max(200).nullable().optional(),
    respondentLegalEntity: z.string().trim().max(200).nullable().optional(),
    respondentAddress: z.string().trim().max(500).nullable().optional(),
    jobTitle: z.string().trim().max(200).nullable().optional(),
    employmentStatus: z.enum(EMPLOYMENT_STATUSES).nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    stillEmployed: z.boolean().nullable().optional(),
    payAmount: z.string().trim().max(50).nullable().optional(),
    payPeriod: z.string().trim().max(50).nullable().optional(),
    hoursPerWeek: z.string().trim().max(50).nullable().optional(),
    workplace: z.string().trim().max(300).nullable().optional(),
    contractualDetails: z.record(z.string(), z.string().max(2000)).optional(),
});

export type EmploymentRow = typeof employmentRelationships.$inferSelect;

export async function getEmployment(actor: Actor, caseId: string): Promise<EmploymentRow> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const rows = await db.select().from(employmentRelationships).where(eq(employmentRelationships.caseId, caseId)).limit(1);
    if (rows[0]) return rows[0];
    const id = newId();
    await db.insert(employmentRelationships).values({ id, caseId });
    return (await db.select().from(employmentRelationships).where(eq(employmentRelationships.id, id)))[0];
}

export async function updateEmployment(actor: Actor, caseId: string, raw: z.input<typeof EmploymentInput>): Promise<EmploymentRow> {
    const before = await getEmployment(actor, caseId);
    const parsed = EmploymentInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the employment details.", parsed.error.flatten());
    const input = parsed.data;
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
        throw new ValidationError("The end date cannot be before the start date.");
    }
    const db = await getDb();
    await db
        .update(employmentRelationships)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(employmentRelationships.caseId, caseId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "employment.updated", details: { fields: Object.keys(input) } });

    // Date changes invalidate downstream calculations (see staleness.ts).
    const dateChanged =
        (input.startDate !== undefined && input.startDate !== before.startDate) ||
        (input.endDate !== undefined && input.endDate !== before.endDate) ||
        (input.employmentStatus !== undefined && input.employmentStatus !== before.employmentStatus);
    if (dateChanged) {
        await markStale(caseId, "employment dates or status changed", ["deadlines", "claims", "artifacts", "summary"]);
    }
    return getEmployment(actor, caseId);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const PersonInput = z.object({
    name: z.string().trim().min(1).max(200),
    role: z.enum(["manager", "hr", "witness", "representative", "colleague", "conciliator", "other"]).default("other"),
    organisation: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(2_000).nullable().optional(),
});

export type PersonRow = typeof persons.$inferSelect;

export async function listPersons(actor: Actor, caseId: string): Promise<PersonRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    return db.select().from(persons).where(eq(persons.caseId, caseId)).orderBy(persons.createdAt);
}

export async function addPerson(actor: Actor, caseId: string, raw: z.input<typeof PersonInput>): Promise<PersonRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = PersonInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the person's details.", parsed.error.flatten());
    const db = await getDb();
    const id = newId();
    await db.insert(persons).values({ id, caseId, ...parsed.data });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "person.added", targetType: "person", targetId: id, details: { role: parsed.data.role } });
    return (await db.select().from(persons).where(eq(persons.id, id)))[0];
}

export async function updatePerson(actor: Actor, caseId: string, personId: string, raw: Partial<z.input<typeof PersonInput>>): Promise<PersonRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = PersonInput.partial().safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the person's details.", parsed.error.flatten());
    const db = await getDb();
    await db.update(persons).set(parsed.data).where(and(eq(persons.id, personId), eq(persons.caseId, caseId)));
    const rows = await db.select().from(persons).where(and(eq(persons.id, personId), eq(persons.caseId, caseId)));
    if (!rows[0]) throw new ValidationError("Person not found.");
    return rows[0];
}

export async function removePerson(actor: Actor, caseId: string, personId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.delete(persons).where(and(eq(persons.id, personId), eq(persons.caseId, caseId)));
}
