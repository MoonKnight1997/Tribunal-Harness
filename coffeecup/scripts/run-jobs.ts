/**
 * Background worker: runs queued jobs and the retention purge, then exits.
 * Schedule it (cron, a platform scheduler, or a loop) in production when
 * JOBS_INLINE=0. Equivalent to POST /api/jobs/run without HTTP.
 *
 * Each run identifies itself as `hostname:pid` (the job's `lockedBy`) and
 * takes a lease of JOBS_LEASE_SECONDS (default 300) on every job it claims.
 * If this process is killed mid-job, the lease expires and the next run
 * reclaims the job automatically — no database edit needed. Set
 * JOBS_LEASE_SECONDS longer than your slowest job (large PDFs, OCR).
 *
 * Environment: JOBS_BATCH_SIZE (default 50), JOBS_LEASE_SECONDS (default 300),
 * JOBS_WORKER_ID (optional override for `lockedBy`).
 */
import os from "node:os";
import { closeDb } from "../src/db/client";
import { runPendingJobs } from "../src/jobs/service";
import { purgeExpiredCases } from "../src/cases/retention";
// Registers job handlers.
import "../src/documents/service";

async function main() {
    const workerId = process.env.JOBS_WORKER_ID ?? `${os.hostname()}:${process.pid}`;
    const lease = Number(process.env.JOBS_LEASE_SECONDS ?? 300);
    if (!Number.isFinite(lease) || lease <= 0) {
        console.error(`[jobs] JOBS_LEASE_SECONDS must be a positive number (got "${process.env.JOBS_LEASE_SECONDS}")`);
        process.exit(2);
    }
    const jobs = await runPendingJobs(Number(process.env.JOBS_BATCH_SIZE ?? 50), workerId);
    const purged = await purgeExpiredCases();
    console.log(`[jobs] worker ${workerId} (lease ${lease}s) ran ${jobs.length} job(s); purged ${purged} expired case(s)`);
    for (const j of jobs) console.log(`  ${j.type} ${j.id} → ${j.status}${j.error ? ` (${j.error})` : ""}`);
    await closeDb();
}

main().catch((err) => {
    console.error("[jobs] failed", err);
    process.exit(1);
});
