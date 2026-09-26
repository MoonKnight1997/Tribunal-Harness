import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import { createCase } from "@/cases/service";
import { uploadDocument, listDocuments, getDocumentBytes, updateDocument, reprocessDocument, deleteDocument } from "./service";
import { listProposedEvents, confirmEvent, updateEvent, rejectEvent, listConfirmedEvents, addEvent, mergeEvents, listEvents } from "@/timeline/service";
import { listFacts, confirmFact, correctFact, listConfirmedFacts, getStructuredFact } from "@/facts/service";
import { MockBackend } from "@/ai/providers/mock";
import { getJob } from "@/jobs/service";
import { extractText, parseEml } from "./extract";

let alice: { userId: string };
let bob: { userId: string };
let caseId: string;

const LETTER = `Dear Ms Patel,

I am writing further to the investigation meeting held on 12 February 2026. You were suspended on 20 January 2026 pending investigation.

You are invited to attend a disciplinary hearing on 3 March 2026 at 10am. The allegation: that you were absent without authorisation on 14 January 2026.

Yours sincerely,
HR Department`;

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    const b = await signUp({ email: "bob@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
    bob = { userId: b.user.id };
    const c = await createCase(alice, { entryRoute: "disciplinary" });
    caseId = c.id;
});

beforeEach(() => MockBackend.clearScripts());

afterAll(async () => {
    await closeDb();
});

describe("extraction helpers", () => {
    it("parses .eml headers and body", () => {
        const text = parseEml("From: hr@acme.example\nTo: worker@example.com\nSubject: Hearing\nDate: 1 Mar 2026\n\nPlease attend on 3 March 2026.");
        expect(text).toMatch(/^From: hr@acme.example/);
        expect(text).toMatch(/Please attend/);
    });

    it("keeps images as attachments without pretending to read them", async () => {
        const res = await extractText("image", Buffer.from("not really an image"));
        expect(res.status).toBe("unsupported");
    });

    it("reports a scanned/empty PDF as requiring review rather than failing", async () => {
        const res = await extractText("pdf", Buffer.from("%PDF-1.4\n%%EOF"));
        expect(["requires_review", "failed"]).toContain(res.status);
    });
});

