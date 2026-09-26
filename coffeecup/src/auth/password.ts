/**
 * Password hashing.
 *
 * Uses Node's built-in scrypt (RFC 7914) with OWASP-recommended parameters:
 * N = 2^17, r = 8, p = 1, 16-byte random salt, 64-byte derived key. No custom
 * cryptography: this is the standard KDF, the standard random salt and a
 * constant-time comparison. The stored string is self-describing so the
 * parameters can be raised later and old hashes verified during migration.
 *
 * Format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

function scrypt(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
    });
}

const DEFAULT_N = 2 ** 17;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Tests use lighter parameters so the suite stays fast; production never does. */
function params(): { N: number; r: number; p: number } {
    if (process.env.NODE_ENV === "test") return { N: 2 ** 12, r: 8, p: 1 };
    return { N: DEFAULT_N, r: DEFAULT_R, p: DEFAULT_P };
}

async function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
    const maxmem = 128 * N * r * 2; // scrypt needs ~128*N*r bytes; allow headroom.
    return scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem });
}

export async function hashPassword(password: string): Promise<string> {
    const { N, r, p } = params();
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, N, r, p);
    return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
    const actual = await derive(password, salt, N, r, p);
    return timingSafeEqual(actual, expected);
}

/** Minimum password policy: length only (NIST 800-63B discourages composition rules). */
export const MIN_PASSWORD_LENGTH = 10;

export function passwordPolicyProblem(password: string): string | null {
    if (typeof password !== "string") return "Please enter a password.";
    if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password.length > 200) return "That password is too long.";
    return null;
}
