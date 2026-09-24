/**
 * Tenancy guard.
 *
 * Every case-scoped operation goes through `requireCaseAccess`, which loads
 * the case *by id AND owner* in one query. A guessed id for someone else's
 * case yields the same NotFoundError as a non-existent id, so nothing about
 * other tenants' data is revealed.
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cases } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";

export interface Actor {
    userId: string;
}

export type CaseRow = typeof cases.$inferSelect;

export async function requireCaseAccess(actor: Actor, caseId: string): Promise<CaseRow> {
    if (!actor?.userId || !caseId) throw new NotFoundError("Case not found.");
    const db = await getDb();
    const rows = await db
        .select()
        .from(cases)
        .where(and(eq(cases.id, caseId), eq(cases.userId, actor.userId), isNull(cases.deletedAt)))
        .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError("Case not found.");
    return row;
}

/** Bump lastActivityAt; called by mutating services. */
export async function touchCase(caseId: string): Promise<void> {
    const db = await getDb();
    const now = new Date();
    await db.update(cases).set({ lastActivityAt: now, updatedAt: now }).where(eq(cases.id, caseId));
}
