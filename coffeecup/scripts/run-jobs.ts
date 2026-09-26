/**
 * Background worker: runs queued jobs and the retention purge, then exits.
 * Schedule it (cron, a platform scheduler, or a loop) in production when
 * JOBS_INLINE=0. Equivalent to POST /api/jobs/run without HTTP.
 */
import { closeDb } from "../src/db/client";
import { runPendingJobs } from "../src/jobs/service";
import { purgeExpiredCases } from "../src/cases/retention";
// Registers job handlers.
import "../src/documents/service";

async function main() {
    const jobs = await runPendingJobs(Number(process.env.JOBS_BATCH_SIZE ?? 50));
    const purged = await purgeExpiredCases();
    console.log(`[jobs] ran ${jobs.length} job(s); purged ${purged} expired case(s)`);
    for (const j of jobs) console.log(`  ${j.type} ${j.id} → ${j.status}${j.error ? ` (${j.error})` : ""}`);
    await closeDb();
}

main().catch((err) => {
    console.error("[jobs] failed", err);
    process.exit(1);
});
