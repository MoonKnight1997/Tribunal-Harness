import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/auth/current-user", async () => (await import("@/test/http")).currentUserMock());
vi.mock("next/headers", async () => (await import("@/test/http")).nextHeadersMock());

import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import { createCase, updateEmployment } from "@/cases/service";
import { addFact, setStructuredFact } from "@/facts/service";
import { NotFoundError } from "@/lib/errors";
import { identifyClaims, listClaimCandidates, listClaimElements } from "./service";
import * as route from "@/app/api/cases/[caseId]/[[...path]]/route";
import { asUser, callRoute } from "@/test/http";

let alice: { userId: string };
let bob: { userId: string };
let aliceCase: string;
let bobCase: string;
let bobCandidate: string;

beforeAll(async () => {
    process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    const b = await signUp({ email: "bob@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
    bob = { userId: b.user.id };

    aliceCase = (await createCase(alice, { entryRoute: "dismissal" })).id;
    bobCase = (await createCase(bob, { entryRoute: "dismissal" })).id;
    await updateEmployment(bob, bobCase, { employerName: "Acme Ltd", employmentStatus: "employee", startDate: "2021-03-01", endDate: "2026-03-03", stillEmployed: false });
    await setStructuredFact(bob, bobCase, "employment_start", "2021-03-01", "I started work on 1 March 2021.");
    await setStructuredFact(bob, bobCase, "dismissal_date", "2026-03-03", "I was dismissed on 3 March 2026.");
    await addFact(bob, bobCase, { statement: "No investigation meeting or disciplinary hearing was held before I was dismissed.", status: "confirmed" });
    const candidates = await identifyClaims(bob, bobCase);
    bobCandidate = candidates.find((c) => c.claimType === "unfair_dismissal")!.id;
    // Sanity: Bob's candidate really has private element reasoning to protect.
    expect((await listClaimElements(bob, bobCase, bobCandidate)).length).toBeGreaterThan(0);
});

afterAll(async () => {
    await closeDb();
});

describe("claim elements are bound to the authorised case (F01)", () => {
    it("service: Alice cannot read Bob's elements through her own case id", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const err = await listClaimElements(alice, aliceCase, bobCandidate).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(NotFoundError);
        expect((err as NotFoundError).status).toBe(404);
        // Same response as a candidate that does not exist at all.
        const missing = await listClaimElements(alice, aliceCase, "00000000-0000-4000-8000-000000000000").catch((e: Error) => e.message);
        expect((err as Error).message).toBe(missing);
    });

    it("service: Alice cannot list Bob's candidates through Bob's case id", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        await expect(listClaimCandidates(alice, bobCase)).rejects.toBeInstanceOf(NotFoundError);
        await expect(listClaimElements(alice, bobCase, bobCandidate)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("HTTP: GET /api/cases/{aliceCase}/claims/{bobCandidate}/elements is 404 with no element data", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        asUser(alice.userId, "alice@example.com");
        const res = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["claims", bobCandidate, "elements"] });
        expect(res.status).toBe(404);
        expect(res.json.code).toBe("not_found");
        expect(res.json.elements).toBeUndefined();
        expect(res.text).not.toMatch(/reasoning|qualifying_service|24-month/);

        const missing = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["claims", "00000000-0000-4000-8000-000000000000", "elements"] });
        expect(missing.status).toBe(404);
        expect(missing.json).toEqual(res.json);
    });

    it("HTTP: the legitimate owner still reads their own elements", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        asUser(bob.userId, "bob@example.com");
        const res = await callRoute(route, { method: "GET", caseId: bobCase, path: ["claims", bobCandidate, "elements"] });
        expect(res.status).toBe(200);
        expect(res.json.elements.length).toBeGreaterThan(0);
        expect(res.json.elements.every((e: { claimCandidateId: string; caseId: string }) => e.claimCandidateId === bobCandidate && e.caseId === bobCase)).toBe(true);
    });
});
