import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/dates";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";

export type TaskRow = typeof tasks.$inferSelect;

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

/** Idempotent system task: created once per (case, systemKey); updates title/due date if it exists and is open. */
export async function upsertSystemTask(caseId: string, systemKey: string, input: { title: string; description?: string | null; kind: TaskRow["kind"]; dueDate?: string | null }): Promise<void> {
    const db = await getDb();
    const existing = (await db.select().from(tasks).where(and(eq(tasks.caseId, caseId), eq(tasks.systemKey, systemKey))))[0];
    if (existing) {
        if (existing.status === "open") {
            await db.update(tasks).set({ title: input.title, description: input.description ?? null, dueDate: input.dueDate ?? null }).where(eq(tasks.id, existing.id));
        }
        return;
    }
    await db.insert(tasks).values({ id: newId(), caseId, systemKey, title: input.title, description: input.description ?? null, kind: input.kind, dueDate: input.dueDate ?? null });
}

export async function listTasks(actor: Actor, caseId: string): Promise<TaskRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    return db.select().from(tasks).where(eq(tasks.caseId, caseId)).orderBy(asc(tasks.status), asc(tasks.dueDate), asc(tasks.createdAt));
}

export async function completeTask(actor: Actor, caseId: string, taskId: string, done = true): Promise<TaskRow> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.update(tasks).set({ status: done ? "done" : "open", completedAt: done ? new Date() : null }).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId)));
    const row = (await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId))))[0];
    if (!row) throw new ValidationError("Task not found.");
    return row;
}

export async function deleteTask(actor: Actor, caseId: string, taskId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId)));
}
