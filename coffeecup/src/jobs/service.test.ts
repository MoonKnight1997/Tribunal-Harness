import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { backoffMs, cancelJob, claimNext, enqueueJob, extendLease, getJob, registerJobHandler, retryJob, runPendingJobs, sweepAbandonedJobs } from "./service";

let runs: string[] = [];

beforeAll(() => {
    registerJobHandler("test.ok", async ({ job }) => {
        runs.push(job.id);
        return { status: "completed", result: { ok: true } };
    });
    registerJobHandler("test.fail", async ({ job }) => {
        runs.push(job.id);
        throw new Error("boom");
    });
    registerJobHandler("test.review", async () => ({ status: "requires_review", note: "look at this" }));
    registerJobHandler("test.slow", async ({ job, workerId }) => {
        // A long handler keeps its lease alive.
        const extended = await extendLease(job.id, workerId, 600);
        return { status: "completed", result: { extended } };
    });
});

afterAll(async () => {
    await closeDb();
});

describe("leases", () => {
    it("reclaims an abandoned processing job whose lease has expired, with no database edit by an operator", async () => {
        runs = [];
        const job = await enqueueJob({ type: "test.ok" });
        const db = await getDb();
        // Simulate a worker that claimed the job and then died.
        await db.update(jobs).set({ status: "processing", lockedBy: "dead-worker:1", leaseExpiresAt: new Date(Date.now() - 60_000), startedAt: new Date(Date.now() - 400_000), attempts: 1 }).where(eq(jobs.id, job.id));

        const ran = await runPendingJobs(10, "worker-b:2");
        expect(ran.map((j) => j.id)).toContain(job.id);
        const after = (await getJob(job.id))!;
        expect(after.status).toBe("completed");
        expect(after.attempts).toBe(2);
        expect(after.lockedBy).toBeNull();
        expect(after.leaseExpiresAt).toBeNull();
        expect(runs).toContain(job.id);
    });

    it("does not touch a processing job whose lease is still valid", async () => {
        const job = await enqueueJob({ type: "test.ok" });
        const db = await getDb();
        await db.update(jobs).set({ status: "processing", lockedBy: "alive-worker:1", leaseExpiresAt: new Date(Date.now() + 200_000), attempts: 1 }).where(eq(jobs.id, job.id));
        const ran = await runPendingJobs(10, "worker-b:2");
        expect(ran.map((j) => j.id)).not.toContain(job.id);
        expect((await getJob(job.id))!.lockedBy).toBe("alive-worker:1");
        await db.update(jobs).set({ status: "completed", finishedAt: new Date() }).where(eq(jobs.id, job.id)); // tidy
    });

    it("fails an abandoned job that has no attempts left instead of leaving it stuck in processing", async () => {
        const job = await enqueueJob({ type: "test.ok", maxAttempts: 1 });
        const db = await getDb();
        await db.update(jobs).set({ status: "processing", lockedBy: "dead", leaseExpiresAt: new Date(Date.now() - 1000), attempts: 1 }).where(eq(jobs.id, job.id));
        expect(await sweepAbandonedJobs()).toBeGreaterThanOrEqual(1);
        const after = (await getJob(job.id))!;
        expect(after.status).toBe("failed");
        expect(after.error).toMatch(/Abandoned/);
    });

    it("claims set worker identity and a lease; extendLease works only for the holder", async () => {
        const job = await enqueueJob({ type: "test.slow" });
        const claimed = (await claimNext("holder:1"))!;
        expect(claimed.id).toBe(job.id);
        expect(claimed.lockedBy).toBe("holder:1");
        expect(claimed.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 200_000);
        expect(await extendLease(job.id, "someone-else:9")).toBe(false);
        expect(await extendLease(job.id, "holder:1")).toBe(true);
        // Put it back so the queue is clean for later tests.
        const db = await getDb();
        await db.update(jobs).set({ status: "completed", finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null }).where(eq(jobs.id, job.id));
    });

    it("two workers claiming concurrently never claim the same job", async () => {
        const created = await Promise.all(Array.from({ length: 5 }, (_, i) => enqueueJob({ type: "test.ok", payload: { i } })));
        const claims = await Promise.all([claimNext("worker-a"), claimNext("worker-b"), claimNext("worker-a"), claimNext("worker-b"), claimNext("worker-a")]);
        const ids = claims.map((c) => c?.id).filter((x): x is string => !!x);
        expect(ids).toHaveLength(5);
        expect(new Set(ids).size).toBe(5);
        expect(new Set(ids)).toEqual(new Set(created.map((c) => c.id)));
        expect(await claimNext("worker-a")).toBeNull();
        for (const c of claims) expect(["worker-a", "worker-b"]).toContain(c!.lockedBy);
        const db = await getDb();
        for (const c of created) await db.update(jobs).set({ status: "completed", finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null }).where(eq(jobs.id, c.id));
    });
});

