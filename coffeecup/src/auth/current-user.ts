import { cache } from "react";
import { UnauthenticatedError } from "@/lib/errors";
import type { Actor } from "@/cases/access";
import { validateSession, type AuthUser } from "./service";
import { readSessionToken } from "./cookies";

/** Server-side current user (memoised per request). */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
    const token = await readSessionToken();
    return validateSession(token);
});

export async function requireUser(): Promise<{ user: AuthUser; actor: Actor }> {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    return { user, actor: { userId: user.id } };
}
