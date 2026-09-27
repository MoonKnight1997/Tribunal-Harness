/**
 * Evidence inbox over HTTP: the review queue and the decision endpoints for
 * allegations and facts, including tenant isolation on foreign ids.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/auth/current-user", async () => (await import("@/test/http")).currentUserMock());
vi.mock("next/headers", async () => (await import("@/test/http")).nextHeadersMock());

import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { allegations } from "@/db/schema";
import { signUp } from "@/auth/service";
import { createCase } from "@/cases/service";
import { uploadDocument } from "@/documents/service";
import { startProcess, addAllegation } from "@/processes/service";
import { proposeFact } from "@/facts/service";
import * as route from "@/app/api/cases/[caseId]/[[...path]]/route";
import { asUser, asAnonymous, callRoute } from "@/test/http";

const RANDOM = "00000000-0000-4000-8000-000000000000";
const LETTER = "Dear Sam, You are invited to attend a disciplinary hearing on 3 March 2026. The allegation: that you were absent without authorisation on 14 January 2026. It is alleged that you failed to follow the absence procedure.";

let alice: { userId: string };
let bob: { userId: string };
let aliceCase: string;
let bobCase: string;
let aliceDoc: string;
let bobProcess: string;
let bobAllegation: string;

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    const b = await signUp({ email: "bob@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
    bob = { userId: b.user.id };
    aliceCase = (await createCase(alice, { entryRoute: "disciplinary" })).id;
    bobCase = (await createCase(bob, { entryRoute: "disciplinary" })).id;
    const proc = await startProcess(alice, aliceCase, { type: "disciplinary" });
    aliceDoc = (await uploadDocument(alice, aliceCase, { filename: "invite.txt", mimeType: "text/plain", body: Buffer.from(LETTER), processId: proc.id })).document.id;
    bobProcess = (await startProcess(bob, bobCase, { type: "disciplinary" })).id;
    bobAllegation = (await addAllegation(bob, bobCase, bobProcess, { employerAllegation: "Bob took the stapler home" })).id;
    const db = await getDb();
    await db.update(allegations).set({ status: "proposed" }).where(eq(allegations.id, bobAllegation));
});

afterAll(async () => {
    await closeDb();
});

describe("GET /review", () => {
    it("401 anonymous; 200 with a queue for the owner; no confidence numbers", async () => {
        asAnonymous();
        expect((await callRoute(route, { method: "GET", caseId: aliceCase, path: ["review"] })).status).toBe(401);
        asUser(alice.userId, "alice@example.com");
        const res = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["review"] });
        expect(res.status).toBe(200);
        expect(res.json.remaining).toBe(res.json.items.length);
        expect(res.json.byKind.allegations).toBe(2);
        expect(res.json.byKind.events).toBeGreaterThanOrEqual(2);
        expect(res.text).not.toMatch(/confidence/i);
        const withExcerpt = res.json.items.filter((i: { source: { excerpt: unknown } }) => i.source.excerpt);
        expect(withExcerpt.length).toBeGreaterThan(0);
        expect(res.json.items.every((i: { source: { documentId: string } }) => i.source.documentId === aliceDoc)).toBe(true);
    });

    it("Bob's case id via Alice is 404, identical to a random id", async () => {
        asUser(alice.userId, "alice@example.com");
        const foreign = await callRoute(route, { method: "GET", caseId: bobCase, path: ["review"] });
        const random = await callRoute(route, { method: "GET", caseId: RANDOM, path: ["review"] });
        expect(foreign.status).toBe(404);
        expect(foreign.text).toBe(random.text);
        expect(foreign.text).not.toContain("stapler");
    });
});

describe("allegation decisions", () => {
    it("accept opens a proposed allegation and keeps EMPLOYER_ALLEGATION; withdraw marks it withdrawn; the queue shrinks", async () => {
        asUser(alice.userId, "alice@example.com");
        const q = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["review"] });
        const [a1, a2] = q.json.items.filter((i: { kind: string }) => i.kind === "allegation");
        const accept = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["allegations", a1.id, "accept"], body: {} });
        expect(accept.status).toBe(200);
        expect(accept.json.allegation.status).toBe("open");
        expect(accept.json.allegation.provenance).toBe("EMPLOYER_ALLEGATION");
        const withdraw = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["allegations", a2.id, "withdraw"], body: {} });
        expect(withdraw.status).toBe(200);
        expect(withdraw.json.allegation.status).toBe("withdrawn");
        const after = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["review"] });
        expect(after.json.remaining).toBe(q.json.remaining - 2);
        expect(after.json.byKind.allegations).toBe(0);
    });

    it("foreign allegation ids are 404, identical to missing, and Bob's row is unchanged", async () => {
        asUser(alice.userId, "alice@example.com");
        for (const action of ["accept", "withdraw"]) {
            const foreign = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["allegations", bobAllegation, action], body: {} });
            const missing = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["allegations", RANDOM, action], body: {} });
            expect(foreign.status, action).toBe(404);
            expect(foreign.json).toEqual(missing.json);
            expect(foreign.text).not.toContain("stapler");
        }
        const db = await getDb();
        const row = (await db.select().from(allegations).where(eq(allegations.id, bobAllegation)))[0];
        expect(row.status).toBe("proposed");
    });
});

describe("fact decisions", () => {
    it("reject removes a proposed fact from the queue; adopt supersedes a differing confirmed value; foreign ids 404", async () => {
        asUser(alice.userId, "alice@example.com");
        const confirmedRes = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["facts"], body: { statement: "Dismissed on 12 March 2026.", key: "dismissal_date", value: "2026-03-12", status: "confirmed" } });
        expect(confirmedRes.status).toBe(201);
        const proposal = await proposeFact(aliceCase, { statement: "The letter gives 13 March 2026 as the dismissal date.", provenance: "DOCUMENT_EXTRACTED", key: "dismissal_date", value: "2026-03-13", sourceDocumentId: aliceDoc });
        const toReject = await proposeFact(aliceCase, { statement: "Something the extractor got wrong.", provenance: "DOCUMENT_EXTRACTED", sourceDocumentId: aliceDoc });

        const q = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["review"] });
        const item = q.json.items.find((i: { id: string }) => i.id === proposal.id);
        expect(item.conflicts.map((c: { kind: string }) => c.kind)).toContain("differs_from_confirmed");

        const rej = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["facts", toReject.id, "reject"], body: {} });
        expect(rej.status).toBe(200);
        const adopt = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["facts", proposal.id, "adopt"], body: {} });
        expect(adopt.status).toBe(200);
        expect(adopt.json.fact.status).toBe("confirmed");
        expect(adopt.json.fact.provenance).toBe("DOCUMENT_CONFIRMED");

        const after = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["review"] });
        expect(after.json.byKind.facts).toBe(0);
        const factsRes = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["facts"], query: { status: "confirmed" } });
        const dismissal = factsRes.json.facts.filter((f: { key: string | null }) => f.key === "dismissal_date");
        expect(dismissal).toHaveLength(1);
        expect(dismissal[0].value).toBe("2026-03-13");

        const foreign = await callRoute(route, { method: "POST", caseId: bobCase, path: ["facts", proposal.id, "adopt"], body: {} });
        expect(foreign.status).toBe(404);
        const missing = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["facts", RANDOM, "adopt"], body: {} });
        expect(missing.status).toBeGreaterThanOrEqual(400);
    });
});
