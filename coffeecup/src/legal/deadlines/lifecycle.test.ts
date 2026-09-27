/**
 * Deadline lifecycle at the service level (PGlite): triggers are never
 * substituted, corrections recompute, Acas pending/receipt semantics hold,
 * precision survives intake → storage → calculation → dashboard → exports,
 * and expiry is derived from "today" rather than stored.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import { createCase, updateEmployment } from "@/cases/service";
import { addFact, confirmFact, correctFact, getStructuredFactState, listConfirmedFacts, proposeFact, setStructuredFact } from "@/facts/service";
import { startProcess, updateProcessData } from "@/processes/service";
import { listTasks } from "@/tasks/service";
import { buildDashboard } from "@/cases/dashboard";
import { buildCasePack, renderCasePackMarkdown } from "@/exports/service";
import { buildEt1ReadinessPack, renderEt1Pack } from "@/et1/service";
import { createCaseFromIntake, triage } from "@/intake/service";
import { computeCaseDeadlines, listDeadlines, presentDeadline, type DeadlineRow } from "./case-deadlines";
import { ValidationError, NotFoundError } from "@/lib/errors";

let alice: { userId: string };
let bob: { userId: string };

beforeAll(async () => {
    alice = { userId: (await signUp({ email: "alice-deadlines@example.com", password: "a strong password", acceptedTerms: true })).user.id };
    bob = { userId: (await signUp({ email: "bob-deadlines@example.com", password: "a strong password", acceptedTerms: true })).user.id };
});

afterAll(async () => {
    await closeDb();
});

const TODAY = "2026-09-27";
const kind = (rows: DeadlineRow[], k: string) => rows.find((r) => r.kind === k)!;

describe("triggers are never substituted (F04)", () => {
    it("discrimination with only an employment end date is uncertain with guidance, not a calculated date", async () => {
        const c = await createCase(alice, { entryRoute: "discrimination" });
        await updateEmployment(alice, c.id, { endDate: "2026-09-01", stillEmployed: false });
        const dl = await listDeadlines(alice, c.id, { today: TODAY });
        const disc = kind(dl, "et_time_limit:discrimination");
        expect(disc.status).toBe("uncertain");
        expect(disc.calculatedDate).toBeNull();
        expect(disc.explanation.missingInformation[0]).toMatch(/date of the last act.*record the dismissal date as the last act on My case/);
        // The dismissal-based family still calculates from the end date, and records where the trigger came from.
        const ud = kind(dl, "et_time_limit:unfair_dismissal");
        expect(ud.calculatedDate).toBe("2026-11-30");
        expect(ud.explanation.trigger).toMatchObject({ date: "2026-09-01", source: "employment.end_date", precision: "exact", confirmed: true });
        // Adding the last act resolves it: 15 Aug 2026 + 3m less 1 day = 14 Nov 2026.
        await setStructuredFact(alice, c.id, "date_of_last_act", "2026-08-15", "The last incident was on 15 August 2026.");
        const after = kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:discrimination");
        expect(after.status).toBe("calculated");
        expect(after.calculatedDate).toBe("2026-11-14");
        expect(after.explanation.trigger?.source).toBe("structured_fact:date_of_last_act");
    });

    it("a missing deduction date stays missing even when a last-act date exists", async () => {
        const c = await createCase(alice, { entryRoute: "pay" });
        await setStructuredFact(alice, c.id, "date_of_last_act", "2026-08-15", "My manager refused to pay me on 15 August 2026.");
        const wages = kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unlawful_deductions");
        expect(wages.status).toBe("uncertain");
        expect(wages.calculatedDate).toBeNull();
        expect(wages.explanation.missingInformation[0]).toMatch(/payday of the deduction/);
        expect((await listTasks(alice, c.id)).some((t) => t.systemKey === "deadline:missing_trigger")).toBe(true);
    });

    it("an end date without confirmation that employment has ended is not used as the EDT", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await updateEmployment(alice, c.id, { endDate: "2026-09-01" });
        const ud = kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unfair_dismissal");
        expect(ud.status).toBe("uncertain");
        expect(ud.explanation.missingInformation.join(" ")).toMatch(/not confirmed that your employment has ended/);
    });
});

describe("approximate dates keep their precision end to end", () => {
    it("intake → facts → deadlines → dashboard → case pack JSON/Markdown → ET1 pack", async () => {
        const { caseId } = await createCaseFromIntake(alice, { jurisdiction: "england_wales", entryRoute: "dismissal", description: "I think I was dismissed around the middle of June.", stillEmployed: false, employerName: "Acme Ltd", endDate: "2026-06-15", endDateApproximate: true });
        const state = await getStructuredFactState(caseId, "dismissal_date");
        expect(state).toMatchObject({ value: "2026-06-15", precision: "approximate", confirmed: true });

        const ud = kind(await listDeadlines(alice, caseId, { today: TODAY }), "et_time_limit:unfair_dismissal");
        expect(ud.calculatedDate).toBe("2026-09-14"); // 15 Jun + 3m less 1 day
        expect(ud.explanation.trigger?.precision).toBe("approximate");
        expect(ud.explanation.warnings.join(" ")).toMatch(/approximate/);

        const dash = await buildDashboard(alice, caseId, { today: TODAY });
        const item = dash.important.find((i) => i.label === "Unfair dismissal claim")!;
        expect(item.precision).toBe("approximate");
        expect(item.headline).toMatch(/\(approximate date\)/);

        const pack = await buildCasePack(alice, caseId);
        expect(JSON.stringify(pack.deadlines)).toMatch(/approximate/);
        const md = renderCasePackMarkdown(pack);
        expect(md).toMatch(/precision: approximate/);

        const et1 = await buildEt1ReadinessPack(alice, caseId);
        expect(et1.timeLimits.data[0].triggerPrecision).toBe("approximate");
        expect(JSON.stringify(et1.timeLimits)).toMatch(/approximate/);
        expect(et1.unresolvedQuestions.join(" ")).toMatch(/approximate/);
        expect(renderEt1Pack(et1)).toMatch(/is approximate/);
    });

    it("triage uses the family the route implies and names the missing date instead of substituting the end date", async () => {
        const res = await triage({ jurisdiction: "england_wales", entryRoute: "discrimination", description: "", stillEmployed: false, endDate: "2026-09-01" });
        expect(res.urgency.family).toBe("discrimination");
        expect(res.urgency.level).toBe("none");
        expect(res.urgency.deadline).toBeNull();
        expect(res.urgency.message).toMatch(/last act/);
        const pending = await triage({ jurisdiction: "england_wales", entryRoute: "dismissal", description: "", stillEmployed: false, endDate: "2026-07-01", acasNotified: true, acasNotificationDate: "2026-09-01" });
        expect(pending.urgency.level).toBe("pending_acas");
        expect(pending.urgency.message).toMatch(/no earlier than/);
        expect(pending.urgency.message).toMatch(/2026-09-30/);
    });
});

describe("competing confirmed values", () => {
    it("returns uncertain listing both dates rather than taking the newest", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await updateEmployment(alice, c.id, { stillEmployed: false });
        const extracted = await proposeFact(c.id, { statement: "Letter: dismissed on 3 March 2026.", provenance: "DOCUMENT_EXTRACTED", key: "dismissal_date", value: "2026-03-03" });
        await confirmFact(alice, c.id, extracted.id);
        await addFact(alice, c.id, { statement: "I was actually dismissed on 10 March 2026.", key: "dismissal_date", value: "2026-03-10", status: "confirmed" });
        const state = await getStructuredFactState(c.id, "dismissal_date");
        expect(state.value).toBeNull();
        expect(state.conflictingValues).toEqual(["2026-03-03", "2026-03-10"]);
        const ud = kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unfair_dismissal");
        expect(ud.status).toBe("uncertain");
        expect(ud.calculatedDate).toBeNull();
        expect(ud.explanation.trigger?.conflictingValues).toEqual(["2026-03-03", "2026-03-10"]);
        expect(ud.explanation.missingInformation.join(" ")).toMatch(/Resolve the conflicting dates on My case/);
        expect((await listTasks(alice, c.id)).some((t) => t.systemKey === "deadline:missing_trigger" && /conflicting/.test(t.title))).toBe(true);
        // The user resolves it through the form: every earlier confirmed row is superseded.
        await setStructuredFact(alice, c.id, "dismissal_date", "2026-03-10", "I was dismissed on 10 March 2026.");
        expect((await listConfirmedFacts(c.id)).filter((f) => f.key === "dismissal_date")).toHaveLength(1);
        expect(kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unfair_dismissal").calculatedDate).toBe("2026-06-09");
    });

    it("confirming an identical value supersedes the older confirmed row instead of piling up", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await setStructuredFact(alice, c.id, "dismissal_date", "2026-03-03", "I was dismissed on 3 March 2026.");
        const extracted = await proposeFact(c.id, { statement: "Letter: dismissed on 3 March 2026.", provenance: "DOCUMENT_EXTRACTED", key: "dismissal_date", value: "2026-03-03" });
        await confirmFact(alice, c.id, extracted.id);
        const confirmed = (await listConfirmedFacts(c.id)).filter((f) => f.key === "dismissal_date");
        expect(confirmed).toHaveLength(1);
        expect(confirmed[0].id).toBe(extracted.id);
        expect((await getStructuredFactState(c.id, "dismissal_date")).conflictingValues).toEqual([]);
    });
});

describe("corrections recompute (F06)", () => {
    it("moving the deduction date moves the wages deadline through listDeadlines", async () => {
        const c = await createCase(alice, { entryRoute: "pay" });
        await setStructuredFact(alice, c.id, "date_of_deduction", "2026-08-01", "I was underpaid on 1 August 2026.");
        expect(kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unlawful_deductions").calculatedDate).toBe("2026-10-31");
        await setStructuredFact(alice, c.id, "date_of_deduction", "2026-09-01", "The underpayment was actually on 1 September 2026.");
        expect(kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unlawful_deductions").calculatedDate).toBe("2026-11-30");
        // correctFact on the structured row also recomputes.
        const current = await getStructuredFactState(c.id, "date_of_deduction");
        await correctFact(alice, c.id, current.factId!, { value: "2026-09-15" });
        expect(kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unlawful_deductions").calculatedDate).toBe("2026-12-14");
        const task = (await listTasks(alice, c.id)).find((t) => t.systemKey === "deadline:et_time_limit:unlawful_deductions")!;
        expect(task.dueDate).toBe("2026-12-14");
    });

    it("changing the employer appeal window recomputes the appeal deadline and updates its task", async () => {
        const c = await createCase(alice, { entryRoute: "appeal" });
        const disc = await startProcess(alice, c.id, { type: "disciplinary", startedOn: "2026-02-10", initialState: "outcome", data: { outcomeDate: "2026-03-10", appealWindowDays: 5 } });
        const today = "2026-03-11";
        expect(kind(await listDeadlines(alice, c.id, { today }), "disciplinary_appeal_window").calculatedDate).toBe("2026-03-15");
        expect((await listTasks(alice, c.id)).find((t) => t.systemKey === "deadline:disciplinary_appeal_window")?.dueDate).toBe("2026-03-15");
        await updateProcessData(alice, c.id, disc.id, { appealWindowDays: 10 });
        expect(kind(await listDeadlines(alice, c.id, { today }), "disciplinary_appeal_window").calculatedDate).toBe("2026-03-20");
        const tasks = await listTasks(alice, c.id);
        expect(tasks.filter((t) => t.systemKey === "deadline:disciplinary_appeal_window")).toHaveLength(1);
        expect(tasks.find((t) => t.systemKey === "deadline:disciplinary_appeal_window")?.dueDate).toBe("2026-03-20");
        // The outcome date changing also recomputes.
        await updateProcessData(alice, c.id, disc.id, { outcomeDate: "2026-03-12" });
        expect(kind(await listDeadlines(alice, c.id, { today }), "disciplinary_appeal_window").calculatedDate).toBe("2026-03-22");
        await expect(updateProcessData(alice, c.id, disc.id, { appealWindowDays: 0 })).rejects.toBeInstanceOf(ValidationError);
        await expect(updateProcessData(alice, c.id, disc.id, { appealWindowDays: 90 })).rejects.toBeInstanceOf(ValidationError);
        await expect(updateProcessData(alice, c.id, disc.id, { appealWindowDays: 7.5 })).rejects.toBeInstanceOf(ValidationError);
    });

    it("withdraws the missing-date task once the date is supplied", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await listDeadlines(alice, c.id, { today: TODAY });
        expect((await listTasks(alice, c.id)).some((t) => t.systemKey === "deadline:missing_trigger")).toBe(true);
        await setStructuredFact(alice, c.id, "dismissal_date", "2026-09-01", "I was dismissed on 1 September 2026.");
        await listDeadlines(alice, c.id, { today: TODAY });
        const open = await listTasks(alice, c.id);
        expect(open.some((t) => t.systemKey === "deadline:missing_trigger")).toBe(false);
        const all = await listTasks(alice, c.id, { includeObsolete: true });
        expect(all.find((t) => t.systemKey === "deadline:missing_trigger")?.status).toBe("obsolete");
    });
});

describe("time passage is derived, not stored (F06c)", () => {
    it("presents a passed deadline as expired without any case edit, and as calculated again for an earlier today", async () => {
        const c = await createCase(alice, { entryRoute: "pay" });
        await setStructuredFact(alice, c.id, "date_of_deduction", "2026-08-01", "I was underpaid on 1 August 2026.");
        const before = kind(await listDeadlines(alice, c.id, { today: "2026-10-01" }), "et_time_limit:unlawful_deductions");
        expect(before.status).toBe("calculated");
        expect(before.calculatedDate).toBe("2026-10-31");
        const after = kind(await listDeadlines(alice, c.id, { today: "2026-11-01" }), "et_time_limit:unlawful_deductions");
        expect(after.status).toBe("expired");
        expect(after.calculatedDate).toBe("2026-10-31");
        expect((await listTasks(alice, c.id)).find((t) => t.systemKey === "deadline:et_time_limit:unlawful_deductions")?.title).toMatch(/appears to have passed/);
        const again = kind(await listDeadlines(alice, c.id, { today: "2026-10-15" }), "et_time_limit:unlawful_deductions");
        expect(again.status).toBe("calculated");
    });

    it("presentDeadline is pure and never expires pending or uncertain rows", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await setStructuredFact(alice, c.id, "dismissal_date", "2026-01-01", "I was dismissed on 1 January 2026.");
        const rows = await computeCaseDeadlines(alice, c.id, { today: "2026-02-01" });
        const stored = kind(rows, "et_time_limit:unfair_dismissal");
        expect(stored.status).toBe("calculated");
        expect(stored.computedForDate).toBe("2026-02-01");
        expect(presentDeadline(stored, "2026-04-01").status).toBe("expired");
        expect(presentDeadline(stored, "2026-03-31").status).toBe("calculated");
        expect(presentDeadline(stored, "2026-03-31").daysRemaining).toBe(0);
        const pending: DeadlineRow = { ...stored, status: "pending_acas", calculatedDate: null };
        expect(presentDeadline(pending, "2030-01-01").status).toBe("pending_acas");
        const uncertain: DeadlineRow = { ...stored, status: "uncertain", calculatedDate: null };
        expect(presentDeadline(uncertain, "2030-01-01").status).toBe("uncertain");
    });
});

describe("Acas Day A / Day B (F05)", () => {
    it("pending conciliation is pending_acas on the dashboard with a floor, never expired", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await setStructuredFact(alice, c.id, "dismissal_date", "2026-01-01", "I was dismissed on 1 January 2026.");
        const acas = await startProcess(alice, c.id, { type: "acas_early_conciliation", startedOn: "2026-03-01" });
        await updateProcessData(alice, c.id, acas.id, { notificationDate: "2026-03-01" });
        const ud = kind(await listDeadlines(alice, c.id, { today: "2026-04-01" }), "et_time_limit:unfair_dismissal");
        expect(ud.status).toBe("pending_acas");
        expect(ud.calculatedDate).toBeNull();
        expect(ud.explanation.unadjusted?.date).toBe("2026-03-31");
        const dash = await buildDashboard(alice, c.id, { today: "2026-04-01" });
        const item = dash.important.find((i) => i.label === "Unfair dismissal claim")!;
        expect(item.status).toBe("pending_acas");
        expect(item.headline).toMatch(/paused for Acas conciliation since 2026-03-01/);
        expect(item.headline).toMatch(/no earlier than 2026-03-31/);
        expect(item.headline).not.toMatch(/passed/);
        expect((await listTasks(alice, c.id)).some((t) => t.systemKey === "deadline:acas_day_b")).toBe(true);
        const et1 = await buildEt1ReadinessPack(alice, c.id);
        expect(et1.timeLimits.data[0].status).toBe("pending_acas");
        expect(et1.timeLimits.data[0].unadjustedDate).toBe("2026-03-31");
        expect(renderEt1Pack(et1)).toMatch(/no earlier than 2026-03-31/);
    });

    it("uses the receipt date as Day B when given, and the issue date conservatively otherwise", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await setStructuredFact(alice, c.id, "dismissal_date", "2026-01-01", "I was dismissed on 1 January 2026.");
        const acas = await startProcess(alice, c.id, { type: "acas_early_conciliation", startedOn: "2026-02-01" });
        await updateProcessData(alice, c.id, acas.id, { notificationDate: "2026-02-01", certificateIssueDate: "2026-03-10", certificateStatus: "issued" });
        // Unadjusted 31 Mar 2026; Day A 1 Feb → issue 10 Mar = 37 days → 7 May 2026.
        let ud = kind(await listDeadlines(alice, c.id, { today: "2026-03-12" }), "et_time_limit:unfair_dismissal");
        expect(ud.calculatedDate).toBe("2026-05-07");
        expect(ud.explanation.acas).toMatchObject({ dayA: "2026-02-01", dayB: "2026-03-10", dayBBasis: "issue_date_assumed" });
        expect((await getStructuredFactState(c.id, "acas_day_b")).value).toBe("2026-03-10");
        let et1 = await buildEt1ReadinessPack(alice, c.id);
        expect(et1.acas.data.dayBBasis).toBe("issue_date_assumed");
        expect(et1.unresolvedQuestions.join(" ")).toMatch(/Day B/);
        // Received 12 Mar by post → 39 days → 9 May 2026 (later, never earlier).
        await updateProcessData(alice, c.id, acas.id, { certificateReceivedDate: "2026-03-12", certificateDeliveryMethod: "post" });
        ud = kind(await listDeadlines(alice, c.id, { today: "2026-03-12" }), "et_time_limit:unfair_dismissal");
        expect(ud.calculatedDate).toBe("2026-05-09");
        expect(ud.explanation.acas?.dayBBasis).toBe("received");
        expect((await getStructuredFactState(c.id, "acas_day_b")).value).toBe("2026-03-12");
        et1 = await buildEt1ReadinessPack(alice, c.id);
        expect(et1.acas.data.certificateReceivedDate).toBe("2026-03-12");
        expect(et1.acas.data.dayBBasis).toBe("received");
        // Email: the issue date is a deemed receipt date.
        await updateProcessData(alice, c.id, acas.id, { certificateReceivedDate: null, certificateDeliveryMethod: "email" });
        ud = kind(await listDeadlines(alice, c.id, { today: "2026-03-12" }), "et_time_limit:unfair_dismissal");
        expect(ud.calculatedDate).toBe("2026-05-07");
        expect(ud.explanation.acas?.dayBBasis).toBe("deemed_received");
    });

    it("rejects reversed or inconsistent Acas dates at input", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        const acas = await startProcess(alice, c.id, { type: "acas_early_conciliation", startedOn: "2026-02-01" });
        await expect(updateProcessData(alice, c.id, acas.id, { certificateIssueDate: "2026-03-10" })).rejects.toBeInstanceOf(ValidationError);
        await updateProcessData(alice, c.id, acas.id, { notificationDate: "2026-02-01" });
        await expect(updateProcessData(alice, c.id, acas.id, { certificateIssueDate: "2026-01-20" })).rejects.toThrow(/cannot be before/);
        await expect(updateProcessData(alice, c.id, acas.id, { certificateIssueDate: "2026-03-10", certificateReceivedDate: "2026-03-05" })).rejects.toThrow(/cannot be before/);
        await expect(updateProcessData(alice, c.id, acas.id, { certificateDeliveryMethod: "carrier pigeon" })).rejects.toBeInstanceOf(ValidationError);
        await expect(triage({ jurisdiction: "england_wales", entryRoute: "dismissal", description: "", acasNotificationDate: "2026-03-01", acasCertificateDate: "2026-02-01" })).rejects.toBeInstanceOf(ValidationError);
        await expect(createCaseFromIntake(alice, { jurisdiction: "england_wales", entryRoute: "dismissal", description: "", acasCertificateDate: "2026-02-01" })).rejects.toBeInstanceOf(ValidationError);
    });

    it("no revival is unchanged: conciliation begun after expiry does not extend time", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await setStructuredFact(alice, c.id, "dismissal_date", "2025-01-01", "I was dismissed on 1 January 2025.");
        const acas = await startProcess(alice, c.id, { type: "acas_early_conciliation", startedOn: "2025-04-10" });
        await updateProcessData(alice, c.id, acas.id, { notificationDate: "2025-04-10", certificateIssueDate: "2025-04-20", certificateStatus: "issued" });
        const ud = kind(await listDeadlines(alice, c.id, { today: "2025-04-21" }), "et_time_limit:unfair_dismissal");
        expect(ud.calculatedDate).toBe("2025-03-31");
        expect(ud.status).toBe("expired");
        expect(ud.explanation.warnings.join(" ")).toMatch(/does not extend time/);
    });
});

describe("tenancy and precision staleness", () => {
    it("another user cannot read or compute a case's deadlines", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await expect(listDeadlines(bob, c.id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(computeCaseDeadlines(bob, c.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("changing only the employment end-date precision marks deadlines stale and is carried through", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await updateEmployment(alice, c.id, { endDate: "2026-09-01", stillEmployed: false });
        expect(kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unfair_dismissal").explanation.trigger?.precision).toBe("exact");
        await updateEmployment(alice, c.id, { endDatePrecision: "month" });
        const ud = kind(await listDeadlines(alice, c.id, { today: TODAY }), "et_time_limit:unfair_dismissal");
        expect(ud.explanation.trigger?.precision).toBe("month");
        expect(ud.explanation.warnings.join(" ")).toMatch(/Only the month/);
    });
});
