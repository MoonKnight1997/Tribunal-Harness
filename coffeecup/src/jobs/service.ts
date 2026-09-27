/**
 * Background jobs with explicit state: queued → processing → completed |
 * failed | requires_review | cancelled. A failing job never corrupts the
 * case: handlers write proposals, never confirmed facts, and a failure only
 * updates the job row (and the document's extraction status where relevant).
 *
 * Execution model: `runPendingJobs(limit, workerId)` claims and runs jobs
 * in-process. It is called (a) opportunistically after enqueue in dev/test,
 * (b) by the authenticated `/api/jobs/run` endpoint from a scheduler in
 * production, and (c) by `npm run jobs:run` for a worker process.
 *
 * Robustness (review finding F12):
 *   - Leases. A claim sets `lockedBy` and `leaseExpiresAt = now + JOBS_LEASE_SECONDS`
 *     (default 300). A `processing` job whose lease has expired was abandoned
 *     (the worker died) and is reclaimed by the next run — no database edit
 *     needed. Long handlers can call `extendLease`. An abandoned job with no
 *     attempts left is marked failed by the sweep at the start of each run.
 *   - Backoff. A handler exception puts the job back to `queued` with
 *     `nextRunAt = now + min(15s × 2^attempts, 1h)`, so the same batch never
 *     re-runs it immediately.
 *   - Cancellation. `cancelJob` cancels a queued job outright and flags a
 *     processing one (`cancelledAt`) so its handler can stop before writing.
 *   - Idempotency. `enqueueJob({ idempotencyKey })` returns the existing job
 *     for a key that has already been used (partial unique index).
 *
 * Environment: JOBS_LEASE_SECONDS (default 300), JOBS_INLINE, JOBS_BATCH_SIZE.
 */

import os from "node:os";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs, type JobStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import { recordAudit } from "@/cases/audit";
import { requireCaseAccess, type Actor } from "@/cases/access";
import { NotFoundError } from "@/lib/errors";

export type JobRow = typeof jobs.$inferSelect;

export interface JobContext {
    job: JobRow;
    /** Identity of the worker running this job (for `extendLease`). */
    workerId: string;
}

export type JobOutcome = { status: "completed"; result?: Record<string, unknown> } | { status: "requires_review"; result?: Record<string, unknown>; note: string };

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
    handlers.set(type, handler);
}

/** Default lease length in seconds (JOBS_LEASE_SECONDS, default 300). Read at call time so tests can vary it. */
export function leaseSeconds(): number {
    const n = Number(process.env.JOBS_LEASE_SECONDS ?? 300);
    return Number.isFinite(n) && n > 0 ? n : 300;
}

/** Backoff after the nth failed attempt: 15s × 2^attempts, capped at one hour. */
export function backoffMs(attempts: number): number {
    return Math.min(15_000 * 2 ** Math.max(0, attempts), 3_600_000);
}

/** Stable identity of this process for `lockedBy`. */
export function defaultWorkerId(): string {
    return `${os.hostname()}:${process.pid}`;
}

export interface EnqueueInput {
    type: string;
    caseId?: string | null;
    userId?: string | null;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    /** Same key → same job; a second enqueue returns the existing row instead of creating another. */
    idempotencyKey?: string | null;
}

