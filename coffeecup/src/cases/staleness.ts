/**
 * Staleness and dependency tracking.
 *
 * When a source fact changes (a date, a status, a confirmed event), everything
 * derived from it must be marked stale rather than left silently wrong. This
 * module is the single place that knows which derived artefacts depend on
 * which kinds of input. Services call `markStale(caseId, reason, kinds)` after
 * a material change; regeneration is explicit and user-triggered (deadlines
 * are the exception: `listDeadlines` recomputes stale rows on read).
 *
 * Dependency map
 *   employment dates / status  → deadlines, claims, artifacts, summary
 *   dismissal / last-act facts → deadlines, claims, artifacts, summary
 *   deduction / outcome facts  → deadlines, claims, artifacts, summary
 *   Acas dates                 → deadlines, claims, artifacts
 *   process outcome / window   → deadlines, artifacts
 *   confirmed events           → claims, artifacts (chronology), summary
 *   facts                      → claims, artifacts, summary
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { artifacts, cases, claimCandidates, deadlines } from "@/db/schema";

export type StaleKind = "deadlines" | "claims" | "artifacts" | "summary";

/**
 * Every input the deadline engine consumes. Anyone adding a new input to
 * `src/legal/deadlines/case-deadlines.ts` adds it here too, and the service
 * that writes that input must call `markStale(..., ["deadlines"])`.
 */
export const DEADLINE_INPUTS = {
    /** Structured fact keys read by the engine (facts.value + facts.valuePrecision, confirmed rows only). */
    factKeys: [
        "dismissal_date",
        "effective_date_of_termination",
        "date_of_last_act",
        "date_of_deduction",
        "employment_end",
        "acas_day_a",
        "acas_day_b",
        "grievance_outcome_date",
        "disciplinary_outcome_date",
        "appeal_submitted_date",
        "appeal_outcome_date",
    ],
    /** employment_relationships columns. */
    employmentFields: ["endDate", "endDatePrecision", "startDate", "startDatePrecision", "stillEmployed", "employmentStatus"],
    /** AcasProcessData fields (processes.data where type = acas_early_conciliation). */
    acasFields: ["notificationDate", "certificateIssueDate", "certificateReceivedDate", "certificateDeliveryMethod"],
    /** Grievance / disciplinary process data fields (employer-policy appeal windows). */
    processFields: ["outcomeDate", "appealWindowDays"],
    /** cases columns. */
    caseFields: ["jurisdiction", "entryRoute"],
    /** issues.category feeds relevantFamilies(). */
    issueFields: ["category"],
} as const;

const DEADLINE_FACT_KEYS: ReadonlySet<string> = new Set(DEADLINE_INPUTS.factKeys);

export async function markStale(caseId: string, reason: string, kinds: StaleKind[]): Promise<void> {
    const db = await getDb();
    const set = new Set(kinds);
    if (set.has("deadlines")) {
        await db.update(deadlines).set({ status: "stale" }).where(eq(deadlines.caseId, caseId));
    }
    if (set.has("claims")) {
        await db.update(claimCandidates).set({ stale: true, staleReason: reason }).where(eq(claimCandidates.caseId, caseId));
    }
    if (set.has("artifacts")) {
        await db.update(artifacts).set({ stale: true, staleReason: reason }).where(eq(artifacts.caseId, caseId));
    }
    if (set.has("summary")) {
        await db.update(cases).set({ summaryStale: true }).where(eq(cases.id, caseId));
    }
}

/** Inputs that changed → which derived kinds to invalidate. */
export function staleKindsForFactKey(key: string | null | undefined): StaleKind[] {
    switch (key) {
        case "acas_day_a":
        case "acas_day_b":
            return ["deadlines", "claims", "artifacts"];
        case "employment_start":
            return ["deadlines", "claims", "artifacts", "summary"];
        default:
            if (key && DEADLINE_FACT_KEYS.has(key)) return ["deadlines", "claims", "artifacts", "summary"];
            return ["claims", "artifacts", "summary"];
    }
}