describe("document upload and review queue", () => {
    it("stores the original, extracts text and proposes events for review (never confirmed)", async () => {
        const { document, jobId } = await uploadDocument(alice, caseId, { filename: "hearing-invite.txt", mimeType: "text/plain", body: Buffer.from(LETTER) });
        expect(document.extractionStatus).toBe("completed");
        expect(document.extractedText).toMatch(/disciplinary hearing/);
        expect(document.docType).toBe("disciplinary_invite");
        expect(document.sha256).toHaveLength(64);
        const job = await getJob(jobId!);
        expect(job?.status).toBe("completed");

        const proposed = await listProposedEvents(alice, caseId);
        expect(proposed.length).toBeGreaterThanOrEqual(3);
        expect(proposed.every((e) => e.status === "proposed" && e.userConfirmed === false && e.provenance === "DOCUMENT_EXTRACTED")).toBe(true);
        expect(await listConfirmedEvents(caseId)).toHaveLength(0);
        expect(proposed.map((e) => e.date)).toContain("2026-03-03");

        const { body } = await getDocumentBytes(alice, caseId, document.id);
        expect(body.toString()).toBe(LETTER);
    });

    it("lets the user confirm, correct and reject proposals; corrections update provenance", async () => {
        const proposed = await listProposedEvents(alice, caseId);
        const hearing = proposed.find((e) => e.date === "2026-03-03")!;
        const suspension = proposed.find((e) => e.date === "2026-01-20")!;
        const other = proposed.find((e) => e.id !== hearing.id && e.id !== suspension.id)!;

        const confirmed = await confirmEvent(alice, caseId, hearing.id);
        expect(confirmed.status).toBe("confirmed");
        expect(confirmed.provenance).toBe("DOCUMENT_CONFIRMED");

        const corrected = await updateEvent(alice, caseId, suspension.id, { date: "2026-01-21", title: "Suspended pending investigation" });
        expect(corrected.date).toBe("2026-01-21");
        expect(corrected.status).toBe("confirmed");
        expect(corrected.provenance).toBe("DOCUMENT_CONFIRMED");

        await rejectEvent(alice, caseId, other.id);
        const chronology = await listConfirmedEvents(caseId);
        expect(chronology.map((e) => e.id)).toEqual(expect.arrayContaining([hearing.id, suspension.id]));
        expect(chronology.map((e) => e.id)).not.toContain(other.id);
    });

    it("merges duplicate events keeping one and folding document links", async () => {
        const a = await addEvent(alice, caseId, { date: "2026-02-12", title: "Investigation meeting", category: "meeting" });
        const b = await addEvent(alice, caseId, { date: "2026-02-12", title: "Investigation meeting (from letter)", category: "meeting", description: "Held with HR." });
        const merged = await mergeEvents(alice, caseId, a.id, [b.id]);
        expect(merged.description).toMatch(/Held with HR/);
        const all = await listEvents(alice, caseId);
        expect(all.find((e) => e.id === b.id)?.mergedIntoId).toBe(a.id);
        expect((await listConfirmedEvents(caseId)).map((e) => e.id)).not.toContain(b.id);
    });

    it("keeps extracted text but marks the document for review when the proposal step fails", async () => {
        // A backend failure is not retried by the structured guard (only malformed output is).
        MockBackend.scriptResponse("extract_document_v1", new Error("provider down"));
        const { document } = await uploadDocument(alice, caseId, { filename: "note.txt", mimeType: "text/plain", body: Buffer.from("Meeting on 5 March 2026 with my manager.") });
        expect(document.extractionStatus).toBe("requires_review");
        expect(document.extractedText).toMatch(/Meeting on 5 March 2026/);
        expect(document.extractionError).toMatch(/retry/);
        // Self-service retry succeeds once the provider is back.
        await reprocessDocument(alice, caseId, document.id);
        const docs = await listDocuments(alice, caseId);
        expect(docs.find((d) => d.id === document.id)?.extractionStatus).toBe("completed");
    });

    it("discards malformed model output instead of inserting garbage proposals", async () => {
        MockBackend.scriptResponse("extract_document_v1", "{\"events\": \"nope\", \"summary\": 5}");
        MockBackend.scriptResponse("extract_document_v1", "still not right");
        const before = (await listProposedEvents(alice, caseId)).length;
        const { document } = await uploadDocument(alice, caseId, { filename: "bad.txt", mimeType: "text/plain", body: Buffer.from("On 9 March 2026 something happened.") });
        expect(document.extractionStatus).toBe("requires_review");
        expect((await listProposedEvents(alice, caseId)).length).toBe(before);
    });

    it("allows the user to reclassify a document and fix its date", async () => {
        const docs = await listDocuments(alice, caseId);
        const updated = await updateDocument(alice, caseId, docs[0].id, { docType: "letter", docDate: "2026-02-20" });
        expect(updated.docType).toBe("letter");
        expect(updated.docTypeConfirmed).toBe(true);
        expect(updated.docDate).toBe("2026-02-20");
    });

    it("rejects unsupported and oversized uploads", async () => {
        await expect(uploadDocument(alice, caseId, { filename: "virus.exe", mimeType: "application/x-msdownload", body: Buffer.from("x") })).rejects.toThrow(/not supported/);
        await expect(uploadDocument(alice, caseId, { filename: "big.txt", mimeType: "text/plain", body: Buffer.alloc(11 * 1024 * 1024) })).rejects.toThrow(/10 MB/);
    });

    it("isolates documents between tenants", async () => {
        const docs = await listDocuments(alice, caseId);
        await expect(listDocuments(bob, caseId)).rejects.toThrow(/not found/i);
        await expect(getDocumentBytes(bob, caseId, docs[0].id)).rejects.toThrow(/not found/i);
        await expect(deleteDocument(bob, caseId, docs[0].id)).rejects.toThrow(/not found/i);
    });
});

describe("facts and provenance", () => {
    it("proposed facts from documents become DOCUMENT_CONFIRMED only when the user confirms", async () => {
        const { document } = await uploadDocument(alice, caseId, {
            filename: "dismissal.txt",
            mimeType: "text/plain",
            body: Buffer.from("Dear Ms Patel, this letter confirms that you were dismissed on 3 March 2026 for gross misconduct."),
        });
        expect(document.extractionStatus).toBe("completed");
        const proposed = (await listFacts(alice, caseId, { status: "proposed" })).filter((f) => f.key === "dismissal_date");
        expect(proposed.length).toBeGreaterThan(0);
        expect(proposed[0].provenance).toBe("DOCUMENT_EXTRACTED");
        expect(await getStructuredFact(caseId, "dismissal_date")).toBeNull();

        const confirmed = await confirmFact(alice, caseId, proposed[0].id);
        expect(confirmed.provenance).toBe("DOCUMENT_CONFIRMED");
        expect((await getStructuredFact(caseId, "dismissal_date"))?.value).toBe("2026-03-03");
    });

    it("correcting a fact supersedes the old one and keeps the audit trail", async () => {
        const current = (await getStructuredFact(caseId, "dismissal_date"))!;
        const corrected = await correctFact(alice, caseId, current.id, { value: "2026-03-04", statement: "I was dismissed on 4 March 2026." });
        expect(corrected.provenance).toBe("USER_CONFIRMED");
        expect(corrected.value).toBe("2026-03-04");
        const all = await listFacts(alice, caseId);
        expect(all.find((f) => f.id === current.id)?.status).toBe("superseded");
        expect(all.find((f) => f.id === current.id)?.supersededById).toBe(corrected.id);
        expect((await listConfirmedFacts(caseId)).map((f) => f.id)).not.toContain(current.id);
        await expect(correctFact(alice, caseId, corrected.id, { value: "not a date" })).rejects.toThrow(/valid date/);
    });
});
