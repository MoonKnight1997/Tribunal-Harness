import { describe, it, expect, afterAll } from "vitest";
import { closeDb } from "@/db/client";
import { hashPassword, verifyPassword, passwordPolicyProblem } from "./password";
import {
    signUp,
    signIn,
    validateSession,
    signOut,
    requestPasswordRecovery,
    resetPassword,
} from "./service";

afterAll(async () => {
    await closeDb();
});

describe("password hashing", () => {
    it("hashes with scrypt and verifies", async () => {
        const hash = await hashPassword("correct horse battery staple");
        expect(hash.startsWith("scrypt$")).toBe(true);
        expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
        expect(await verifyPassword("wrong", hash)).toBe(false);
    });

    it("rejects malformed stored hashes without throwing", async () => {
        expect(await verifyPassword("x", "not-a-hash")).toBe(false);
        expect(await verifyPassword("x", "scrypt$abc$8$1$aa$bb")).toBe(false);
    });

    it("enforces a minimum length only", () => {
        expect(passwordPolicyProblem("short")).not.toBeNull();
        expect(passwordPolicyProblem("long enough password")).toBeNull();
    });
});

describe("accounts and sessions", () => {
    it("creates an account, signs in and validates the session", async () => {
        const { user, session } = await signUp({ email: "Worker@Example.com", password: "a strong password", acceptedTerms: true });
        expect(user.email).toBe("worker@example.com");
        const current = await validateSession(session.token);
        expect(current?.id).toBe(user.id);

        const signedIn = await signIn({ email: "worker@example.com", password: "a strong password" });
        expect(signedIn.user.id).toBe(user.id);

        await signOut(session.token);
        expect(await validateSession(session.token)).toBeNull();
    });

    it("refuses sign-up without accepting terms", async () => {
        await expect(signUp({ email: "x@example.com", password: "a strong password", acceptedTerms: false })).rejects.toThrow(/accept the terms/);
    });

    it("gives the same error for unknown email and wrong password", async () => {
        await signUp({ email: "known@example.com", password: "a strong password", acceptedTerms: true });
        const a = await signIn({ email: "unknown@example.com", password: "whatever" }).catch((e) => e.message);
        const b = await signIn({ email: "known@example.com", password: "wrong password" }).catch((e) => e.message);
        expect(a).toBe(b);
    });

    it("does not reveal whether an email exists on sign-up collision", async () => {
        await signUp({ email: "dup@example.com", password: "a strong password", acceptedTerms: true });
        await expect(signUp({ email: "dup@example.com", password: "another strong one", acceptedTerms: true })).rejects.toThrow(/could not create an account/);
    });

    it("recovers an account with a one-time token and revokes old sessions", async () => {
        const { user, session } = await signUp({ email: "forgot@example.com", password: "a strong password", acceptedTerms: true });
        expect(await requestPasswordRecovery("nobody@example.com")).toBeNull();
        const rec = await requestPasswordRecovery("forgot@example.com");
        expect(rec?.userId).toBe(user.id);

        const reset = await resetPassword({ token: rec!.token, newPassword: "a brand new password" });
        expect(reset.user.id).toBe(user.id);
        expect(await validateSession(session.token)).toBeNull();
        await expect(resetPassword({ token: rec!.token, newPassword: "reuse attempt password" })).rejects.toThrow(/not valid/);
        const again = await signIn({ email: "forgot@example.com", password: "a brand new password" });
        expect(again.user.id).toBe(user.id);
    });
});
