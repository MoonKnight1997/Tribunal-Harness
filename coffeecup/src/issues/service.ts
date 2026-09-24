import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { issues } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { markStale } from "@/cases/staleness";

export type IssueRow = typeof issues.$inferSelect;

export const IssueInput = z.object({
    title: z.string().trim().min(2).max(300),
    description: z.string().trim().max(8000).nullable().optional(),
    category: z.string().trim().max(60).default("other"),
    desiredResolution: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["open", "resolved", "withdrawn"]).optional(),
});

export async function addIssue(actor: Actor, caseId: string, raw: z.input<typeof IssueInput>): Promise<IssueRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = IssueInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the issue details.", parsed.error.flatten());
    const db = await getDb();
    const id = newId();
    await db.insert(issues).values({ id, caseId, ...parsed.data, description: parsed.data.description ?? null, desiredResolution: parsed.data.desiredResolution ?? null, status: parsed.data.status ?? "open" });
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "issue.added", targetType: "issue", targetId: id, details: { category: parsed.data.category } });
    // Issue categories decide which time-limit families are shown, so deadlines are recomputed too.
    await markStale(caseId, "issues changed", ["deadlines", "claims", "artifacts", "summary"]);
    return (await db.select().from(issues).where(eq(issues.id, id)))[0];
}

export async function listIssues(actor: Actor, caseId: string): Promise<IssueRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    return db.select().from(issues).where(eq(issues.caseId, caseId)).orderBy(asc(issues.createdAt));
}

export async function updateIssue(actor: Actor, caseId: string, issueId: string, raw: Partial<z.input<typeof IssueInput>>): Promise<IssueRow> {
    await requireCaseAccess(actor, caseId);
    const parsed = IssueInput.partial().safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the issue details.", parsed.error.flatten());
    const db = await getDb();
    await db.update(issues).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(issues.id, issueId), eq(issues.caseId, caseId)));
    const row = (await db.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.caseId, caseId))))[0];
    if (!row) throw new ValidationError("Issue not found.");
    await markStale(caseId, "issues changed", ["deadlines", "claims", "artifacts", "summary"]);
    return row;
}

export async function deleteIssue(actor: Actor, caseId: string, issueId: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.delete(issues).where(and(eq(issues.id, issueId), eq(issues.caseId, caseId)));
    await markStale(caseId, "issues changed", ["deadlines", "claims", "artifacts", "summary"]);
}
