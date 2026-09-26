import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runPendingJobs } from "@/jobs/service";
import { purgeExpiredCases } from "@/cases/retention";
// Registers job handlers.
import "@/documents/service";

/**
 * Worker endpoint for schedulers (cron). Protected by JOBS_RUN_TOKEN as a
 * bearer token. Runs queued jobs and the retention purge.
 */
export async function POST(request: NextRequest) {
    const expected = process.env.JOBS_RUN_TOKEN ?? "";
    const header = request.headers.get("authorization") ?? "";
    const provided = header.replace(/^Bearer\s+/i, "");
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
        return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
    }
    const jobs = await runPendingJobs(Number(process.env.JOBS_BATCH_SIZE ?? 20));
    const purged = await purgeExpiredCases();
    return NextResponse.json({ ran: jobs.length, statuses: jobs.map((j) => ({ id: j.id, type: j.type, status: j.status })), purgedCases: purged });
}
