/**
 * Case-level deadline computation.
 *
 * Reads ONLY structured, confirmed data (employment end date, structured
 * facts, Acas process dates, user-entered policy windows) and writes Deadline
 * rows with full explanations. Called after any change that marks deadlines
 * stale, and on demand from the dashboard.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { deadlines, type AcasProcessData, type DeadlineExplanation, type EntryRoute } from "@/db/schema";
import { newId } from "@/lib/ids";
import { requireCaseAccess, type Actor } from "@/cases/access";
import { getEmployment } from "@/cases/service";
import { getStructuredFact } from "@/facts/service";
import { getAcasProcess, listProcesses } from "@/processes/service";
import { listIssues } from "@/issues/service";
import { calculateTimeLimit, type TimeLimitOutput } from "./engine";
import type { ClaimFamily } from "@/legal/rules/time-limits";
import { addDays, todayISO } from "@/lib/dates";
import { upsertSystemTask } from "@/tasks/service";

export type DeadlineRow = typeof deadlines.$inferSelect;

/** Which time-limit families are worth showing for this case. */
export function relevantFamilies(entryRoute: EntryRoute, issueCategories: string[], dismissed: boolean): ClaimFamily[] {
    const set = new Set<ClaimFamily>();
    const cats = new Set(issueCategories);
    if (dismissed || entryRoute === "dismissal" || entryRoute === "redundancy" || cats.has("dismissal")) set.add("unfair_dismissal");
    if (entryRoute === "discrimination" || entryRoute === "disability_adjustments" || cats.has("discrimination") || cats.has("disability_adjustments")) set.add("discrimination");
    if (entryRoute === "whistleblowing" || cats.has("whistleblowing")) set.add("whistleblowing_detriment");
    if (entryRoute === "pay" || cats.has("pay")) set.add("unlawful_deductions");
    if (entryRoute === "redundancy" || cats.has("redundancy")) set.add("redundancy_payment");
    if (set.size === 0) set.add("general");
    return [...set];
}

