import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import { createCase, updateEmployment } from "@/cases/service";
import { startProcess, transitionProcess, updateProcessData, addAllegation, listAllegations, updateAllegation, addAppealGround, listAppealGrounds, listTransitions } from "./service";
import { acasCodeForDate } from "@/legal/rules/acas-code";
import { computeCaseDeadlines, listDeadlines } from "@/legal/deadlines/case-deadlines";
import { generateArtifact, editArtifact, listArtifacts, getArtifact } from "@/artifacts/service";
import { addEvent } from "@/timeline/service";
import { addFact, listConfirmedFacts, getStructuredFact, setStructuredFact } from "@/facts/service";
import { addIssue } from "@/issues/service";
import { listTasks } from "@/tasks/service";

let alice: { userId: string };

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
});

afterAll(async () => {
    await closeDb();
});

describe("grievance workflow", () => {
    it("moves through the state machine and rejects invalid transitions", async () => {
        const c = await createCase(alice, { entryRoute: "grievance" });
        const p = await startProcess(alice, c.id, { type: "grievance", startedOn: "2026-02-01" });
        expect(p.state).toBe("considering");
        expect(p.acasCodeVersion).toBe("acas_code_2015");
        await expect(transitionProcess(alice, c.id, p.id, "outcome_received")).rejects.toThrow(/cannot move/);
        let cur = await transitionProcess(alice, c.id, p.id, "preparing_grievance");
        cur = await transitionProcess(alice, c.id, cur.id, "grievance_submitted");
        cur = await transitionProcess(alice, c.id, cur.id, "meeting_pending");
        cur = await transitionProcess(alice, c.id, cur.id, "meeting_completed");
        cur = await transitionProcess(alice, c.id, cur.id, "outcome_pending");
        cur = await transitionProcess(alice, c.id, cur.id, "outcome_received");
        expect(cur.state).toBe("outcome_received");
        const history = await listTransitions(alice, c.id, p.id);
        expect(history.map((t) => t.toState)).toEqual(["considering", "preparing_grievance", "grievance_submitted", "meeting_pending", "meeting_completed", "outcome_pending", "outcome_received"]);
    });

    it("applies the Acas Code in force when the process started, never a draft", () => {
        expect(acasCodeForDate("2026-02-01").id).toBe("acas_code_2015");
        expect(acasCodeForDate("2015-03-11").id).toBe("acas_code_2015");
    });

    it("drafts a grievance letter from confirmed material only and keeps wording separate from facts", async () => {
        const c = await createCase(alice, { entryRoute: "grievance" });
        await updateEmployment(alice, c.id, { employerName: "Acme Ltd", jobTitle: "Warehouse operative" });
        await addIssue(alice, c.id, { title: "Shift changes without notice", category: "contract_change", desiredResolution: "Return to my contracted shifts." });
        await addEvent(alice, c.id, { date: "2026-01-10", title: "Told my shifts were changing from next week", category: "communication" });
        await addFact(alice, c.id, { statement: "My contract says my hours are Monday to Friday, 9 to 5.", status: "confirmed" });
        const p = await startProcess(alice, c.id, { type: "grievance", startedOn: "2026-01-20", data: { desiredResolution: "Return to my contracted shifts." } });

        const letter = await generateArtifact(alice, c.id, "grievance_letter", { processId: p.id });
        expect(letter.content).toMatch(/Shift changes without notice/);
        expect(letter.content).toMatch(/2026-01-10/);
        expect(letter.content).toMatch(/Return to my contracted shifts/);
        expect(letter.content).toMatch(/legal information/i);
        expect(letter.basis.eventIds).toHaveLength(1);

        const edited = await editArtifact(alice, c.id, letter.id, { content: letter.content + "\n\nI have also been shouted at." });
        expect(edited.content).toMatch(/shouted at/);
        // Editing the wording did not create a fact.
        expect((await listConfirmedFacts(c.id)).some((f) => /shouted/.test(f.statement))).toBe(false);

        // Changing a fact marks the artifact stale for regeneration.
        await addFact(alice, c.id, { statement: "I was not consulted about the change.", status: "confirmed" });
        const after = await getArtifact(alice, c.id, letter.id);
        expect(after.stale).toBe(true);
        expect((await listArtifacts(alice, c.id)).length).toBe(1);
    });
});

