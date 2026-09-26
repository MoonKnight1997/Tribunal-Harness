import { NextResponse, type NextRequest } from "next/server";
import { handle, readJson, json, requestOrigin } from "@/lib/http";
import { AppError, RateLimitedError } from "@/lib/errors";
import { signUp, signIn, signOut, requestPasswordRecovery, resetPassword } from "@/auth/service";
import { setSessionCookie, clearSessionCookie, readSessionToken } from "@/auth/cookies";
import { clientKeyFromRequest, createRateLimiter } from "@/lib/rate-limit";
import { sendRecoveryEmail } from "@/lib/email";
import { track } from "@/analytics/service";

const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 30 });

export const POST = handle(async (request: NextRequest, ctx: { params: Promise<{ action: string }> }) => {
    const { action } = await ctx.params;
    if (!limiter.check(`${action}:${clientKeyFromRequest(request)}`)) throw new RateLimitedError();

    switch (action) {
        case "sign-up": {
            const body = await readJson<{ email: string; password: string; acceptedTerms: boolean; displayName?: string }>(request);
            const { user, session } = await signUp(body);
            await setSessionCookie(session.token, session.expiresAt);
            await track("case_started", user.id, { stage: "account" });
            return json({ user });
        }
        case "sign-in": {
            const body = await readJson<{ email: string; password: string }>(request);
            const { user, session } = await signIn(body);
            await setSessionCookie(session.token, session.expiresAt);
            return json({ user });
        }
        case "sign-out": {
            await signOut(await readSessionToken());
            await clearSessionCookie();
            return json({ ok: true });
        }
        case "recover": {
            const body = await readJson<{ email: string }>(request);
            const rec = await requestPasswordRecovery(body.email ?? "");
            if (rec) await sendRecoveryEmail(body.email, `${requestOrigin(request)}/reset?token=${encodeURIComponent(rec.token)}`);
            // Identical response whether or not the account exists.
            return json({ ok: true, message: "If that email is registered, we have sent a link to reset your password." });
        }
        case "reset": {
            const body = await readJson<{ token: string; newPassword: string }>(request);
            const { user, session } = await resetPassword(body);
            await setSessionCookie(session.token, session.expiresAt);
            return json({ user });
        }
        default:
            throw new AppError("Unknown action.", 404, "not_found");
    }
});

export function GET() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
