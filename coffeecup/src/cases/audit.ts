/**
 * Audit log. Records material system activity and every model-derived
 * modification. Details are structured and redacted: ids, counts, kinds and
 * statuses only — never document text, narratives or names.
 */

import { getDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { newId } from "@/lib/ids";

export interface AuditInput {
    userId?: string | null;
    caseId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
}

const MAX_STRING = 120;

/** Trim long strings and drop obviously sensitive keys before persisting. */
export function redactDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!details) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
        if (/text|narrative|content|statement|description|password|token|email|name/i.test(key)) continue;
        if (typeof value === "string") out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
        else if (typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
        else if (Array.isArray(value)) out[key] = { count: value.length };
        else if (typeof value === "object") out[key] = "[object]";
    }
    return out;
}

export async function recordAudit(input: AuditInput): Promise<void> {
    const db = await getDb();
    await db.insert(auditEvents).values({
        id: newId(),
        userId: input.userId ?? null,
        caseId: input.caseId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        details: redactDetails(input.details),
    });
}
