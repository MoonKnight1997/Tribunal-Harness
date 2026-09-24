/**
 * Staleness and dependency tracking.
 *
 * When a source fact changes (a date, a status, a confirmed event), everything
 * derived from it must be marked stale rather than left silently wrong. This
 * module is the single place that knows which derived artefacts depend on
 * which kinds of input. Services call `markStale(caseId, reason, kinds)` after
 * a material change; regeneration is explicit and user-triggered.
 *
 * Dependency map
 *   employment dates / status  → deadlines, claims, artifacts, summary
 *   dismissal / last-act facts → deadlines, claims, artifacts, summary
 *   Acas dates                 → deadlines, claims, artifacts
 *   confirmed events           → claims, artifacts (chronology), summary
 *   facts                      → claims, artifacts, summary
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { artifacts, cases, claimCandidates, deadlines } from "@/db/schema";

export type StaleKind = "deadlines" | "claims" | "artifacts" | "summary";

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
        case "dismissal_date":
        case "effective_date_of_termination":
        case "date_of_last_act":
        case "employment_start":
        case "employment_end":
            return ["deadlines", "claims", "artifacts", "summary"];
        case "acas_day_a":
        case "acas_day_b":
            return ["deadlines", "claims", "artifacts"];
        default:
            return ["claims", "artifacts", "summary"];
    }
}