export async function computeCaseDeadlines(actor: Actor, caseId: string): Promise<DeadlineRow[]> {
    const c = await requireCaseAccess(actor, caseId);
    const employment = await getEmployment(actor, caseId);
    const issues = await listIssues(actor, caseId);
    const acasProc = await getAcasProcess(caseId);
    const acas = (acasProc?.data ?? {}) as AcasProcessData;

    const dismissalFact = await getStructuredFact(caseId, "dismissal_date");
    const edtFact = await getStructuredFact(caseId, "effective_date_of_termination");
    const lastActFact = await getStructuredFact(caseId, "date_of_last_act");
    const deductionFact = await getStructuredFact(caseId, "date_of_deduction");
    const dayAFact = await getStructuredFact(caseId, "acas_day_a");
    const dayBFact = await getStructuredFact(caseId, "acas_day_b");

    const edt = edtFact?.value ?? dismissalFact?.value ?? employment.endDate ?? null;
    const dismissed = !!edt || employment.stillEmployed === false;
    const lastAct = lastActFact?.value ?? edt;
    const acasDayA = acas.notificationDate ?? dayAFact?.value ?? null;
    const acasDayB = acas.certificateIssueDate ?? dayBFact?.value ?? null;

    const families = relevantFamilies(c.entryRoute, issues.map((i) => i.category), dismissed);
    const today = todayISO();
    const outputs: TimeLimitOutput[] = [];
    for (const family of families) {
        let trigger: string | null;
        switch (family) {
            case "unfair_dismissal":
            case "breach_of_contract":
                trigger = edt;
                break;
            case "unlawful_deductions":
                trigger = deductionFact?.value ?? lastAct;
                break;
            case "redundancy_payment":
            case "equal_pay":
                trigger = edt;
                break;
            default:
                trigger = lastAct;
        }
        outputs.push(calculateTimeLimit({ jurisdiction: c.jurisdiction, family, triggerDate: trigger, acasDayA, acasDayB, today }));
    }

    const db = await getDb();
    await db.delete(deadlines).where(eq(deadlines.caseId, caseId));
    const rows: (typeof deadlines.$inferInsert)[] = outputs.map((o) => ({
        id: newId(),
        caseId,
        kind: o.kind,
        label: o.label,
        calculatedDate: o.calculatedDate,
        ruleId: o.ruleId,
        ruleVersion: o.ruleVersion,
        explanation: o.explanation,
        status: o.status,
    }));

    // Internal process windows entered by the user (policy-dependent, never invented).
    const procs = await listProcesses(actor, caseId);
    for (const p of procs) {
        const data = p.data as Record<string, unknown>;
        const outcomeDate = typeof data.outcomeDate === "string" ? data.outcomeDate : null;
        const windowDays = typeof data.appealWindowDays === "number" ? data.appealWindowDays : null;
        if ((p.type === "grievance" || p.type === "disciplinary") && outcomeDate) {
            const explanation: DeadlineExplanation = {
                triggerDate: outcomeDate,
                triggerDescription: "Date you received the outcome",
                assumptions: windowDays ? [`Your employer's policy allows ${windowDays} days to appeal (as you entered it).`] : [],
                acasEffect: null,
                source: { title: "Your employer's grievance/disciplinary policy", reference: "Employer policy (check the outcome letter)", version: "user-entered" },
                warnings: windowDays ? [] : ["Appeal time limits are set by your employer's policy, not by statute. Check the outcome letter and enter the number of days allowed."],
                missingInformation: windowDays ? [] : ["The number of days your employer's policy allows for an appeal."],
            };
            rows.push({
                id: newId(),
                caseId,
                kind: `${p.type}_appeal_window`,
                label: p.type === "grievance" ? "Deadline to appeal the grievance outcome" : "Deadline to appeal the disciplinary outcome",
                calculatedDate: windowDays ? addDays(outcomeDate, windowDays) : null,
                ruleId: "employer_policy_appeal_window",
                ruleVersion: "user-entered",
                explanation,
                status: windowDays ? (addDays(outcomeDate, windowDays) < today ? "expired" : "calculated") : "uncertain",
            });
        }
    }

    if (rows.length) await db.insert(deadlines).values(rows);

    // Surface the most urgent calculated deadline as a task. An expired
    // deadline still gets a task: the worker needs to know it appears to have
    // passed and that discretionary extensions exist.
    const dated = rows.filter((r) => r.calculatedDate).sort((a, b) => (a.calculatedDate! < b.calculatedDate! ? -1 : 1));
    const urgent = dated.find((r) => r.status === "calculated") ?? dated.find((r) => r.status === "expired");
    if (urgent) {
        const expired = urgent.status === "expired";
        await upsertSystemTask(caseId, `deadline:${urgent.kind}`, {
            title: expired ? `This deadline appears to have passed: ${urgent.label} (${urgent.calculatedDate}). Seek advice now.` : `Note the deadline: ${urgent.label} (${urgent.calculatedDate})`,
            kind: "deadline",
            dueDate: urgent.calculatedDate ?? null,
            description: "Open Important dates to see how this was worked out and what it assumes.",
        });
    }
    const missing = rows.filter((r) => r.status === "uncertain" && r.kind.startsWith("et_time_limit"));
    if (missing.length) {
        await upsertSystemTask(caseId, "deadline:missing_trigger", { title: "Confirm the key date so your time limit can be calculated", kind: "information", description: missing[0].explanation.missingInformation.join(" ") });
    }

    return db.select().from(deadlines).where(eq(deadlines.caseId, caseId));
}

export async function listDeadlines(actor: Actor, caseId: string): Promise<DeadlineRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const rows = await db.select().from(deadlines).where(eq(deadlines.caseId, caseId));
    if (rows.length === 0 || rows.some((r) => r.status === "stale")) return computeCaseDeadlines(actor, caseId);
    return rows;
}