export async function enqueueJob(input: EnqueueInput): Promise<JobRow> {
    const db = await getDb();
    const key = input.idempotencyKey ?? null;
    if (key) {
        const existing = (await db.select().from(jobs).where(eq(jobs.idempotencyKey, key)).limit(1))[0];
        if (existing) return existing;
    }
    const id = newId();
    try {
        await db.insert(jobs).values({
            id,
            type: input.type,
            caseId: input.caseId ?? null,
            userId: input.userId ?? null,
            payload: input.payload ?? {},
            maxAttempts: input.maxAttempts ?? 3,
            idempotencyKey: key,
        });
    } catch (err) {
        // Lost a race on the idempotency key: return the winner.
        if (key) {
            const existing = (await db.select().from(jobs).where(eq(jobs.idempotencyKey, key)).limit(1))[0];
            if (existing) return existing;
        }
        throw err;
    }
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

/**
 * Requeue a failed or requires_review job (self-service retry). An explicit
 * retry resets the attempt counter: the user has asked for another go, and
 * the lease/backoff machinery still bounds each run.
 */
export async function retryJob(jobId: string): Promise<JobRow | null> {
    const db = await getDb();
    const job = await getJob(jobId);
    if (!job || (job.status !== "failed" && job.status !== "requires_review")) return job;
    await db
        .update(jobs)
        .set({ status: "queued", error: null, result: null, startedAt: null, finishedAt: null, nextRunAt: null, lockedBy: null, leaseExpiresAt: null, cancelledAt: null, attempts: 0 })
        .where(eq(jobs.id, jobId));
    return getJob(jobId);
}

/**
 * Cancel a job. Queued → `cancelled` immediately. Processing → `cancelledAt`
 * is set and the handler is expected to check `isJobCancelled` before each
 * write phase; the run then finishes as `cancelled`. Finished jobs are left
 * alone. With an `actor`, the job must belong to a case the actor can access.
 */
export async function cancelJob(jobId: string, actor?: Actor): Promise<JobRow | null> {
    const db = await getDb();
    const job = await getJob(jobId);
    if (!job) return null;
    if (actor) {
        if (!job.caseId) throw new NotFoundError("Job not found.");
        await requireCaseAccess(actor, job.caseId);
    }
    const now = new Date();
    if (job.status === "queued") {
        await db.update(jobs).set({ status: "cancelled", cancelledAt: now, finishedAt: now, lockedBy: null, leaseExpiresAt: null }).where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")));
        await recordAudit({ userId: actor?.userId ?? job.userId, caseId: job.caseId, action: "job.cancelled", targetType: "job", targetId: jobId, details: { type: job.type } });
    } else if (job.status === "processing" && !job.cancelledAt) {
        await db.update(jobs).set({ cancelledAt: now }).where(and(eq(jobs.id, jobId), eq(jobs.status, "processing")));
        await recordAudit({ userId: actor?.userId ?? job.userId, caseId: job.caseId, action: "job.cancel_requested", targetType: "job", targetId: jobId, details: { type: job.type } });
    }
    return getJob(jobId);
}

/** Handlers call this before each write phase. */
export async function isJobCancelled(jobId: string): Promise<boolean> {
    const job = await getJob(jobId);
    return !job || job.cancelledAt !== null || job.status === "cancelled";
}

/** Extend the lease of a job this worker holds. Returns false if the lease was lost. */
export async function extendLease(jobId: string, workerId: string, seconds = leaseSeconds()): Promise<boolean> {
    const db = await getDb();
    const rows = await db
        .update(jobs)
        .set({ leaseExpiresAt: new Date(Date.now() + seconds * 1000) })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "processing"), eq(jobs.lockedBy, workerId)))
        .returning();
    return rows.length > 0;
}

/**
 * Atomically claim the next runnable job for `workerId`. Runnable means:
 *   - attempts remain and it has not been cancelled, and
 *   - it is queued with no `nextRunAt` or one that has passed, OR
 *   - it is processing but its lease has expired (abandoned by a dead worker).
 *
 * The predicate appears both in the subselect and the outer WHERE so two
 * workers evaluating concurrently cannot both flip the same row.
 */
export async function claimNext(workerId: string = defaultWorkerId()): Promise<JobRow | null> {
    const db = await getDb();
    const now = new Date();
    const lease = new Date(now.getTime() + leaseSeconds() * 1000);
    const runnable = and(
        lt(jobs.attempts, jobs.maxAttempts),
        isNull(jobs.cancelledAt),
        or(
            and(eq(jobs.status, "queued"), or(isNull(jobs.nextRunAt), sql`${jobs.nextRunAt} <= ${now}`)),
            and(eq(jobs.status, "processing"), sql`${jobs.leaseExpiresAt} is not null and ${jobs.leaseExpiresAt} < ${now}`),
        ),
    );
    const rows = await db
        .update(jobs)
        .set({ status: "processing", lockedBy: workerId, leaseExpiresAt: lease, startedAt: now, finishedAt: null, attempts: sql`${jobs.attempts} + 1` })
        .where(
            and(
                runnable,
                eq(
                    jobs.id,
                    sql`(select id from jobs where attempts < max_attempts and cancelled_at is null and ((status = 'queued' and (next_run_at is null or next_run_at <= ${now})) or (status = 'processing' and lease_expires_at is not null and lease_expires_at < ${now})) order by created_at asc limit 1)`,
                ),
            ),
        )
        .returning();
    return rows[0] ?? null;
}