describe("disciplinary workflow", () => {
    it("records each allegation separately with response, evidence and gaps", async () => {
        const c = await createCase(alice, { entryRoute: "disciplinary" });
        const p = await startProcess(alice, c.id, { type: "disciplinary", startedOn: "2026-02-10", initialState: "hearing_invitation" });
        const a1 = await addAllegation(alice, c.id, p.id, { employerAllegation: "Absent without authorisation on 14 January 2026", employerEvidence: "Attendance record" });
        const a2 = await addAllegation(alice, c.id, p.id, { employerAllegation: "Rude to a customer on 2 February 2026" });
        expect(a1.provenance).toBe("USER_ALLEGATION");
        await updateAllegation(alice, c.id, a1.id, { workerResponse: "I had told my manager by text that I was ill.", workerEvidence: "Text message 14 Jan", missingInformation: "Copy of the attendance record", hearingQuestions: ["Who authorised absences that week?"] });
        const list = await listAllegations(alice, c.id, p.id);
        expect(list).toHaveLength(2);
        expect(list.find((a) => a.id === a2.id)?.workerResponse).toBeNull();

        const prep = await generateArtifact(alice, c.id, "disciplinary_response", { processId: p.id });
        expect(prep.content).toMatch(/Absent without authorisation/);
        expect(prep.content).toMatch(/told my manager by text/);
        expect(prep.content).toMatch(/Copy of the attendance record/);
        // The second allegation's response is shown as not yet recorded, not invented.
        expect(prep.content).toMatch(/not yet recorded/);
    });

    it("supports appeal grounds by category and drafts an appeal from selected grounds", async () => {
        const c = await createCase(alice, { entryRoute: "appeal" });
        const disc = await startProcess(alice, c.id, { type: "disciplinary", startedOn: "2026-02-10", initialState: "outcome", data: { outcomeDate: "2026-03-10", appealWindowDays: 5 } });
        const appeal = await startProcess(alice, c.id, { type: "disciplinary_appeal", parentProcessId: disc.id, startedOn: "2026-03-11" });
        await addAppealGround(alice, c.id, appeal.id, { category: "procedural_issue", summary: "I was not shown the attendance record before the hearing." });
        await addAppealGround(alice, c.id, appeal.id, { category: "new_evidence", summary: "My GP letter confirms I was unwell.", selected: false });
        const grounds = await listAppealGrounds(alice, c.id, appeal.id);
        expect(grounds).toHaveLength(2);
        const doc = await generateArtifact(alice, c.id, "disciplinary_appeal", { processId: appeal.id });
        expect(doc.content).toMatch(/not shown the attendance record/);
        expect(doc.content).not.toMatch(/GP letter/);

        // Employer-policy appeal window is calculated only from what the user entered.
        const dl = await computeCaseDeadlines(alice, c.id);
        const win = dl.find((d) => d.kind === "disciplinary_appeal_window")!;
        expect(win.calculatedDate).toBe("2026-03-15");
        expect(win.explanation.source.version).toBe("user-entered");
    });
});

describe("Acas workspace and deadlines", () => {
    it("stores Acas data, mirrors dates into facts and updates the limitation deadline deterministically", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await updateEmployment(alice, c.id, { employerName: "Acme Ltd", startDate: "2021-03-01", endDate: "2026-03-03", stillEmployed: false });
        await setStructuredFact(alice, c.id, "dismissal_date", "2026-03-03", "I was dismissed on 3 March 2026.");

        let dl = await listDeadlines(alice, c.id);
        const ud = dl.find((d) => d.kind === "et_time_limit:unfair_dismissal")!;
        expect(ud.calculatedDate).toBe("2026-06-02");
        expect(ud.explanation.acasEffect).toBeNull();

        const acas = await startProcess(alice, c.id, { type: "acas_early_conciliation", startedOn: "2026-04-01" });
        await updateProcessData(alice, c.id, acas.id, { notificationDate: "2026-04-01", reference: "R123456/26/01" });
        expect((await getStructuredFact(c.id, "acas_day_a"))?.value).toBe("2026-04-01");
        dl = await listDeadlines(alice, c.id);
        expect(dl.find((d) => d.kind === "et_time_limit:unfair_dismissal")!.explanation.missingInformation).toContain("Acas certificate date (Day B).");

        await updateProcessData(alice, c.id, acas.id, { certificateIssueDate: "2026-04-29", certificateNumber: "R123456/26/01", certificateStatus: "issued" });
        dl = await listDeadlines(alice, c.id);
        const after = dl.find((d) => d.kind === "et_time_limit:unfair_dismissal")!;
        // 2 Jun + 28 days paused = 30 Jun; one month from Day B = 29 May → later wins.
        expect(after.calculatedDate).toBe("2026-06-30");
        expect(after.explanation.acasEffect).toMatch(/28 days/);
        expect(after.explanation.source.reference).toBe("ERA 1996 s111(2)");

        await expect(updateProcessData(alice, c.id, acas.id, { certificateIssueDate: "next week" })).rejects.toThrow(/YYYY-MM-DD/);

        const tasks = await listTasks(alice, c.id);
        expect(tasks.some((t) => t.kind === "deadline" && t.dueDate === "2026-06-30")).toBe(true);
    });

    it("asks for the missing date instead of inventing a deadline", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        const dl = await listDeadlines(alice, c.id);
        const ud = dl.find((d) => d.kind === "et_time_limit:unfair_dismissal")!;
        expect(ud.calculatedDate).toBeNull();
        expect(ud.status).toBe("uncertain");
        const tasks = await listTasks(alice, c.id);
        expect(tasks.some((t) => t.systemKey === "deadline:missing_trigger")).toBe(true);
    });
});
