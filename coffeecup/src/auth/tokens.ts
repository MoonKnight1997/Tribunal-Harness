import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. The raw value goes to the user only. */
export function generateToken(): string {
    return randomBytes(32).toString("base64url");
}

/** What we store: a SHA-256 of the token, so a database leak cannot be replayed. */
export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}
