/**
 * Authentication service — account creation, sign-in, sessions, recovery.
 *
 * Framework-free: it takes and returns plain values so it can be tested
 * without HTTP. Cookie handling lives in src/auth/cookies.ts.
 *
 * Security properties
 * - Passwords hashed with scrypt (see password.ts).
 * - Session and recovery tokens are random 256-bit values; only their SHA-256
 *   is stored.
 * - Sign-in errors are indistinguishable for unknown email vs wrong password.
 * - Recovery requests always succeed from the caller's point of view, whether
 *   or not the email exists (no account enumeration).
 * - Password reset invalidates every existing session for the user.
 */

import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { consents, recoveryTokens, sessions, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { UnauthenticatedError, ValidationError } from "@/lib/errors";
import { hashPassword, passwordPolicyProblem, verifyPassword } from "./password";
import { generateToken, hashToken } from "./tokens";
import { recordAudit } from "@/cases/audit";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour
export const CURRENT_TERMS_VERSION = "2026-09";
export const CURRENT_PRIVACY_VERSION = "2026-09";

export interface AuthUser {
    id: string;
    email: string;
    displayName: string | null;
}

export interface SessionInfo {
    /** Raw token — set as the cookie value, never persisted. */
    token: string;
    expiresAt: Date;
}

function normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
}

function emailProblem(email: string): string | null {
    const e = normaliseEmail(email);
    if (!e || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Please enter a valid email address.";
    return null;
}

export async function signUp(input: {
    email: string;
    password: string;
    acceptedTerms: boolean;
    displayName?: string;
}): Promise<{ user: AuthUser; session: SessionInfo }> {
    const emailErr = emailProblem(input.email);
    if (emailErr) throw new ValidationError(emailErr);
    const pwErr = passwordPolicyProblem(input.password);
    if (pwErr) throw new ValidationError(pwErr);
    if (input.acceptedTerms !== true) {
        throw new ValidationError("Please accept the terms and privacy notice to create an account.");
    }

    const db = await getDb();
    const email = normaliseEmail(input.email);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
        // Same message as validation failure on purpose: do not confirm the account exists.
        throw new ValidationError("We could not create an account with those details. If you already have an account, sign in instead.");
    }

    const userId = newId();
    const passwordHash = await hashPassword(input.password);
    await db.insert(users).values({
        id: userId,
        email,
        passwordHash,
        displayName: input.displayName?.trim() || null,
    });
    await db.insert(consents).values([
        { id: newId(), userId, kind: "terms", version: CURRENT_TERMS_VERSION },
        { id: newId(), userId, kind: "privacy", version: CURRENT_PRIVACY_VERSION },
    ]);
    await recordAudit({ userId, action: "auth.sign_up" });

    const session = await createSession(userId);
    return { user: { id: userId, email, displayName: input.displayName?.trim() || null }, session };
}

export async function signIn(input: { email: string; password: string }): Promise<{ user: AuthUser; session: SessionInfo }> {
    const db = await getDb();
    const email = normaliseEmail(input.email ?? "");
    const rows = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
    const user = rows[0];
    // Always run the hash check (against a dummy hash if needed) so timing does
    // not reveal whether the email exists.
    const ok = user
        ? await verifyPassword(input.password ?? "", user.passwordHash)
        : await verifyPassword(input.password ?? "", await dummyHash());
    if (!user || !ok) {
        throw new UnauthenticatedError("That email and password combination was not recognised.");
    }
    await recordAudit({ userId: user.id, action: "auth.sign_in" });
    const session = await createSession(user.id);
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, session };
}

let cachedDummy: string | null = null;
async function dummyHash(): Promise<string> {
    if (!cachedDummy) cachedDummy = await hashPassword("dummy-password-for-timing-equalisation");
    return cachedDummy;
}

export async function createSession(userId: string): Promise<SessionInfo> {
    const db = await getDb();
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.insert(sessions).values({ id: newId(), userId, tokenHash: hashToken(token), expiresAt });
    return { token, expiresAt };
}

export async function validateSession(token: string | undefined | null): Promise<AuthUser | null> {
    if (!token) return null;
    const db = await getDb();
    const now = new Date();
    const rows = await db
        .select({ sessionId: sessions.id, userId: users.id, email: users.email, displayName: users.displayName, deletedAt: users.deletedAt })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
        .limit(1);
    const row = rows[0];
    if (!row || row.deletedAt) return null;
    // Touch last-seen at most once per hour to keep writes low.
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
    return { id: row.userId, email: row.email, displayName: row.displayName };
}

export async function signOut(token: string | undefined | null): Promise<void> {
    if (!token) return;
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Start account recovery. Returns the raw token ONLY so the caller can hand it
 * to the email adapter; it is never returned to the HTTP client. Returns null
 * when no account matches (caller must respond identically either way).
 */
export async function requestPasswordRecovery(email: string): Promise<{ userId: string; token: string } | null> {
    const db = await getDb();
    const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.email, normaliseEmail(email ?? "")), isNull(users.deletedAt))).limit(1);
    const user = rows[0];
    if (!user) return null;
    const token = generateToken();
    await db.insert(recoveryTokens).values({
        id: newId(),
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RECOVERY_TTL_MS),
    });
    await recordAudit({ userId: user.id, action: "auth.recovery_requested" });
    return { userId: user.id, token };
}

export async function resetPassword(input: { token: string; newPassword: string }): Promise<{ user: AuthUser; session: SessionInfo }> {
    const pwErr = passwordPolicyProblem(input.newPassword);
    if (pwErr) throw new ValidationError(pwErr);
    const db = await getDb();
    const now = new Date();
    const rows = await db
        .select()
        .from(recoveryTokens)
        .where(and(eq(recoveryTokens.tokenHash, hashToken(input.token ?? "")), gt(recoveryTokens.expiresAt, now), isNull(recoveryTokens.usedAt)))
        .limit(1);
    const rec = rows[0];
    if (!rec) throw new ValidationError("That recovery link is not valid or has expired. Please request a new one.");

    const passwordHash = await hashPassword(input.newPassword);
    await db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, rec.userId));
    await db.update(recoveryTokens).set({ usedAt: now }).where(eq(recoveryTokens.id, rec.id));
    await revokeAllSessions(rec.userId);
    await recordAudit({ userId: rec.userId, action: "auth.password_reset" });

    const userRows = await db.select().from(users).where(eq(users.id, rec.userId)).limit(1);
    const user = userRows[0];
    const session = await createSession(user.id);
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, session };
}

export async function recordConsent(userId: string, kind: string, version: string): Promise<void> {
    const db = await getDb();
    await db.insert(consents).values({ id: newId(), userId, kind, version });
}

export async function hasConsent(userId: string, kind: string): Promise<boolean> {
    const db = await getDb();
    const rows = await db
        .select({ id: consents.id })
        .from(consents)
        .where(and(eq(consents.userId, userId), eq(consents.kind, kind), isNull(consents.withdrawnAt)))
        .limit(1);
    return rows.length > 0;
}
