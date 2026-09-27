import { and, asc, eq, like, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/dates";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";

export type TaskRow = typeof tasks.$inferSelect;

/** Task statuses. `obsolete` = the system withdrew the task after the underlying data changed. */
export type TaskStatus = "open" | "done" | "dismissed" | "obsolete";

export const TaskInput = z.object({
    title: z.string().trim().min(2).max(300),
    description: z.string().trim().max(4000).nullable().optional(),
    kind: z.enum(["procedural", "evidence", "preparation", "deadline", "information"]).default("information"),
    dueDate: z.string().refine(isIsoDate, "Expected YYYY-MM-DD").nullable().optional(),
});

export async function addTask(actor: Actor, caseId: string, raw: z.input<typeof TaskInput>): Promise<TaskRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = TaskInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the task.", parsed.error.flatten());
    const db = await getDb();
    const id = newId();
    await db.insert(tasks).values({ id, caseId, ...parsed.data, description: parsed.data.description ?? null, dueDate: parsed.data.dueDate ?? null });
    await touchCase(caseId);
    return (await db.select().from(tasks).where(eq(tasks.id, id)))[0];
}

export interface SystemTaskInput {
    title: string;
    description?: string | null;
    kind: TaskRow["kind"];
    dueDate?: string | null;
    /** Why the system suggests this; shown to the user. */
    reason?: string | null;
    /** Higher runs first on the dashboard. */
    priority?: number;
}

/**
 * Idempotent system task: created once per (case, systemKey). If it exists and
 * is open (or was withdrawn as obsolete and is needed again) its content is
 * refreshed. Tasks the user completed or dismissed are left alone.
 */
export async function upsertSystemTask(caseId: string, systemKey: string, input: SystemTaskInput): Promise<void> {
    const db = await getDb();
    const existing = (await db.select().from(tasks).where(and(eq(tasks.caseId, caseId), eq(tasks.systemKey, systemKey))))[0];
    const fields = { title: input.title, description: input.description ?? null, dueDate: input.dueDate ?? null, reason: input.reason ?? null, priority: input.priority ?? 0 };
    if (existing) {
        if (existing.status === "open") {
            await db.update(tasks).set(fields).where(eq(tasks.id, existing.id));
        } else if (existing.status === "obsolete") {
            await db.update(tasks).set({ ...fields, status: "open", dismissedAt: null }).where(eq(tasks.id, existing.id));
        }
        return;
    }
    await db.insert(tasks).values({ id: newId(), caseId, systemKey, kind: input.kind, ...fields });
}

/**
 * Withdraw open system tasks with the given key prefix that are no longer
 * justified (their key is not in `keepKeys`). Used after a recomputation so a
 * deadline task for a superseded date does not linger.
 */
export async function reconcileSystemTasks(caseId: string, prefix: string, keepKeys: string[]): Promise<number> {
    const db = await getDb();
    const conditions = [eq(tasks.caseId, caseId), eq(tasks.status, "open"), like(tasks.systemKey, `${prefix}%`)];
    if (keepKeys.length) conditions.push(notInArray(tasks.systemKey, keepKeys));
    const rows = await db.select({ id: tasks.id }).from(tasks).where(and(...conditions));
    for (const r of rows) {
        await db.update(tasks).set({ status: "obsolete", dismissedAt: new Date() }).where(eq(tasks.id, r.id));
    }
    return rows.length;
}

export async function listTasks(actor: Actor, caseId: string, opts?: { includeObsolete?: boolean }): Promise<TaskRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const where = opts?.includeObsolete ? eq(tasks.caseId, caseId) : and(eq(tasks.caseId, caseId), ne(tasks.status, "obsolete"));
    return db.select().from(tasks).where(where).orderBy(asc(tasks.status), asc(tasks.dueDate), asc(tasks.createdAt));
}

export async function completeTask(actor: Actor, caseId: string, taskId: string, done = true): Promise<TaskRow> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.update(tasks).set({ status: done ? "done" : "open", completedAt: done ? new Date() : null, dismissedAt: null }).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId)));
    const row = (await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId))))[0];
    if (!row) throw new ValidationError("Task not found.");
    return row;
}

/** The user chose not to act on this task. It is kept (not deleted) so a system task is not re-created. */
export async function dismissTask(actor: Actor, caseId: string, taskId: string): Promise<TaskRow> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.update(tasks).set({ status: "dismissed", dismissedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId)));
    const row = (await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId))))[0];
    if (!row) throw new ValidationError("Task not found.");
    return row;
}

export async function deleteTask(actor: Actor, caseId: string, taskId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId)));
}
