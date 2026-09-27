/**
 * Reference validation inside a case.
 *
 * `requireCaseAccess` proves the caller owns the case. It says nothing about
 * the ids the caller then puts *inside* a request body — a source document,
 * an event an allegation cites, a parent process. Every such id must belong
 * to the same case before anything is written, otherwise a signed-in user can
 * attach another tenant's record to their own case (and later read it back
 * through joins, exports or generated documents).
 *
 * `assertCaseOwns` loads only ids (one `inArray` query per kind) and throws a
 * 400 `ValidationError` when any referenced id is not in this case. It does not
 * say which id failed, so it cannot be used to probe another tenant's ids.
 * Soft-deleted documents count as not found.
 */

import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import { allegations, documents, events, facts, issues, persons, processes } from "@/db/schema";
import { ValidationError } from "@/lib/errors";

export interface CaseReferences {
    documentIds?: ReadonlyArray<string | null | undefined>;
    eventIds?: ReadonlyArray<string | null | undefined>;
    factIds?: ReadonlyArray<string | null | undefined>;
    personIds?: ReadonlyArray<string | null | undefined>;
    processIds?: ReadonlyArray<string | null | undefined>;
    issueIds?: ReadonlyArray<string | null | undefined>;
    allegationIds?: ReadonlyArray<string | null | undefined>;
}

export const FOREIGN_REFERENCE_MESSAGE = "One or more referenced items were not found in this case.";

interface Kind {
    table: PgTable;
    id: PgColumn;
    caseId: PgColumn;
    /** Extra predicate, e.g. exclude soft-deleted rows. */
    extra?: SQL;
}

const KINDS: Record<keyof CaseReferences, Kind> = {
    documentIds: { table: documents, id: documents.id, caseId: documents.caseId, extra: isNull(documents.deletedAt) },
    eventIds: { table: events, id: events.id, caseId: events.caseId },
    factIds: { table: facts, id: facts.id, caseId: facts.caseId },
    personIds: { table: persons, id: persons.id, caseId: persons.caseId },
    processIds: { table: processes, id: processes.id, caseId: processes.caseId },
    issueIds: { table: issues, id: issues.id, caseId: issues.caseId },
    allegationIds: { table: allegations, id: allegations.id, caseId: allegations.caseId },
};

function distinctIds(list: ReadonlyArray<string | null | undefined> | undefined): string[] {
    if (!list) return [];
    const out = new Set<string>();
    for (const v of list) {
        if (typeof v === "string" && v.length > 0) out.add(v);
    }
    return [...out];
}

/**
 * Throw `ValidationError` (400) unless every referenced id exists in `caseId`.
 * Empty / null / undefined entries are ignored, so callers can pass optional
 * fields straight through. The caller must already have passed
 * `requireCaseAccess` for `caseId`.
 */
export async function assertCaseOwns(caseId: string, refs: CaseReferences): Promise<void> {
    const db = await getDb();
    for (const key of Object.keys(KINDS) as Array<keyof CaseReferences>) {
        const ids = distinctIds(refs[key]);
        if (ids.length === 0) continue;
        const kind = KINDS[key];
        const where = kind.extra
            ? and(eq(kind.caseId, caseId), inArray(kind.id, ids), kind.extra)
            : and(eq(kind.caseId, caseId), inArray(kind.id, ids));
        const rows = await db.select({ id: kind.id }).from(kind.table).where(where);
        const found = new Set(rows.map((r) => r.id as string));
        if (ids.some((id) => !found.has(id))) throw new ValidationError(FOREIGN_REFERENCE_MESSAGE);
    }
}
