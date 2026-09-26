/**
 * Fair-use limits. Consumers are never shown tokens or credits; instead each
 * case has a sensible daily allowance of AI generations, configurable by
 * environment. Limits are enforced server-side and counted per user+case+kind
 * per day.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { usageCounters } from "@/db/schema";
import { newId } from "@/lib/ids";
import { todayISO } from "@/lib/dates";

export type UsageKind = "document_extraction" | "ai_generation" | "claim_analysis";

function limitFor(kind: UsageKind): number {
    const env = process.env[`FAIR_USE_${kind.toUpperCase()}_PER_DAY`];
    const n = env ? Number(env) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
    switch (kind) {
        case "document_extraction":
            return 40;
        case "ai_generation":
            return 60;
        case "claim_analysis":
            return 10;
    }
}

export async function checkAndCountUsage(userId: string, caseId: string | null, kind: UsageKind): Promise<{ ok: true } | { ok: false; reason: string }> {
    const db = await getDb();
    const periodStart = todayISO();
    const limit = limitFor(kind);
    const existing = await db
        .select()
        .from(usageCounters)
        .where(and(eq(usageCounters.userId, userId), caseId ? eq(usageCounters.caseId, caseId) : sql`${usageCounters.caseId} is null`, eq(usageCounters.kind, kind), eq(usageCounters.periodStart, periodStart)))
        .limit(1);
    const count = existing[0]?.count ?? 0;
    if (count >= limit) {
        return { ok: false, reason: `You have reached today's fair-use limit for this (${limit} per day). It resets tomorrow. Your case is unaffected.` };
    }
    if (existing[0]) {
        await db.update(usageCounters).set({ count: count + 1 }).where(eq(usageCounters.id, existing[0].id));
    } else {
        await db.insert(usageCounters).values({ id: newId(), userId, caseId, kind, periodStart, count: 1 });
    }
    return { ok: true };
}
