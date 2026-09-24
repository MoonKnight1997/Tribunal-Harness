import type { NextRequest } from "next/server";
import { handle, readJson, json } from "@/lib/http";
import { RateLimitedError } from "@/lib/errors";
import { triage, type IntakeInputType } from "@/intake/service";
import { clientKeyFromRequest, createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 40 });

/** Anonymous triage: never persists anything. */
export const POST = handle(async (request: NextRequest) => {
    if (!limiter.check(clientKeyFromRequest(request))) throw new RateLimitedError();
    const body = await readJson<IntakeInputType>(request);
    return json(await triage(body));
});
