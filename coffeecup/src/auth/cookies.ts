import { cookies } from "next/headers";

export const SESSION_COOKIE = "cc_session";

export function sessionCookieOptions(expires: Date) {
    return {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        expires,
    };
}

export async function setSessionCookie(token: string, expires: Date): Promise<void> {
    const store = await cookies();
    store.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
}

export async function clearSessionCookie(): Promise<void> {
    const store = await cookies();
    store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
}

export async function readSessionToken(): Promise<string | undefined> {
    const store = await cookies();
    return store.get(SESSION_COOKIE)?.value;
}