describe("backoff and retries", () => {
    it("a handler exception schedules nextRunAt in the future and the same batch does not re-run it", async () => {
        runs = [];
        const job = await enqueueJob({ type: "test.fail", maxAttempts: 3 });
        const before = Date.now();
        const ran = await runPendingJobs(10, "w");
        expect(ran.filter((j) => j.id === job.id)).toHaveLength(1);
        const after = (await getJob(job.id))!;
        expect(after.status).toBe("queued");
        expect(after.error).toBe("boom");
        expect(after.attempts).toBe(1);
        expect(after.nextRunAt!.getTime()).toBeGreaterThanOrEqual(before + backoffMs(1) - 50);
        expect(after.lockedBy).toBeNull();
        expect(runs.filter((id) => id === job.id)).toHaveLength(1);

        // Another batch right away: still waiting for its backoff.
        expect((await runPendingJobs(10, "w")).map((j) => j.id)).not.toContain(job.id);
        expect(runs.filter((id) => id === job.id)).toHaveLength(1);

        // When the backoff has passed it runs again, and fails for good after maxAttempts.
        const db = await getDb();
        await db.update(jobs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, job.id));
        await runPendingJobs(10, "w");
        await db.update(jobs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, job.id));
        await runPendingJobs(10, "w");
        const done = (await getJob(job.id))!;
        expect(done.status).toBe("failed");
        expect(done.attempts).toBe(3);
        expect(done.nextRunAt).toBeNull();
        expect(runs.filter((id) => id === job.id)).toHaveLength(3);
    });

    it("backoff grows exponentially and caps at one hour", () => {
        expect(backoffMs(0)).toBe(15_000);
        expect(backoffMs(1)).toBe(30_000);
        expect(backoffMs(3)).toBe(120_000);
        expect(backoffMs(20)).toBe(3_600_000);
    });

    it("retryJob re-queues failed and requires_review jobs (and resets the counter), but not others", async () => {
        const review = await enqueueJob({ type: "test.review" });
        await runPendingJobs(10, "w");
        expect((await getJob(review.id))!.status).toBe("requires_review");
        const retried = (await retryJob(review.id))!;
        expect(retried.status).toBe("queued");
        expect(retried.attempts).toBe(0);
        expect(retried.error).toBeNull();
        await runPendingJobs(10, "w");

        const ok = await enqueueJob({ type: "test.ok" });
        await runPendingJobs(10, "w");
        expect((await retryJob(ok.id))!.status).toBe("completed"); // untouched
    });
});

describe("cancellation", () => {
    it("cancels a queued job so no worker runs it", async () => {
        runs = [];
        const job = await enqueueJob({ type: "test.ok" });
        const cancelled = (await cancelJob(job.id))!;
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.cancelledAt).toBeInstanceOf(Date);
        expect((await runPendingJobs(10, "w")).map((j) => j.id)).not.toContain(job.id);
        expect(runs).not.toContain(job.id);
    });

    it("flags a processing job and finishes it as cancelled", async () => {
        const job = await enqueueJob({ type: "test.ok" });
        const claimed = (await claimNext("w"))!;
        expect(claimed.id).toBe(job.id);
        const flagged = (await cancelJob(job.id))!;
        expect(flagged.status).toBe("processing");
        expect(flagged.cancelledAt).toBeInstanceOf(Date);
        const { runJob } = await import("./service");
        const finished = await runJob(claimed, "w");
        expect(finished.status).toBe("cancelled");
    });
});

describe("idempotency", () => {
    it("enqueueJob with the same idempotency key returns the existing job", async () => {
        const a = await enqueueJob({ type: "test.ok", idempotencyKey: "document.extract:doc-1:1" });
        const b = await enqueueJob({ type: "test.ok", idempotencyKey: "document.extract:doc-1:1" });
        const c = await enqueueJob({ type: "test.ok", idempotencyKey: "document.extract:doc-1:2" });
        expect(b.id).toBe(a.id);
        expect(c.id).not.toBe(a.id);
        const all = (await runPendingJobs(10, "w")).map((j) => j.id);
        expect(all.filter((id) => id === a.id)).toHaveLength(1);
    });
});
