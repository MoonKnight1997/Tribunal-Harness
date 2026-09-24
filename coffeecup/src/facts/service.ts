/**
 * Facts — every material proposition relied on by analysis.
 *
 * A Fact carries provenance (who says so) and status (proposed → confirmed /
 * rejected / superseded). Model-derived facts enter as `proposed` with
 * MODEL_INFERENCE or DOCUMENT_EXTRACTED provenance and become
 * USER_CONFIRMED / DOCUMENT_CONFIRMED only when the user confirms them.
 * Nothing in the system may promote provenance silently.
 *
 * Structured facts carry a `key` (e.g. dismissal_date) and `value` so the
 * deadline and claim engines can read them without parsing prose.
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { facts, PROVENANCES, type Provenance } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/dates";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { markStale, staleKindsForFactKey } from "@/cases/staleness";

export type FactRow = typeof facts.$inferSelect;

/** Structured fact keys the engines understand. */
export const STRUCTURED_FACT_KEYS = [
    "employment_start",
    "employment_end",
    "dismissal_date",
    "effective_date_of_termination",
    "date_of_last_act",
    "date_of_deduction",
    "acas_day_a",
    "acas_day_b",
    "grievance_submitted_date",
    "grievance_outcome_date",
    "disciplinary_outcome_date",
    "appeal_submitted_date",
    "appeal_outcome_date",
] as const;
export type StructuredFactKey = (typeof STRUCTURED_FACT_KEYS)[number];

const DATE_KEYS = new Set<string>(STRUCTURED_FACT_KEYS);

export const FactInput = z.object({
    statement: z.string().trim().min(3).max(4000),
    provenance: z.enum(PROVENANCES).default("USER_ALLEGATION"),
    status: z.enum(["proposed", "confirmed"]).default("confirmed"),
    disputed: z.boolean().default(false),
    confidence: z.number().int().min(0).max(100).nullable().optional(),
    key: z.string().trim().max(80).nullable().optional(),
    value: z.string().trim().max(400).nullable().optional(),
    sourceDocumentId: z.string().nullable().optional(),
    sourceEventId: z.string().nullable().optional(),
    issueId: z.string().nullable().optional(),
});

function validateKeyValue(key: string | null | undefined, value: string | null | undefined): void {
    if (key && DATE_KEYS.has(key)) {
        if (!value || !isIsoDate(value)) throw new ValidationError(`The fact "${key}" needs a valid date (YYYY-MM-DD).`);
    }
}

/**
 * Provenance rules when the USER records a fact directly:
 * - a fact the user asserts about their own experience is USER_ALLEGATION until
 *   they explicitly confirm it (then USER_CONFIRMED);
 * - a user cannot record a fact as DOCUMENT_CONFIRMED or LEGAL_SOURCE — those
 *   are set by the document and legal pipelines only.
 */
export async function addFact(actor: Actor, caseId: string, raw: z.input<typeof FactInput>): Promise<FactRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = FactInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the fact you entered.", parsed.error.flatten());
    const input = parsed.data;
    validateKeyValue(input.key, input.value);
    let provenance: Provenance = input.provenance;
    if (provenance === "DOCUMENT_CONFIRMED" || provenance === "LEGAL_SOURCE") provenance = "USER_ALLEGATION";
    if (input.status === "confirmed" && (provenance === "USER_ALLEGATION" || provenance === "UNKNOWN")) provenance = "USER_CONFIRMED";
    if (input.status === "confirmed" && provenance === "MODEL_INFERENCE") provenance = "USER_CONFIRMED";

    const db = await getDb();
    const id = newId();
    await db.insert(facts).values({
        id,
        caseId,
        statement: input.statement,
        provenance,
        status: input.status,
        disputed: input.disputed,
        confidence: input.confidence ?? null,
        key: input.key ?? null,
        value: input.value ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        sourceEventId: input.sourceEventId ?? null,
        issueId: input.issueId ?? null,
    });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "fact.added", targetType: "fact", targetId: id, details: { provenance, status: input.status, key: input.key ?? null } });
    if (input.status === "confirmed") await markStale(caseId, "a fact was added", staleKindsForFactKey(input.key));
    return getFact(caseId, id);
}

/** System entry point for pipeline-proposed facts (extraction). Never confirmed. */
export async function proposeFact(caseId: string, input: { statement: string; provenance: Provenance; confidence?: number; key?: string | null; value?: string | null; sourceDocumentId?: string | null; sourceEventId?: string | null }): Promise<FactRow> {
    const db = await getDb();
    const id = newId();
    if (input.key && DATE_KEYS.has(input.key) && (!input.value || !isIsoDate(input.value))) {
        // Do not propose a structured date fact with an unusable value.
        input = { ...input, key: null, value: null };
    }
    await db.insert(facts).values({
        id,
        caseId,
        statement: input.statement.slice(0, 4000),
        provenance: input.provenance === "USER_CONFIRMED" || input.provenance === "DOCUMENT_CONFIRMED" ? "DOCUMENT_EXTRACTED" : input.provenance,
        status: "proposed",
        confidence: input.confidence ?? null,
        key: input.key ?? null,
        value: input.value ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        sourceEventId: input.sourceEventId ?? null,
    });
    await recordAudit({ caseId, action: "fact.proposed", targetType: "fact", targetId: id, details: { provenance: input.provenance, key: input.key ?? null } });
    return getFact(caseId, id);
}

