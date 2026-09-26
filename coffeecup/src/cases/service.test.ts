import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import {
    createCase,
    listCases,
    getCase,
    updateCase,
    deleteCase,
    updateEmployment,
    getEmployment,
    addPerson,
    listPersons,
} from "./service";

let alice: { userId: string };
let bob: { userId: string };

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    const b = await signUp({ email: "bob@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
    bob = { userId: b.user.id };
});

afterAll(async () => {
    await closeDb();
});

describe("case persistence", () => {
    it("creates a case with a stage derived from the entry route", async () => {
        const c = await createCase(alice, { entryRoute: "disciplinary", intake: { situationDescription: "I was invited to a hearing." } });
        expect(c.stage).toBe("disciplinary");
        expect(c.title).toBe("My disciplinary process");
        expect(c.jurisdiction).toBe("england_wales");
        const listed = await listCases(alice);
        expect(listed.map((x) => x.id)).toContain(c.id);
    });

    it("persists employment details and validates dates", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        const emp = await updateEmployment(alice, c.id, { employerName: "Acme Ltd", startDate: "2021-03-01", endDate: "2026-03-03", employmentStatus: "employee" });
        expect(emp.employerName).toBe("Acme Ltd");
        expect((await getEmployment(alice, c.id)).endDate).toBe("2026-03-03");
        await expect(updateEmployment(alice, c.id, { startDate: "2026-04-01", endDate: "2026-03-03" })).rejects.toThrow(/end date/);
        await expect(updateEmployment(alice, c.id, { startDate: "2026-02-30" })).rejects.toThrow();
    });

    it("stores people involved", async () => {
        const c = await createCase(alice, { entryRoute: "grievance" });
        await addPerson(alice, c.id, { name: "Sam Manager", role: "manager" });
        const people = await listPersons(alice, c.id);
        expect(people).toHaveLength(1);
        expect(people[0].role).toBe("manager");
    });

    it("soft-deletes and hides the case", async () => {
        const c = await createCase(alice, { entryRoute: "pay" });
        await deleteCase(alice, c.id);
        await expect(getCase(alice, c.id)).rejects.toThrow(/not found/i);
        expect((await listCases(alice)).map((x) => x.id)).not.toContain(c.id);
    });
});

describe("tenant isolation", () => {
    it("never exposes one user's case to another, even with a guessed id", async () => {
        const c = await createCase(alice, { entryRoute: "discrimination" });
        await expect(getCase(bob, c.id)).rejects.toThrow(/not found/i);
        await expect(updateCase(bob, c.id, { title: "hijack" })).rejects.toThrow(/not found/i);
        await expect(updateEmployment(bob, c.id, { employerName: "x" })).rejects.toThrow(/not found/i);
        await expect(listPersons(bob, c.id)).rejects.toThrow(/not found/i);
        await expect(deleteCase(bob, c.id)).rejects.toThrow(/not found/i);
        expect((await listCases(bob)).map((x) => x.id)).not.toContain(c.id);
        // Alice's case is untouched.
        expect((await getCase(alice, c.id)).title).not.toBe("hijack");
    });

    it("returns an identical error for a non-existent case", async () => {
        const a = await getCase(bob, "does-not-exist").catch((e) => e.message);
        const c = await createCase(alice, { entryRoute: "pay" });
        const b = await getCase(bob, c.id).catch((e) => e.message);
        expect(a).toBe(b);
    });
});
