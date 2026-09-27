import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import { createCase, addPerson } from "@/cases/service";
import { addEvent } from "@/timeline/service";
import { addFact } from "@/facts/service";
import { addIssue } from "@/issues/service";
import { startProcess, addAllegation } from "@/processes/service";
import { uploadDocument, deleteDocument } from "@/documents/service";
import { ValidationError } from "@/lib/errors";
import { assertCaseOwns, FOREIGN_REFERENCE_MESSAGE } from "./references";

let alice: { userId: string };
let bob: { userId: string };
let aliceCase: string;
let bobCase: string;

const mine: Record<string, string> = {};
const theirs: Record<string, string> = {};

async function seed(actor: { userId: string }, caseId: string, out: Record<string, string>) {
    out.document = (await uploadDocument(actor, caseId, { filename: "note.txt", mimeType: "text/plain", body: Buffer.from("A short note about a meeting on 2 February 2026.") })).document.id;
    out.event = (await addEvent(actor, caseId, { date: "2026-02-02", title: "Meeting" })).id;
    out.fact = (await addFact(actor, caseId, { statement: "I attended the meeting." })).id;
    out.person = (await addPerson(actor, caseId, { name: "Sam Manager", role: "manager" })).id;
    out.process = (await startProcess(actor, caseId, { type: "disciplinary" })).id;
    out.issue = (await addIssue(actor, caseId, { title: "Unfair treatment" })).id;
    out.allegation = (await addAllegation(actor, caseId, out.process, { employerAllegation: "Absent without authorisation" })).id;
}

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    const b = await signUp({ email: "bob@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
    bob = { userId: b.user.id };
    aliceCase = (await createCase(alice, { entryRoute: "disciplinary" })).id;
    bobCase = (await createCase(bob, { entryRoute: "disciplinary" })).id;
    await seed(alice, aliceCase, mine);
    await seed(bob, bobCase, theirs);
});

afterAll(async () => {
    await closeDb();
});

describe("assertCaseOwns", () => {
    it("accepts ids that belong to the case, ignores empty entries and de-duplicates", async () => {
        await expect(
            assertCaseOwns(aliceCase, {
                documentIds: [mine.document, mine.document, null, undefined, ""],
                eventIds: [mine.event],
                factIds: [mine.fact],
                personIds: [mine.person],
                processIds: [mine.process],
                issueIds: [mine.issue],
                allegationIds: [mine.allegation],
            }),
        ).resolves.toBeUndefined();
        await expect(assertCaseOwns(aliceCase, {})).resolves.toBeUndefined();
        await expect(assertCaseOwns(aliceCase, { documentIds: [], eventIds: [null] })).resolves.toBeUndefined();
    });

    it("rejects an id from another user's case with a 400 that does not say which id failed", async () => {
        for (const [kind, id] of Object.entries(theirs)) {
            const key = `${kind}Ids` as keyof Parameters<typeof assertCaseOwns>[1];
            const err = await assertCaseOwns(aliceCase, { [key]: [id] }).catch((e: unknown) => e);
            expect(err, kind).toBeInstanceOf(ValidationError);
            expect((err as ValidationError).status).toBe(400);
            expect((err as ValidationError).message).toBe(FOREIGN_REFERENCE_MESSAGE);
            expect((err as ValidationError).message).not.toContain(id);
        }
    });

    it("rejects a mixed list where only one id is foreign, and unknown ids", async () => {
        await expect(assertCaseOwns(aliceCase, { documentIds: [mine.document, theirs.document] })).rejects.toBeInstanceOf(ValidationError);
        await expect(assertCaseOwns(aliceCase, { eventIds: [mine.event, "does-not-exist"] })).rejects.toBeInstanceOf(ValidationError);
    });

    it("gives the same error for a foreign id as for a random id", async () => {
        const foreign = await assertCaseOwns(aliceCase, { processIds: [theirs.process] }).catch((e: Error) => e.message);
        const random = await assertCaseOwns(aliceCase, { processIds: ["00000000-0000-4000-8000-000000000000"] }).catch((e: Error) => e.message);
        expect(foreign).toBe(random);
    });

    it("treats a soft-deleted document as not found", async () => {
        const doc = (await uploadDocument(alice, aliceCase, { filename: "old.txt", mimeType: "text/plain", body: Buffer.from("Old note.") })).document.id;
        await expect(assertCaseOwns(aliceCase, { documentIds: [doc] })).resolves.toBeUndefined();
        await deleteDocument(alice, aliceCase, doc);
        await expect(assertCaseOwns(aliceCase, { documentIds: [doc] })).rejects.toBeInstanceOf(ValidationError);
    });
});