async function getFact(caseId: string, factId: string): Promise<FactRow> {
    const db = await getDb();
    const rows = await db.select().from(facts).where(and(eq(facts.id, factId), eq(facts.caseId, caseId))).limit(1);
    if (!rows[0]) throw new ValidationError("Fact not found.");
    return rows[0];
}

export async function listFacts(actor: Actor, caseId: string, opts?: { status?: string }): Promise<FactRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const where = opts?.status ? and(eq(facts.caseId, caseId), eq(facts.status, opts.status)) : eq(facts.caseId, caseId);
    return db.select().from(facts).where(where).orderBy(desc(facts.createdAt));
}

/** Confirmed, non-superseded facts — the only facts engines may rely on. */
export async function listConfirmedFacts(caseId: string): Promise<FactRow[]> {
    const db = await getDb();
    return db.select().from(facts).where(and(eq(facts.caseId, caseId), eq(facts.status, "confirmed"))).orderBy(facts.createdAt);
}

export async function getStructuredFact(caseId: string, key: StructuredFactKey): Promise<FactRow | null> {
    const db = await getDb();
    const rows = await db
        .select()
        .from(facts)
        .where(and(eq(facts.caseId, caseId), eq(facts.key, key), eq(facts.status, "confirmed")))
        .orderBy(desc(facts.updatedAt))
        .limit(1);
    return rows[0] ?? null;
}

export async function confirmFact(actor: Actor, caseId: string, factId: string): Promise<FactRow> {
    await requireCaseAccess(actor, caseId);
    const fact = await getFact(caseId, factId);
    const db = await getDb();
    const provenance: Provenance =
        fact.provenance === "DOCUMENT_EXTRACTED" ? "DOCUMENT_CONFIRMED" : fact.provenance === "EMPLOYER_ALLEGATION" ? "EMPLOYER_ALLEGATION" : "USER_CONFIRMED";
    await db.update(facts).set({ status: "confirmed", provenance, updatedAt: new Date() }).where(eq(facts.id, factId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "fact.confirmed", targetType: "fact", targetId: factId, details: { from: fact.provenance, to: provenance } });
    await markStale(caseId, "a fact was confirmed", staleKindsForFactKey(fact.key));
    return getFact(caseId, factId);
}

export async function rejectFact(actor: Actor, caseId: string, factId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const fact = await getFact(caseId, factId);
    const db = await getDb();
    await db.update(facts).set({ status: "rejected", updatedAt: new Date() }).where(eq(facts.id, factId));
    await recordAudit({ userId: actor.userId, caseId, action: "fact.rejected", targetType: "fact", targetId: factId });
    if (fact.status === "confirmed") await markStale(caseId, "a fact was rejected", staleKindsForFactKey(fact.key));
}

export const CorrectFactInput = z.object({
    statement: z.string().trim().min(3).max(4000).optional(),
    value: z.string().trim().max(400).nullable().optional(),
    disputed: z.boolean().optional(),
});

/**
 * Correct a fact. The old row is marked superseded (kept for audit) and a new
 * confirmed row with USER_CONFIRMED provenance replaces it. Downstream
 * conclusions are marked stale. A known-wrong extraction is never kept live
 * merely because generated output already used it.
 */
export async function correctFact(actor: Actor, caseId: string, factId: string, raw: z.input<typeof CorrectFactInput>): Promise<FactRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = CorrectFactInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the correction.", parsed.error.flatten());
    const old = await getFact(caseId, factId);
    const value = parsed.data.value !== undefined ? parsed.data.value : old.value;
    validateKeyValue(old.key, value);
    const db = await getDb();
    const id = newId();
    await db.insert(facts).values({
        id,
        caseId,
        statement: parsed.data.statement ?? old.statement,
        provenance: "USER_CONFIRMED",
        status: "confirmed",
        disputed: parsed.data.disputed ?? old.disputed,
        confidence: null,
        key: old.key,
        value,
        sourceDocumentId: old.sourceDocumentId,
        sourceEventId: old.sourceEventId,
        issueId: old.issueId,
    });
    await db.update(facts).set({ status: "superseded", supersededById: id, updatedAt: new Date() }).where(eq(facts.id, factId));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "fact.corrected", targetType: "fact", targetId: id, details: { superseded: factId, key: old.key } });
    await markStale(caseId, `fact corrected${old.key ? ` (${old.key})` : ""}`, staleKindsForFactKey(old.key));
    return getFact(caseId, id);
}

/**
 * Upsert a structured fact from a form (e.g. the Acas workspace date fields).
 * Supersedes any previous confirmed value for the key.
 */
export async function setStructuredFact(actor: Actor, caseId: string, key: StructuredFactKey, value: string | null, statement?: string): Promise<FactRow | null> {
    await requireCaseAccess(actor, caseId);
    const existing = await getStructuredFact(caseId, key);
    if (value === null) {
        if (existing) {
            const db = await getDb();
            await db.update(facts).set({ status: "superseded", updatedAt: new Date() }).where(eq(facts.id, existing.id));
            await markStale(caseId, `${key} removed`, staleKindsForFactKey(key));
        }
        return null;
    }
    if (existing && existing.value === value) return existing;
    if (existing) {
        return correctFact(actor, caseId, existing.id, { value, statement: statement ?? existing.statement });
    }
    return addFact(actor, caseId, { statement: statement ?? `${key.replace(/_/g, " ")}: ${value}`, key, value, status: "confirmed", provenance: "USER_CONFIRMED" });
}
