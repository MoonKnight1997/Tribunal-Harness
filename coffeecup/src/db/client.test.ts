import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, closeDb, getDbKind } from "./client";
import { users } from "./schema";

describe("database client", () => {
    afterAll(async () => {
        await closeDb();
    });

    it("connects to an in-memory PGlite database under test and applies migrations", async () => {
        const db = await getDb();
        expect(getDbKind()).toBe("pglite");
        await db.insert(users).values({ id: "u1", email: "a@example.com", passwordHash: "x" });
        const rows = await db.select().from(users).where(eq(users.id, "u1"));
        expect(rows).toHaveLength(1);
        expect(rows[0].email).toBe("a@example.com");
        expect(rows[0].createdAt).toBeInstanceOf(Date);
    });

    it("returns the same connection on repeated calls", async () => {
        const a = await getDb();
        const b = await getDb();
        expect(a).toBe(b);
    });
});
