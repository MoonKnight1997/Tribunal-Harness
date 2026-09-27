/**
 * HTTP-level tenant isolation for the case sub-resource router.
 *
 * Two legitimate signed-in users, Alice and Bob. Every request is made by
 * Alice against her own case but naming one of Bob's resource ids. The
 * acceptance criteria: no foreign content is returned, nothing is written,
 * and the response is identical to the one for a resource that does not exist.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/auth/current-user", async () => (await import("@/test/http")).currentUserMock());
vi.mock("next/headers", async () => (await import("@/test/http")).nextHeadersMock());

import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { allegations, appealGrounds, documentLinks, events } from "@/db/schema";
import { signUp } from "@/auth/service";
import { createCase } from "@/cases/service";
import { uploadDocument } from "@/documents/service";
import { startProcess, addAllegation, addAppealGround, listAllegations, listAppealGrounds } from "@/processes/service";
import { addEvent } from "@/timeline/service";
import * as route from "@/app/api/cases/[caseId]/[[...path]]/route";
import { asUser, asAnonymous, callRoute } from "@/test/http";

const RANDOM = "00000000-0000-4000-8000-000000000000";

let alice: { userId: string };
let bob: { userId: string };
let aliceCase: string;
let bobCase: string;
let bobDocument: string;
let bobProcess: string;
let bobAppeal: string;
let bobAllegation: string;
let bobGround: string;
let bobEvent: string;
let aliceProcess: string;
let aliceEventA: string;
let aliceEventB: string;

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    const b = await signUp({ email: "bob@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
    bob = { userId: b.user.id };
    aliceCase = (await createCase(alice, { entryRoute: "disciplinary" })).id;
    bobCase = (await createCase(bob, { entryRoute: "disciplinary" })).id;

    bobDocument = (await uploadDocument(bob, bobCase, { filename: "bob-private.txt", mimeType: "text/plain", body: Buffer.from("Bob's private letter about a hearing on 3 March 2026.") })).document.id;
    bobProcess = (await startProcess(bob, bobCase, { type: "disciplinary" })).id;
    bobAppeal = (await startProcess(bob, bobCase, { type: "disciplinary_appeal", parentProcessId: bobProcess })).id;
    bobAllegation = (await addAllegation(bob, bobCase, bobProcess, { employerAllegation: "Bob was late on 1 February 2026" })).id;
    bobGround = (await addAppealGround(bob, bobCase, bobAppeal, { category: "procedural_issue", summary: "Bob was not shown the evidence." })).id;
    bobEvent = (await addEvent(bob, bobCase, { date: "2026-02-01", title: "Bob's meeting" })).id;

    aliceProcess = (await startProcess(alice, aliceCase, { type: "disciplinary" })).id;
    aliceEventA = (await addEvent(alice, aliceCase, { date: "2026-02-10", title: "Alice meeting A" })).id;
    aliceEventB = (await addEvent(alice, aliceCase, { date: "2026-02-10", title: "Alice meeting A (dup)" })).id;
});

afterAll(async () => {
    await closeDb();
});

async function countLinks(documentId: string): Promise<number> {
    const db = await getDb();
    return (await db.select({ id: documentLinks.id }).from(documentLinks).where(eq(documentLinks.documentId, documentId))).length;
}

describe("harness", () => {
    it("returns 401 when nobody is signed in, and 200 for the owner", async () => {
        asAnonymous();
        expect((await callRoute(route, { method: "GET", caseId: aliceCase })).status).toBe(401);
        asUser(alice.userId, "alice@example.com");
        const res = await callRoute(route, { method: "GET", caseId: aliceCase });
        expect(res.status).toBe(200);
        expect(res.json.case.id).toBe(aliceCase);
    });
});

describe("referenced ids inside a body must belong to the case", () => {
    it("Alice cannot create an event citing Bob's document: 400 and no document_links row", async () => {
        asUser(alice.userId, "alice@example.com");
        const before = await countLinks(bobDocument);
        const res = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["events"], body: { date: "2026-02-11", title: "Steal a doc", sourceDocumentIds: [bobDocument] } });
        expect(res.status).toBe(400);
        expect(res.json.code).toBe("validation");
        expect(res.text).not.toContain(bobDocument);
        expect(await countLinks(bobDocument)).toBe(before);
        const db = await getDb();
        const stolen = await db.select().from(events).where(and(eq(events.caseId, aliceCase), eq(events.title, "Steal a doc")));
        expect(stolen).toHaveLength(0);
    });

    it("Alice cannot attach Bob's document to an existing event via PATCH", async () => {
        asUser(alice.userId, "alice@example.com");
        const before = await countLinks(bobDocument);
        const res = await callRoute(route, { method: "PATCH", caseId: aliceCase, path: ["events", aliceEventA], body: { sourceDocumentIds: [bobDocument] } });
        expect(res.status).toBe(400);
        expect(res.json.code).toBe("validation");
        expect(await countLinks(bobDocument)).toBe(before);
    });

    it("Alice cannot record a fact sourced from Bob's document or event", async () => {
        asUser(alice.userId, "alice@example.com");
        const r1 = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["facts"], body: { statement: "Sourced from Bob", sourceDocumentId: bobDocument } });
        expect(r1.status).toBe(400);
        const r2 = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["facts"], body: { statement: "Sourced from Bob", sourceEventId: bobEvent } });
        expect(r2.status).toBe(400);
        const facts = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["facts"] });
        expect(facts.json.facts.some((f: { statement: string }) => f.statement === "Sourced from Bob")).toBe(false);
    });

    it("Alice cannot start an appeal whose parent is Bob's process", async () => {
        asUser(alice.userId, "alice@example.com");
        const res = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes"], body: { type: "disciplinary_appeal", parentProcessId: bobProcess } });
        expect(res.status).toBe(400);
        expect(res.json.code).toBe("validation");
    });

    it("Alice cannot cite Bob's document or events from her own allegation, or Bob's document from her appeal ground", async () => {
        asUser(alice.userId, "alice@example.com");
        const r1 = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes", aliceProcess, "allegations"], body: { employerAllegation: "Late", sourceDocumentId: bobDocument } });
        expect(r1.status).toBe(400);
        const r2 = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes", aliceProcess, "allegations"], body: { employerAllegation: "Late", proceduralEventIds: [bobEvent] } });
        expect(r2.status).toBe(400);
        const appeal = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes"], body: { type: "disciplinary_appeal", parentProcessId: aliceProcess } });
        expect(appeal.status).toBe(201);
        const r3 = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes", appeal.json.process.id, "grounds"], body: { category: "new_evidence", summary: "Bob's file proves it", supportingDocumentIds: [bobDocument] } });
        expect(r3.status).toBe(400);
        expect(await listAllegations(alice, aliceCase, aliceProcess)).toHaveLength(0);
        expect(await listAppealGrounds(alice, aliceCase, appeal.json.process.id)).toHaveLength(0);
    });
});

describe("path resource ids from another case are 404, identical to missing", () => {
    it("POST /processes/{bobProcess}/allegations via Alice's case: 404 and no row", async () => {
        asUser(alice.userId, "alice@example.com");
        const res = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes", bobProcess, "allegations"], body: { employerAllegation: "Injected into Bob's process" } });
        expect(res.status).toBe(404);
        const missing = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes", RANDOM, "allegations"], body: { employerAllegation: "Injected into Bob's process" } });
        expect(missing.status).toBe(404);
        expect(missing.json).toEqual(res.json);
        const bobs = await listAllegations(bob, bobCase, bobProcess);
        expect(bobs.map((a) => a.employerAllegation)).not.toContain("Injected into Bob's process");
        expect(bobs).toHaveLength(1);
    });

    it("GET/PATCH /processes/{bobProcess} via Alice's case: 404, no process data", async () => {
        asUser(alice.userId, "alice@example.com");
        const get = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["processes", bobProcess] });
        expect(get.status).toBe(404);
        expect(get.json.process).toBeUndefined();
        const list = await callRoute(route, { method: "GET", caseId: aliceCase, path: ["processes", bobProcess, "allegations"] });
        expect(list.status).toBe(404);
        expect(list.text).not.toContain("Bob was late");
        const transition = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes", bobProcess, "transition"], body: { to: "hearing_scheduled" } });
        expect(transition.status).toBe(404);
    });

    it("DELETE /allegations/{bobAllegation} via Alice's case: 404 and Bob's row still exists", async () => {
        asUser(alice.userId, "alice@example.com");
        const res = await callRoute(route, { method: "DELETE", caseId: aliceCase, path: ["allegations", bobAllegation] });
        expect(res.status).toBe(404);
        expect(res.json.ok).toBeUndefined();
        const missing = await callRoute(route, { method: "DELETE", caseId: aliceCase, path: ["allegations", RANDOM] });
        expect(missing.json).toEqual(res.json);
        const db = await getDb();
        expect(await db.select().from(allegations).where(eq(allegations.id, bobAllegation))).toHaveLength(1);
    });

    it("PATCH /allegations/{bobAllegation} via Alice's case: 404 and Bob's row unchanged", async () => {
        asUser(alice.userId, "alice@example.com");
        const res = await callRoute(route, { method: "PATCH", caseId: aliceCase, path: ["allegations", bobAllegation], body: { workerResponse: "tampered" } });
        expect(res.status).toBe(404);
        expect(res.text).not.toContain("Bob was late");
        const db = await getDb();
        const row = (await db.select().from(allegations).where(eq(allegations.id, bobAllegation)))[0];
        expect(row.workerResponse).toBeNull();
    });

    it("PATCH/DELETE /grounds/{bobGround} via Alice's case: 404 and Bob's row unchanged", async () => {
        asUser(alice.userId, "alice@example.com");
        const patch = await callRoute(route, { method: "PATCH", caseId: aliceCase, path: ["grounds", bobGround], body: { summary: "tampered ground" } });
        expect(patch.status).toBe(404);
        expect(patch.text).not.toContain("not shown the evidence");
        const missing = await callRoute(route, { method: "PATCH", caseId: aliceCase, path: ["grounds", RANDOM], body: { summary: "tampered ground" } });
        expect(missing.json).toEqual(patch.json);
        const del = await callRoute(route, { method: "DELETE", caseId: aliceCase, path: ["grounds", bobGround] });
        expect(del.status).toBe(404);
        const db = await getDb();
        const row = (await db.select().from(appealGrounds).where(eq(appealGrounds.id, bobGround)))[0];
        expect(row).toBeDefined();
        expect(row.summary).toBe("Bob was not shown the evidence.");
    });

    it("events: merging into or from Bob's event is 404; Bob's event untouched", async () => {
        asUser(alice.userId, "alice@example.com");
        const keepForeign = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["events", "merge"], body: { keepId: bobEvent, mergeIds: [aliceEventA] } });
        expect(keepForeign.status).toBe(404);
        const mergeForeign = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["events", "merge"], body: { keepId: aliceEventA, mergeIds: [bobEvent] } });
        expect(mergeForeign.status).toBe(400);
        const db = await getDb();
        const row = (await db.select().from(events).where(eq(events.id, bobEvent)))[0];
        expect(row.status).toBe("confirmed");
        expect(row.mergedIntoId).toBeNull();
        const del = await callRoute(route, { method: "DELETE", caseId: aliceCase, path: ["events", bobEvent] });
        expect(del.status).toBe(404);
        expect(await db.select().from(events).where(eq(events.id, bobEvent))).toHaveLength(1);
    });
});

describe("foreign case id anywhere is identical to a random case id", () => {
    const paths: Array<{ method: "GET" | "POST" | "PATCH" | "DELETE"; path: string[]; body?: unknown }> = [
        { method: "GET", path: [] },
        { method: "GET", path: ["dashboard"] },
        { method: "GET", path: ["events"] },
        { method: "GET", path: ["facts"] },
        { method: "GET", path: ["documents"] },
        { method: "GET", path: ["processes"] },
        { method: "GET", path: ["tasks"] },
        { method: "GET", path: ["artifacts"] },
        { method: "GET", path: ["deadlines"] },
        { method: "GET", path: ["export"] },
        { method: "POST", path: ["events"], body: { date: "2026-01-01", title: "x" } },
        { method: "POST", path: ["processes"], body: { type: "grievance" } },
        { method: "PATCH", path: [], body: { title: "hijack" } },
        { method: "DELETE", path: [] },
    ];

    it.each(paths)("$method /$path", async ({ method, path, body }) => {
        asUser(alice.userId, "alice@example.com");
        const foreign = await callRoute(route, { method, caseId: bobCase, path, body });
        const random = await callRoute(route, { method, caseId: RANDOM, path, body });
        expect(foreign.status).toBe(404);
        expect(random.status).toBe(404);
        expect(foreign.json).toEqual(random.json);
        expect(foreign.text).toBe(random.text);
    });

    it("Bob's case is untouched afterwards", async () => {
        asUser(bob.userId, "bob@example.com");
        const res = await callRoute(route, { method: "GET", caseId: bobCase });
        expect(res.status).toBe(200);
        expect(res.json.case.title).not.toBe("hijack");
        expect(res.json.case.deletedAt).toBeNull();
    });
});

describe("malformed bodies are 400 validation, never 500", () => {
    it("events/merge", async () => {
        asUser(alice.userId, "alice@example.com");
        for (const body of [{}, { keepId: aliceEventA }, { keepId: aliceEventA, mergeIds: "nope" }, { keepId: 5, mergeIds: [] }, { keepId: aliceEventA, mergeIds: [] }]) {
            const res = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["events", "merge"], body });
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.json.code).toBe("validation");
        }
        // A well-formed merge still works.
        const ok = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["events", "merge"], body: { keepId: aliceEventA, mergeIds: [aliceEventB] } });
        expect(ok.status).toBe(200);
        expect(ok.json.event.id).toBe(aliceEventA);
    });

    it("processes/:pid/transition", async () => {
        asUser(alice.userId, "alice@example.com");
        for (const body of [{}, { to: 3 }, { to: "" }, { to: "hearing_scheduled", note: 7 }]) {
            const res = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["processes", aliceProcess, "transition"], body });
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.json.code).toBe("validation");
        }
    });

    it("checkout", async () => {
        asUser(alice.userId, "alice@example.com");
        for (const body of [{}, { tier: "gold" }, { tier: 1 }]) {
            const res = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["checkout"], body });
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.json.code).toBe("validation");
        }
    });

    it("tasks/:tid, summary/confirm, facts/structured/:key, artifacts", async () => {
        asUser(alice.userId, "alice@example.com");
        const task = await callRoute(route, { method: "PATCH", caseId: aliceCase, path: ["tasks", RANDOM], body: { done: "yes" } });
        expect(task.status).toBe(400);
        expect(task.json.code).toBe("validation");

        const summary = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["summary", "confirm"], body: { summary: 12 } });
        expect(summary.status).toBe(400);
        const tooLong = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["summary", "confirm"], body: { summary: "x".repeat(5001) } });
        expect(tooLong.status).toBe(400);

        const badDate = await callRoute(route, { method: "PUT", caseId: aliceCase, path: ["facts", "structured", "dismissal_date"], body: { value: "3 March 2026" } });
        expect(badDate.status).toBe(400);
        expect(badDate.json.code).toBe("validation");
        const badKey = await callRoute(route, { method: "PUT", caseId: aliceCase, path: ["facts", "structured", "not_a_key"], body: { value: "2026-03-03" } });
        expect(badKey.status).toBe(400);

        const badType = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["artifacts"], body: { type: "ransom_note" } });
        expect(badType.status).toBe(400);
        expect(badType.json.code).toBe("validation");
        const noType = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["artifacts"], body: {} });
        expect(noType.status).toBe(400);
    });

    it("invalid JSON is 400 bad_json", async () => {
        asUser(alice.userId, "alice@example.com");
        const res = await callRoute(route, { method: "POST", caseId: aliceCase, path: ["events", "merge"], body: "{not json" });
        expect(res.status).toBe(400);
        expect(res.json.code).toBe("bad_json");
    });
});
