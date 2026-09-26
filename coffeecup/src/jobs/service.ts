/**
 * Background jobs with explicit state: queued → processing → completed |
 * failed | requires_review. A failing job never corrupts the case: handlers
 * write proposals, never confirmed facts, and a failure only updates the job
 * row (and the document's extraction status where relevant).
 *
 * Execution model: `runPendingJobs()` claims and runs queued jobs in-process.
 * It is called (a) opportunistically after enqueue in dev/test, (b) by the
 * authenticated `/api/jobs/run` endpoint from a scheduler in production, and
 * (c) by `npm run jobs:run` for a worker process.
 */

import { and, asc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs, type JobStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import { recordAudit } from "@/cases/audit";

export type JobRow = typeof jobs.$inferSelect;

export interface JobContext {
    job: JobRow;
}

export type JobOutcome = { status: "completed"; result?: Record<string, unknown> } | { status: "requires_review"; result?: Record<string, unknown>; note: string };

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
    handlers.set(type, handler);
}

export async function enqueueJob(input: { type: string; caseId?: string | null; userId?: string | null; payload?: Record<string, unknown>; maxAttempts?: number }): Promise<JobRow> {
    const db = await getDb();
    const id = newId();
    await db.insert(jobs).values({
        id,
        type: input.type,
        caseId: input.caseId ?? null,
        userId: input.userId ?? null,
        payload: input.payload ?? {},
        maxAttempts: input.maxAttempts ?? 3,
    });
    return (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
}

export async function getJob(jobId: string): Promise<JobRow | null> {
    const db = await getDb();
    return (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0] ?? null;
}

export async function listJobsForCase(caseId: string): Promise<JobRow[]> {
    const db = await getDb();
    return db.select().from(jobs).where(eq(jobs.caseId, caseId)).orderBy(asc(jobs.createdAt));
}

/** Requeue a failed job if attempts remain (self-service retry). */
export async function retryJob(jobId: string): Promise<JobRow | null> {
    const db = await getDb();
    const job = await getJob(jobId);
    if (!job || job.status !== "failed" || job.attempts >= job.maxAttempts) return job;
    await db.update(jobs).set({ status: "queued", error: null, startedAt: null, finishedAt: null }).where(eq(jobs.id, jobId));
    return getJob(jobId);
}

async function claimNext(): Promise<JobRow | null> {
    const db = await getDb();
    // Atomic claim: only one worker can flip a queued row to processing.
    const rows = await db
        .update(jobs)
        .set({ status: "processing", startedAt: new Date(), attempts: sql`${jobs.attempts} + 1` })
        .where(
            and(
                eq(jobs.status, "queued"),
                lt(jobs.attempts, jobs.maxAttempts),
                eq(jobs.id, sql`(select id from jobs where status = 'queued' and attempts < max_attempts order by created_at asc limit 1)`),
            ),
        )
        .returning();
    return rows[0] ?? null;
}

async function finish(jobId: string, status: JobStatus, patch: { result?: Record<string, unknown> | null; error?: string | null }): Promise<void> {
    const db = await getDb();
    await db.update(jobs).set({ status, result: patch.result ?? null, error: patch.error ?? null, finishedAt: new Date() }).where(eq(jobs.id, jobId));
}

export async function runJob(job: JobRow): Promise<JobRow> {
    const handler = handlers.get(job.type);
    if (!handler) {
        await finish(job.id, "failed", { error: `No handler registered for job type ${job.type}` });
        return (await getJob(job.id))!;
    }
    try {
        const outcome = await handler({ job });
        await finish(job.id, outcome.status, { result: outcome.result ?? null, error: outcome.status === "requires_review" ? outcome.note : null });
        await recordAudit({ userId: job.userId, caseId: job.caseId, action: `job.${outcome.status}`, targetType: "job", targetId: job.id, details: { type: job.type } });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const db = await getDb();
        const current = await getJob(job.id);
        const exhausted = (current?.attempts ?? job.attempts) >= job.maxAttempts;
        // Retryable: put it back in the queue; otherwise fail for good.
        await db
            .update(jobs)
            .set({ status: exhausted ? "failed" : "queued", error: message.slice(0, 1000), finishedAt: exhausted ? new Date() : null })
            .where(eq(jobs.id, job.id));
        await recordAudit({ userId: job.userId, caseId: job.caseId, action: exhausted ? "job.failed" : "job.retry_scheduled", targetType: "job", targetId: job.id, details: { type: job.type } });
    }
    return (await getJob(job.id))!;
}

/** Run queued jobs until the queue is empty or `limit` is reached. */
export async function runPendingJobs(limit = 20): Promise<JobRow[]> {
    const done: JobRow[] = [];
    for (let i = 0; i < limit; i++) {
        const job = await claimNext();
        if (!job) break;
        done.push(await runJob(job));
    }
    return done;
}

/** Whether jobs run inline right after enqueue (dev/test) or wait for a worker. */
export function runsInline(): boolean {
    return process.env.JOBS_INLINE !== "0" && (process.env.NODE_ENV !== "production" || process.env.JOBS_INLINE === "1");
}
