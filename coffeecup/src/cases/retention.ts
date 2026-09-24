/**
 * Retention and deletion.
 *
 * - Soft-deleted cases are purged (rows and stored files) after the retention
 *   window (default 30 days) by `purgeExpiredCases`, run from the jobs worker.
 * - Account deletion removes the user; cascading foreign keys remove cases,
 *   sessions and entitlements. Stored file bodies are removed explicitly.
 * - Audit rows are retained (they hold ids and actions, not content).
 */

import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cases, documents, users } from "@/db/schema";
import { getStorage } from "@/documents/storage";
import { recordAudit } from "@/cases/audit";
import { revokeAllSessions } from "@/auth/service";

export const RETENTION_DAYS = Number(process.env.DELETED_CASE_RETENTION_DAYS ?? 30);

async function purgeCaseFiles(caseId: string): Promise<void> {
    const db = await getDb();
    const docs = await db.select({ storageKey: documents.storageKey }).from(documents).where(eq(documents.caseId, caseId));
    const storage = getStorage();
    for (const d of docs) await storage.delete(d.storageKey);
}

export async function purgeExpiredCases(now = new Date()): Promise<number> {
    const db = await getDb();
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
    const rows = await db.select({ id: cases.id, userId: cases.userId }).from(cases).where(and(isNotNull(cases.deletedAt), lt(cases.deletedAt, cutoff)));
    for (const r of rows) {
        await purgeCaseFiles(r.id);
        await db.delete(cases).where(eq(cases.id, r.id));
        await recordAudit({ userId: r.userId, caseId: r.id, action: "case.purged" });
    }
    return rows.length;
}

/** Hard-delete a case immediately at the user's request. */
export async function purgeCaseNow(userId: string, caseId: string): Promise<void> {
    const db = await getDb();
    const row = (await db.select({ id: cases.id }).from(cases).where(and(eq(cases.id, caseId), eq(cases.userId, userId))))[0];
    if (!row) return;
    await purgeCaseFiles(caseId);
    await db.delete(cases).where(eq(cases.id, caseId));
    await recordAudit({ userId, caseId, action: "case.purged" });
}

export async function deleteAccount(userId: string): Promise<void> {
    const db = await getDb();
    const owned = await db.select({ id: cases.id }).from(cases).where(eq(cases.userId, userId));
    for (const c of owned) await purgeCaseFiles(c.id);
    await revokeAllSessions(userId);
    await db.delete(users).where(eq(users.id, userId));
    await recordAudit({ userId, action: "account.deleted", details: { cases: owned.length } });
}
