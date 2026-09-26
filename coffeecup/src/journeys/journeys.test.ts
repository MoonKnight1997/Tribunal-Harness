/**
 * Golden-path journeys A–E, run against the real service layer with the mock
 * model provider and an in-process Postgres. Each journey is the sequence a
 * worker would follow in the product; assertions check the record, the
 * deterministic outputs and the invariants (provenance, staleness, gating).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { closeDb } from "@/db/client";
import { signUp, signIn, validateSession } from "@/auth/service";
import { createCase, updateEmployment, getCase, updateCase, listCases } from "@/cases/service";
import { createCaseFromIntake, triage } from "@/intake/service";
import { buildDashboard, proposeSituationSummary, confirmSituationSummary } from "@/cases/dashboard";
import { uploadDocument, listDocuments } from "@/documents/service";
import { listProposedEvents, confirmEvent, updateEvent, rejectEvent, listConfirmedEvents, addEvent } from "@/timeline/service";
import { addFact, listFacts, confirmFact, correctFact, getStructuredFact, setStructuredFact, listConfirmedFacts } from "@/facts/service";
import { addIssue } from "@/issues/service";
import { startProcess, transitionProcess, updateProcessData, updateAllegation, listAllegations, addAppealGround } from "@/processes/service";
import { generateArtifact, getArtifact, listArtifacts, editArtifact } from "@/artifacts/service";
import { listDeadlines } from "@/legal/deadlines/case-deadlines";
import { identifyClaims, listClaimCandidates, listClaimElements } from "@/claims/service";
import { buildEt1ReadinessPack, saveEt1PackArtifact } from "@/et1/service";
import { buildCasePack, renderCasePackMarkdown } from "@/exports/service";
import { MockBackend } from "@/ai/providers/mock";
import { listTasks } from "@/tasks/service";
import { resourcesFor } from "@/resources/directory";

let user: { userId: string };
let email: string;

beforeAll(async () => {
    email = `worker-${Date.now()}@example.com`;
    const a = await signUp({ email, password: "a strong password", acceptedTerms: true, displayName: "Sam Worker" });
    user = { userId: a.user.id };
});

beforeEach(() => MockBackend.clearScripts());

afterAll(async () => {
    await closeDb();
});

describe("Journey A: problem → grievance → outcome → resolved", () => {
    it("runs end to end without any tribunal step", async () => {
        const t = await triage({ jurisdiction: "england_wales", entryRoute: "not_sure", description: "My manager keeps changing my shifts at the last minute and when I complained he shouted at me in front of everyone.", stillEmployed: true, employmentStatus: "employee" });
        expect(t.suggestedRoutes.map((r) => r.route)).toContain("contract_change");
        const { caseId } = await createCaseFromIntake(user, { jurisdiction: "england_wales", entryRoute: "grievance", description: "My manager keeps changing my shifts at the last minute.", stillEmployed: true, employmentStatus: "employee", employerName: "Northgate Foods Ltd", startDate: "2022-05-09", desiredOutcome: "Shifts agreed in advance and an apology." });
        let dash = await buildDashboard(user, caseId);
        expect(dash.case.stage).toBe("grievance");
        expect(dash.nav).not.toContain("claims");

        await addEvent(user, caseId, { date: "2026-06-02", title: "Rota changed with one day's notice", category: "communication" });
        await addEvent(user, caseId, { date: "2026-06-04", title: "Complained to manager; shouted at in front of the team", category: "incident" });
        await addFact(user, caseId, { statement: "My contract says shifts are agreed a fortnight in advance.", status: "confirmed" });

        const g = await startProcess(user, caseId, { type: "grievance", startedOn: "2026-06-05", data: { desiredResolution: "Shifts agreed in advance and an apology." } });
        await transitionProcess(user, caseId, g.id, "preparing_grievance");
        const letter = await generateArtifact(user, caseId, "grievance_letter", { processId: g.id });
        expect(letter.content).toMatch(/Rota changed/);
        expect(letter.content).toMatch(/Shifts agreed in advance/);
        await editArtifact(user, caseId, letter.id, { status: "final" });

        await transitionProcess(user, caseId, g.id, "grievance_submitted");
        await updateProcessData(user, caseId, g.id, { submittedDate: "2026-06-08" });
        await transitionProcess(user, caseId, g.id, "meeting_pending");
        const prep = await generateArtifact(user, caseId, "meeting_preparation", { processId: g.id });
        expect(prep.type).toBe("meeting_preparation");
        await transitionProcess(user, caseId, g.id, "meeting_completed");
        await transitionProcess(user, caseId, g.id, "outcome_pending");
        await transitionProcess(user, caseId, g.id, "outcome_received");
        await updateProcessData(user, caseId, g.id, { outcomeDate: "2026-06-25", employerResponseSummary: "Grievance upheld in part; rota policy to be followed." });
        await transitionProcess(user, caseId, g.id, "closed");
        await updateCase(user, caseId, { stage: "resolved", status: "resolved" });

        dash = await buildDashboard(user, caseId);
        expect(dash.case.stage).toBe("resolved");
        expect(dash.processes).toHaveLength(0); // closed processes are not "current"
        const summary = await proposeSituationSummary(user, caseId);
        expect(summary.summary).toMatch(/Northgate Foods Ltd/);
        await confirmSituationSummary(user, caseId, summary.summary);
        expect((await getCase(user, caseId)).situationSummary).toMatch(/Northgate/);
        const pack = await buildCasePack(user, caseId);
        expect(pack.processes[0].state).toBe("closed");
        expect(renderCasePackMarkdown(pack)).toMatch(/Grievance letter/);
    });
});

describe("Journey B: disciplinary → dismissal → appeal", () => {
    it("records allegations separately, prepares for the hearing, records dismissal and drafts an appeal", async () => {
        const c = await createCase(user, { entryRoute: "disciplinary" });
        await updateEmployment(user, c.id, { employerName: "Acme Ltd", employmentStatus: "employee", startDate: "2021-03-01" });
        const d = await startProcess(user, c.id, { type: "disciplinary", startedOn: "2026-02-10", initialState: "allegations" });

        const { document } = await uploadDocument(user, c.id, {
            filename: "invite.txt",
            mimeType: "text/plain",
            body: Buffer.from("Dear Sam, You are invited to attend a disciplinary hearing on 3 March 2026. The allegation: that you were absent without authorisation on 14 January 2026. It is alleged that you failed to follow the absence procedure."),
            processId: d.id,
        });
        expect(document.docType).toBe("disciplinary_invite");
        const proposedAllegations = await listAllegations(user, c.id, d.id);
        expect(proposedAllegations.length).toBeGreaterThanOrEqual(1);
        expect(proposedAllegations.every((a) => a.status === "proposed" && a.provenance === "EMPLOYER_ALLEGATION")).toBe(true);
        await updateAllegation(user, c.id, proposedAllegations[0].id, { workerResponse: "I texted my manager at 7am to say I was ill.", workerEvidence: "Screenshot of the text", missingInformation: "The attendance record they rely on" });

        for (const e of await listProposedEvents(user, c.id)) if (e.date === "2026-03-03") await confirmEvent(user, c.id, e.id); else await rejectEvent(user, c.id, e.id);
        await transitionProcess(user, c.id, d.id, "hearing_invitation");
        await transitionProcess(user, c.id, d.id, "preparation");
        const prep = await generateArtifact(user, c.id, "disciplinary_response", { processId: d.id });
        expect(prep.content).toMatch(/texted my manager/);
        expect(prep.content).toMatch(/attendance record/);

        await transitionProcess(user, c.id, d.id, "hearing");
        await transitionProcess(user, c.id, d.id, "outcome");
        await updateProcessData(user, c.id, d.id, { outcomeDate: "2026-03-10", outcome: "Summary dismissal for gross misconduct", outcomeSanction: "dismissal", appealWindowDays: 7 });
        await updateEmployment(user, c.id, { endDate: "2026-03-10", stillEmployed: false });
        await setStructuredFact(user, c.id, "dismissal_date", "2026-03-10", "I was dismissed on 10 March 2026.");

        const deadlines = await listDeadlines(user, c.id);
        expect(deadlines.find((x) => x.kind === "disciplinary_appeal_window")?.calculatedDate).toBe("2026-03-17");
        expect(deadlines.find((x) => x.kind === "et_time_limit:unfair_dismissal")?.calculatedDate).toBe("2026-06-09");

        const appeal = await startProcess(user, c.id, { type: "disciplinary_appeal", parentProcessId: d.id, startedOn: "2026-03-12" });
        await addAppealGround(user, c.id, appeal.id, { category: "procedural_issue", summary: "I was not given the attendance record before the hearing." });
        await addAppealGround(user, c.id, appeal.id, { category: "remedy_outcome_dispute", summary: "Dismissal was disproportionate for a first absence." });
        const appealDoc = await generateArtifact(user, c.id, "disciplinary_appeal", { processId: appeal.id });
        expect(appealDoc.content).toMatch(/attendance record before the hearing/);
        expect(appealDoc.content).toMatch(/disproportionate/);
        await transitionProcess(user, c.id, d.id, "appeal");
        expect((await buildDashboard(user, c.id)).important.some((i) => i.label.includes("appeal"))).toBe(true);
    });
});

describe("Journey C: dismissal → Acas → certificate → potential claims → ET1 pack", () => {
    it("moves from dismissal through Acas to a flag-gated claim analysis and an ET1 readiness pack", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const { caseId } = await createCaseFromIntake(user, { jurisdiction: "england_wales", entryRoute: "dismissal", description: "I was dismissed on 3 March 2026 after I raised a health and safety concern about the forklift.", stillEmployed: false, employmentStatus: "employee", employerName: "Acme Ltd", startDate: "2021-03-01", endDate: "2026-03-03" });
        await addIssue(user, caseId, { title: "Dismissal after raising safety concern", category: "whistleblowing", desiredResolution: "Compensation." });
        await addFact(user, caseId, { statement: "On 20 February 2026 I emailed my manager about the forklift brakes not working.", status: "confirmed" });
        await addFact(user, caseId, { statement: "No hearing was held before I was dismissed.", status: "confirmed" });

        let dl = await listDeadlines(user, caseId);
        expect(dl.find((d) => d.kind === "et_time_limit:unfair_dismissal")?.calculatedDate).toBe("2026-06-02");
        expect(dl.find((d) => d.kind === "et_time_limit:whistleblowing_detriment")).toBeDefined();

        const acas = await startProcess(user, caseId, { type: "acas_early_conciliation", startedOn: "2026-04-01" });
        await transitionProcess(user, caseId, acas.id, "notified");
        await updateProcessData(user, caseId, acas.id, { notificationDate: "2026-04-01", reference: "R123456/26/01", preparation: { keyIssues: ["Dismissed after raising safety concern"], stepsTaken: ["Appealed internally"], desiredResolution: "Compensation", moneyIssues: "Three months' lost pay" } });
        const acasPrep = await generateArtifact(user, caseId, "acas_preparation", { processId: acas.id });
        expect(acasPrep.type).toBe("acas_preparation");
        await transitionProcess(user, caseId, acas.id, "certificate_issued");
        await updateProcessData(user, caseId, acas.id, { certificateIssueDate: "2026-04-29", certificateNumber: "R123456/26/01", certificateStatus: "issued" });
        dl = await listDeadlines(user, caseId);
        expect(dl.find((d) => d.kind === "et_time_limit:unfair_dismissal")?.calculatedDate).toBe("2026-06-30");

        await updateCase(user, caseId, { stage: "considering_tribunal" });
        const candidates = await identifyClaims(user, caseId);
        const types = candidates.map((c) => c.claimType);
        expect(types).toEqual(expect.arrayContaining(["unfair_dismissal", "whistleblowing", "wrongful_dismissal"]));
        const wb = candidates.find((c) => c.claimType === "whistleblowing")!;
        expect(wb.acasStatus).toBe("certificate_issued");
        expect(wb.timeLimit?.calculatedDate).toBe("2026-06-30");
        const els = await listClaimElements(user, caseId, wb.id);
        expect(els.find((e) => e.elementKey === "worker_status")?.status).toBe("supported");
        expect(els.every((e) => !/\d+%/.test(e.reasoning))).toBe(true);

        await updateCase(user, caseId, { stage: "et1_preparation" });
        const pack = await buildEt1ReadinessPack(user, caseId, { userEmail: email, userName: "Sam Worker" });
        expect(pack.claimCategories.data.map((c) => c.claimType)).toContain("whistleblowing");
        expect(pack.acas.data.certificateNumber).toBe("R123456/26/01");
        expect(pack.acas.missing).toHaveLength(0);
        expect(pack.timeLimits.data[0].date).toBe("2026-06-30");
        expect(pack.missingRequired.join(" ")).toMatch(/legal name/);
        const saved = await saveEt1PackArtifact(user, caseId, pack);
        expect(saved.content).toMatch(/Where to file/);
        expect(saved.content).toMatch(/does not submit/);
        const help = resourcesFor({ jurisdiction: "england_wales", tags: ["et1_preparation"] });
        expect(help.some((r) => r.id === "fru")).toBe(true);
    });
});

describe("Journey D: already has Acas certificate → imports existing history → ET1 pack", () => {
    it("starts at the certificate stage, imports documents and history, and builds the pack", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const { caseId } = await createCaseFromIntake(user, { jurisdiction: "scotland", entryRoute: "acas_certificate_received", description: "I have my Acas certificate after being made redundant while on maternity leave.", stillEmployed: false, employmentStatus: "employee", employerName: "Highland Retail Ltd", startDate: "2019-09-02", endDate: "2026-02-27", acasNotified: true, acasNotificationDate: "2026-03-20", acasCertificateDate: "2026-04-17", acasCertificateNumber: "R777/26/02" });
        const dash = await buildDashboard(user, caseId);
        expect(dash.case.stage).toBe("acas_early_conciliation");
        expect(dash.processes[0].state).toBe("certificate_issued");
        // 27 Feb + 3m less 1 day = 26 May; +28 days paused = 23 Jun; 1 month from Day B = 17 May → 23 Jun.
        expect(dash.important.find((i) => i.label === "Unfair dismissal claim")?.date).toBe("2026-06-23");

        await addIssue(user, caseId, { title: "Selected for redundancy while on maternity leave", category: "discrimination", desiredResolution: "Compensation and a reference." });
        const { document } = await uploadDocument(user, caseId, { filename: "redundancy-letter.txt", mimeType: "text/plain", body: Buffer.from("Dear Jo, Following the consultation meeting on 2 February 2026 we confirm that your role is redundant with effect from 27 February 2026.") });
        expect(document.extractionStatus).toBe("completed");
        for (const e of await listProposedEvents(user, caseId)) await confirmEvent(user, caseId, e.id);
        const events = await listConfirmedEvents(caseId);
        expect(events.map((e) => e.date)).toEqual(expect.arrayContaining(["2026-02-02", "2026-02-27"]));
        await addFact(user, caseId, { statement: "I was on maternity leave from 1 November 2025 and was the only person in my team selected for redundancy.", status: "confirmed" });

        const candidates = await identifyClaims(user, caseId);
        expect(candidates.map((c) => c.claimType)).toEqual(expect.arrayContaining(["unfair_dismissal", "direct_discrimination"]));
        // Breach of contract claims are available in Scottish tribunals too (SI 1994/1624).
        expect(candidates.map((c) => c.claimType)).toContain("wrongful_dismissal");
        expect(candidates.find((c) => c.claimType === "wrongful_dismissal")?.sources.some((s) => s.reference === "SI 1994/1624 art 7")).toBe(true);

        const pack = await buildEt1ReadinessPack(user, caseId);
        expect(pack.jurisdiction).toBe("scotland");
        expect(pack.chronology.data.length).toBeGreaterThanOrEqual(2);
        expect(pack.documents.data[0].filename).toBe("redundancy-letter.txt");
        expect(pack.claimCategories.data.some((c) => c.claimType === "direct_discrimination")).toBe(true);
    });
});

describe("Journey E: multiple documents → extraction errors → user corrects facts → downstream analysis updates", () => {
    it("recovers from extraction failures, lets the user fix a wrong date, and invalidates dependent outputs", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await createCase(user, { entryRoute: "dismissal" });
        await updateEmployment(user, c.id, { employerName: "Acme Ltd", employmentStatus: "employee", startDate: "2020-01-06", stillEmployed: false });

        // Doc 1: fine. Doc 2: model produces malformed output twice. Doc 3: image.
        const d1 = await uploadDocument(user, c.id, { filename: "dismissal-letter.txt", mimeType: "text/plain", body: Buffer.from("Dear Alex, this letter confirms you were dismissed on 3 March 2026 for gross misconduct.") });
        MockBackend.scriptResponse("extract_document_v1", "{ nonsense");
        MockBackend.scriptResponse("extract_document_v1", "{ \"events\": 12 }");
        const d2 = await uploadDocument(user, c.id, { filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("Meeting 20 February 2026 with HR about the allegation.") });
        const d3 = await uploadDocument(user, c.id, { filename: "photo.png", mimeType: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
        expect(d1.document.extractionStatus).toBe("completed");
        expect(d2.document.extractionStatus).toBe("requires_review");
        expect(d2.document.extractedText).toMatch(/Meeting 20 February 2026/);
        expect(d3.document.extractionStatus).toBe("unsupported");
        expect(d3.document.docType).toBe("photo");

        // The extracted dismissal date is only a proposal; the user confirms it.
        const proposed = (await listFacts(user, c.id, { status: "proposed" })).find((f) => f.key === "dismissal_date")!;
        expect(proposed.value).toBe("2026-03-03");
        await confirmFact(user, c.id, proposed.id);
        for (const e of await listProposedEvents(user, c.id)) await confirmEvent(user, c.id, e.id);

        let candidates = await identifyClaims(user, c.id);
        const ud = candidates.find((x) => x.claimType === "unfair_dismissal")!;
        expect(ud.timeLimit?.calculatedDate).toBe("2026-06-02");
        const chron = await generateArtifact(user, c.id, "chronology");
        expect(chron.content).toMatch(/3 March 2026/);

        // The letter's date was wrong: the real dismissal was 10 March. Correct it.
        const current = (await getStructuredFact(c.id, "dismissal_date"))!;
        const corrected = await correctFact(user, c.id, current.id, { value: "2026-03-10", statement: "I was actually dismissed on 10 March 2026 (the letter was misdated)." });
        expect(corrected.provenance).toBe("USER_CONFIRMED");
        expect((await listConfirmedFacts(c.id)).some((f) => f.id === current.id)).toBe(false);

        // Everything downstream is marked stale, and re-running uses the corrected date.
        candidates = await listClaimCandidates(user, c.id);
        expect(candidates.every((x) => x.stale)).toBe(true);
        expect((await getArtifact(user, c.id, chron.id)).stale).toBe(true);
        const dl = await listDeadlines(user, c.id);
        expect(dl.find((d) => d.kind === "et_time_limit:unfair_dismissal")?.calculatedDate).toBe("2026-06-09");
        candidates = await identifyClaims(user, c.id);
        expect(candidates.find((x) => x.claimType === "unfair_dismissal")?.timeLimit?.calculatedDate).toBe("2026-06-09");
        expect(candidates.every((x) => !x.stale)).toBe(true);

        // Event date correction also propagates.
        const ev = (await listConfirmedEvents(c.id))[0];
        await updateEvent(user, c.id, ev.id, { date: "2026-03-10", dateApproximate: false });
        expect((await listArtifacts(user, c.id)).every((a) => a.stale)).toBe(true);
        expect((await listDocuments(user, c.id)).length).toBe(3);
        expect((await listTasks(user, c.id)).some((t) => t.kind === "deadline")).toBe(true);
    });
});

describe("Persistence across sessions", () => {
    it("keeps everything after signing out and back in", async () => {
        const before = await listCases(user);
        const again = await signIn({ email, password: "a strong password" });
        expect((await validateSession(again.session.token))?.id).toBe(user.userId);
        const after = await listCases({ userId: again.user.id });
        expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
    });
});