/** Abandoned jobs (lease expired) with no attempts left are failed for good, so nothing stays stuck in `processing`. */
export async function sweepAbandonedJobs(now = new Date()): Promise<number> {
    const db = await getDb();
    const rows = await db
        .update(jobs)
        .set({ status: "failed", error: "Abandoned: the worker stopped before finishing and no attempts remain.", finishedAt: now, lockedBy: null, leaseExpiresAt: null })
        .where(and(eq(jobs.status, "processing"), sql`${jobs.leaseExpiresAt} is not null and ${jobs.leaseExpiresAt} < ${now}`, sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
        .returning();
    return rows.length;
}

async function finish(jobId: string, status: JobStatus, patch: { result?: Record<string, unknown> | null; error?: string | null }): Promise<void> {
    const db = await getDb();
    await db.update(jobs).set({ status, result: patch.result ?? null, error: patch.error ?? null, finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null }).where(eq(jobs.id, jobId));
}

export async function runJob(job: JobRow, workerId: string = defaultWorkerId()): Promise<JobRow> {
    const handler = handlers.get(job.type);
    if (!handler) {
        await finish(job.id, "failed", { error: `No handler registered for job type ${job.type}` });
        return (await getJob(job.id))!;
    }
    try {
        const outcome = await handler({ job, workerId });
        const current = await getJob(job.id);
        if (current?.cancelledAt) {
            await finish(job.id, "cancelled", { result: outcome.result ?? null, error: null });
            await recordAudit({ userId: job.userId, caseId: job.caseId, action: "job.cancelled", targetType: "job", targetId: job.id, details: { type: job.type } });
        } else {
            await finish(job.id, outcome.status, { result: outcome.result ?? null, error: outcome.status === "requires_review" ? outcome.note : null });
            await recordAudit({ userId: job.userId, caseId: job.caseId, action: `job.${outcome.status}`, targetType: "job", targetId: job.id, details: { type: job.type } });
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const db = await getDb();
        const current = await getJob(job.id);
        const attempts = current?.attempts ?? job.attempts;
        const exhausted = attempts >= job.maxAttempts;
        const now = new Date();
        // Retryable: back in the queue after a backoff; otherwise fail for good.
        await db
            .update(jobs)
            .set({
                status: exhausted ? "failed" : "queued",
                error: message.slice(0, 1000),
                finishedAt: exhausted ? now : null,
                nextRunAt: exhausted ? null : new Date(now.getTime() + backoffMs(attempts)),
                lockedBy: null,
                leaseExpiresAt: null,
            })
            .where(eq(jobs.id, job.id));
        await recordAudit({ userId: job.userId, caseId: job.caseId, action: exhausted ? "job.failed" : "job.retry_scheduled", targetType: "job", targetId: job.id, details: { type: job.type, attempts } });
    }
    return (await getJob(job.id))!;
}

/** Run runnable jobs until none are left or `limit` is reached. */
export async function runPendingJobs(limit = 20, workerId: string = defaultWorkerId()): Promise<JobRow[]> {
    await sweepAbandonedJobs();
    const done: JobRow[] = [];
    for (let i = 0; i < limit; i++) {
        const job = await claimNext(workerId);
        if (!job) break;
        done.push(await runJob(job, workerId));
    }
    return done;
}

/** Whether jobs run inline right after enqueue (dev/test) or wait for a worker. */
export function runsInline(): boolean {
    return process.env.JOBS_INLINE !== "0" && (process.env.NODE_ENV !== "production" || process.env.JOBS_INLINE === "1");
}
