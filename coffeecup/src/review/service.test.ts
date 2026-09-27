/**
 * Evidence inbox: one queue for proposed events, facts and allegations, with
 * the source passage beside each item and conflicts made explicit.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { allegations, events, facts } from "@/db/schema";
import { signUp } from "@/auth/service";
import { createCase } from "@/cases/service";
import { uploadDocument } from "@/documents/service";
import { addEvent, proposeEvent, confirmEvent, rejectEvent, listConfirmedEvents } from "@/timeline/service";
import { addFact, proposeFact, confirmFact, rejectFact, getStructuredFact, adoptFact } from "@/facts/service";
import { startProcess, listAllegations, acceptAllegation, withdrawAllegation } from "@/processes/service";
import { newId } from "@/lib/ids";
import { buildReviewQueue, countReviewItems, computeExcerpt, findQuote, titleSimilarity } from "./service";

const LETTER = `Dear Sam,

You are invited to attend a disciplinary hearing on 3 March 2026. The allegation: that you were absent without authorisation on 14 January 2026. It is alleged that you failed to follow the absence procedure.

Yours sincerely,
HR`;

let alice: { userId: string };
let bob: { userId: string };
let aliceCase: string;
let bobCase: string;
let docId: string;
let processId: string;

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    const b = await signUp({ email: "bob@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
    bob = { userId: b.user.id };
    aliceCase = (await createCase(alice, { entryRoute: "disciplinary" })).id;
    bobCase = (await createCase(bob, { entryRoute: "disciplinary" })).id;
    processId = (await startProcess(alice, aliceCase, { type: "disciplinary" })).id;
    // Upload with the process so the mock extractor's allegations land in it.
    const { document } = await uploadDocument(alice, aliceCase, { filename: "invite.txt", mimeType: "text/plain", body: Buffer.from(LETTER), processId });
    docId = document.id;
    expect(document.extractionStatus).toBe("completed");
});

afterAll(async () => {
    await closeDb();
});

describe("excerpt computation (pure)", () => {
    const text = "One two three. The hearing is on 3 March 2026 at 10am. Please bring a companion. Four five six.";

    it("uses offsets when present and snaps to word boundaries", () => {
        const start = text.indexOf("3 March 2026");
        const ex = computeExcerpt(text, { location: { startOffset: start, endOffset: start + "3 March 2026".length } });
        expect(ex).not.toBeNull();
        expect(ex!.match).toBe("3 March 2026");
        expect(ex!.before.endsWith("is on ")).toBe(true);
        expect(ex!.after.startsWith(" at 10am")).toBe(true);
    });

    it("falls back to a case-insensitive, whitespace-tolerant search for the quote", () => {
        const ex = computeExcerpt(text, { quote: "the HEARING is   on 3 march 2026" });
        expect(ex).not.toBeNull();
        expect(ex!.match).toBe("The hearing is on 3 March 2026");
        expect(findQuote(text, "not in the text at all")).toBeNull();
    });

    it("ignores unusable offsets and returns null when nothing can be located", () => {
        expect(computeExcerpt(text, { location: { startOffset: 5000, endOffset: 5010 }, quote: "nowhere" })).toBeNull();
        expect(computeExcerpt(null, { quote: "hearing" })).toBeNull();
        expect(computeExcerpt(text, { location: { startOffset: 10, endOffset: 4 } })).toBeNull();
    });

    it("limits context to about 240 characters each side, on whitespace, with ellipses", () => {
        const long = `${"word ".repeat(200)}TARGET PHRASE ${"tail ".repeat(200)}`;
        const ex = computeExcerpt(long, { quote: "TARGET PHRASE" })!;
        expect(ex.before.startsWith("…")).toBe(true);
        expect(ex.after.endsWith("…")).toBe(true);
        expect(ex.before.length).toBeLessThanOrEqual(260);
        expect(ex.after.length).toBeLessThanOrEqual(260);
        expect(ex.before).not.toMatch(/…wor\b/); // no cut word
    });

    it("title similarity is shared content words over the smaller set", () => {
        expect(titleSimilarity("Disciplinary hearing", "You are invited to attend a disciplinary hearing on 3 March 2026")).toBe(1);
        expect(titleSimilarity("Grievance meeting with HR", "Payslip received")).toBe(0);
    });
});

describe("queue contents", () => {
    it("covers events, facts and allegations, with excerpts and no confidence numbers", async () => {
        const q = await buildReviewQueue(alice, aliceCase);
        expect(q.remaining).toBe(q.items.length);
        expect(q.byKind.events).toBeGreaterThanOrEqual(2);
        expect(q.byKind.allegations).toBe(2);
        expect(q.items.filter((i) => i.kind === "allegation")).toHaveLength(2);

        const hearing = q.items.find((i) => i.kind === "event" && i.date === "2026-03-03")!;
        expect(hearing.provenanceLabel).toBe("The document says");
        expect(hearing.source.filename).toBe("invite.txt");
        expect(hearing.source.excerpt).not.toBeNull();
        expect(hearing.source.excerpt!.match.toLowerCase()).toContain("3 march 2026");
        expect(hearing.actions).toEqual(["confirm", "correct", "reject"]);

        const allegation = q.items.find((i) => i.kind === "allegation")!;
        expect(allegation.provenanceLabel).toBe("The employer alleges");
        expect(allegation.processId).toBe(processId);
        expect(allegation.source.excerpt).not.toBeNull();
        expect(allegation.actions).toEqual(["accept_as_allegation", "withdraw"]);

        // Never a confidence percentage in the payload.
        expect(JSON.stringify(q)).not.toMatch(/confidence/i);
        for (const item of q.items) expect(Object.keys(item)).not.toContain("confidence");
    });

    it("allegations from a process appear exactly once each and are not duplicated as facts", async () => {
        const q = await buildReviewQueue(alice, aliceCase);
        const ids = q.items.map((i) => i.id);
        expect(new Set(ids).size).toBe(ids.length);
        const rows = await listAllegations(alice, aliceCase, processId);
        expect(rows.filter((r) => r.status === "proposed").map((r) => r.id).sort()).toEqual(q.items.filter((i) => i.kind === "allegation").map((i) => i.id).sort());
    });

    it("uses recorded offsets and quotes when the pipeline stored them, and flags an unverified quote", async () => {
        const db = await getDb();
        const start = LETTER.indexOf("absent without authorisation");
        const withOffsets = newId();
        await db.insert(events).values({ id: withOffsets, caseId: aliceCase, date: "2026-01-14", title: "Absence (offsets)", status: "proposed", userConfirmed: false, provenance: "DOCUMENT_EXTRACTED", sourceDocumentIds: [docId], sourceQuote: "absent without authorisation", sourceLocation: { documentId: docId, startOffset: start, endOffset: start + "absent without authorisation".length, page: null }, quoteVerified: true });
        const unverified = newId();
        await db.insert(facts).values({ id: unverified, caseId: aliceCase, statement: "Sam was warned in writing in December 2025.", status: "proposed", provenance: "DOCUMENT_EXTRACTED", sourceDocumentId: docId, sourceQuote: "a written warning was issued in December 2025", quoteVerified: false });

        const q = await buildReviewQueue(alice, aliceCase);
        const a = q.items.find((i) => i.id === withOffsets)!;
        expect(a.source.excerpt!.match).toBe("absent without authorisation");
        expect(a.source.quoteVerified).toBe(true);
        expect(a.conflicts).toEqual([]);

        const u = q.items.find((i) => i.id === unverified)!;
        expect(u.source.excerpt).toBeNull();
        expect(u.source.quoteVerified).toBe(false);
        expect(u.conflicts.map((c) => c.kind)).toContain("unverified_quote");

        await rejectEvent(alice, aliceCase, withOffsets);
        await rejectFact(alice, aliceCase, unverified);
    });
});

describe("conflicts", () => {
    it("a proposed structured fact that differs from the confirmed value is flagged; adopting it supersedes the old one", async () => {
        await addFact(alice, aliceCase, { statement: "I was dismissed on 12 March 2026.", key: "dismissal_date", value: "2026-03-12", status: "confirmed" });
        const proposal = await proposeFact(aliceCase, { statement: "The letter says the dismissal took effect on 13 March 2026.", provenance: "DOCUMENT_EXTRACTED", key: "dismissal_date", value: "2026-03-13", sourceDocumentId: docId });
        const q = await buildReviewQueue(alice, aliceCase);
        const item = q.items.find((i) => i.id === proposal.id)!;
        expect(item.kind).toBe("fact");
        expect(item.date).toBe("2026-03-13");
        const conflict = item.conflicts.find((c) => c.kind === "differs_from_confirmed")!;
        expect(conflict).toBeDefined();
        expect(conflict.confirmedValue).toBe("2026-03-12");
        expect(conflict.message).toContain("12 March 2026");

        const same = await proposeFact(aliceCase, { statement: "Same value.", provenance: "DOCUMENT_EXTRACTED", key: "dismissal_date", value: "2026-03-12", sourceDocumentId: docId });
        const q2 = await buildReviewQueue(alice, aliceCase);
        expect(q2.items.find((i) => i.id === same.id)!.conflicts.some((c) => c.kind === "differs_from_confirmed")).toBe(false);
        await rejectFact(alice, aliceCase, same.id);

        // "Use this date instead"
        await adoptFact(alice, aliceCase, proposal.id);
        const current = await getStructuredFact(aliceCase, "dismissal_date");
        expect(current?.value).toBe("2026-03-13");
        expect(current?.provenance).toBe("DOCUMENT_CONFIRMED");
        const db = await getDb();
        const rows = await db.select().from(facts).where(eq(facts.key, "dismissal_date"));
        expect(rows.filter((r) => r.caseId === aliceCase && r.status === "confirmed")).toHaveLength(1);
        expect(rows.find((r) => r.value === "2026-03-12")?.status).toBe("superseded");
    });

    it("a proposed event on the same date as a similar confirmed event is a possible duplicate", async () => {
        const confirmed = await addEvent(alice, aliceCase, { date: "2026-02-20", title: "Investigation meeting with Ms Khan" });
        const dup = await proposeEvent(aliceCase, { date: "2026-02-20", title: "Investigation meeting", sourceDocumentId: docId });
        const other = await proposeEvent(aliceCase, { date: "2026-02-20", title: "Payslip received", sourceDocumentId: docId });
        const otherDay = await proposeEvent(aliceCase, { date: "2026-02-21", title: "Investigation meeting with Ms Khan", sourceDocumentId: docId });
        const q = await buildReviewQueue(alice, aliceCase);
        const d = q.items.find((i) => i.id === dup!.id)!;
        const c = d.conflicts.find((x) => x.kind === "possible_duplicate")!;
        expect(c).toBeDefined();
        expect(c.relatedId).toBe(confirmed.id);
        expect(q.items.find((i) => i.id === other!.id)!.conflicts.some((x) => x.kind === "possible_duplicate")).toBe(false);
        expect(q.items.find((i) => i.id === otherDay!.id)!.conflicts.some((x) => x.kind === "possible_duplicate")).toBe(false);
        for (const id of [dup!.id, other!.id, otherDay!.id]) await rejectEvent(alice, aliceCase, id);
    });
});

describe("decisions", () => {
    it("remaining decreases after confirm and reject, and the count helper agrees", async () => {
        const before = await buildReviewQueue(alice, aliceCase);
        expect(await countReviewItems(alice, aliceCase)).toBe(before.remaining);
        const ev = before.items.filter((i) => i.kind === "event");
        expect(ev.length).toBeGreaterThanOrEqual(2);
        await confirmEvent(alice, aliceCase, ev[0].id);
        const mid = await buildReviewQueue(alice, aliceCase);
        expect(mid.remaining).toBe(before.remaining - 1);
        await rejectEvent(alice, aliceCase, ev[1].id);
        const after = await buildReviewQueue(alice, aliceCase);
        expect(after.remaining).toBe(before.remaining - 2);
        expect(await countReviewItems(alice, aliceCase)).toBe(after.remaining);
        expect((await listConfirmedEvents(aliceCase)).some((e) => e.id === ev[0].id)).toBe(true);
    });

    it("recording an allegation keeps EMPLOYER_ALLEGATION provenance and opens it; withdrawing keeps the row", async () => {
        const q = await buildReviewQueue(alice, aliceCase);
        const [a1, a2] = q.items.filter((i) => i.kind === "allegation");
        const accepted = await acceptAllegation(alice, aliceCase, a1.id);
        expect(accepted.status).toBe("open");
        expect(accepted.provenance).toBe("EMPLOYER_ALLEGATION");
        const withdrawn = await withdrawAllegation(alice, aliceCase, a2.id);
        expect(withdrawn.status).toBe("withdrawn");
        const db = await getDb();
        expect(await db.select().from(allegations).where(eq(allegations.id, a2.id))).toHaveLength(1);
        const after = await buildReviewQueue(alice, aliceCase);
        expect(after.byKind.allegations).toBe(0);
        // Accepting again is a no-op; provenance untouched.
        expect((await acceptAllegation(alice, aliceCase, a1.id)).status).toBe("open");
    });

    it("confirming a fact from the queue follows the provenance rules (never silently)", async () => {
        const f = await proposeFact(aliceCase, { statement: "The hearing was scheduled for 3 March 2026.", provenance: "DOCUMENT_EXTRACTED", sourceDocumentId: docId });
        const row = await confirmFact(alice, aliceCase, f.id);
        expect(row.status).toBe("confirmed");
        expect(row.provenance).toBe("DOCUMENT_CONFIRMED");
    });
});

describe("isolation", () => {
    it("Bob's proposals never appear in Alice's queue, and foreign ids are NotFound", async () => {
        await uploadDocument(bob, bobCase, { filename: "bob.txt", mimeType: "text/plain", body: Buffer.from("Dear Bob, you were dismissed on 9 April 2026. It is alleged that you took a company laptop.") });
        const bobQ = await buildReviewQueue(bob, bobCase);
        expect(bobQ.remaining).toBeGreaterThan(0);
        const aliceQ = await buildReviewQueue(alice, aliceCase);
        const aliceIds = new Set(aliceQ.items.map((i) => i.id));
        for (const item of bobQ.items) expect(aliceIds.has(item.id)).toBe(false);
        expect(JSON.stringify(aliceQ)).not.toContain("company laptop");
        await expect(buildReviewQueue(alice, bobCase)).rejects.toMatchObject({ code: "not_found" });
        await expect(countReviewItems(alice, bobCase)).rejects.toMatchObject({ code: "not_found" });
        const bobEvent = bobQ.items.find((i) => i.kind === "event")!;
        await expect(acceptAllegation(alice, aliceCase, bobEvent.id)).rejects.toMatchObject({ code: "not_found" });
        await expect(adoptFact(alice, aliceCase, bobEvent.id)).rejects.toBeTruthy();
    });
});
