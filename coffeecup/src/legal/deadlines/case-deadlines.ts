/**
 * Case-level deadline computation.
 *
 * Reads ONLY structured, confirmed data (employment end date and its
 * precision, structured facts with their precision, Acas process dates with
 * the basis for Day B, user-entered policy windows) and writes Deadline rows
 * with full explanations. Rows are recomputed when any input changed (they
 * were marked stale) or when they were computed for a different day.
 *
 * Trigger resolution never substitutes one event for another:
 *   unfair dismissal / breach of contract / redundancy / equal pay → the
 *     effective date of termination (structured fact, else dismissal date,
 *     else the employment end date when the user said employment has ended);
 *   discrimination / whistleblowing detriment → date_of_last_act ONLY;
 *   unlawful deductions → date_of_deduction ONLY.
 * A dismissal is never inferred to be the discriminatory act. Competing
 * confirmed values are reported, not resolved by recency.
 *
 * Every input read here is listed in DEADLINE_INPUTS (src/cases/staleness.ts).
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { deadlines, type AcasProcessData, type DatePrecision, type DeadlineExplanation, type DeadlineStatus, type EntryRoute } from "@/db/schema";
import { newId } from "@/lib/ids";
import { requireCaseAccess, type Actor } from "@/cases/access";
import { getEmployment, type EmploymentRow } from "@/cases/service";
import { getStructuredFactState, type StructuredFactState } from "@/facts/service";
import { getAcasProcess, listProcesses, resolveAcasDayB } from "@/processes/service";
import { listIssues } from "@/issues/service";
import { calculateTimeLimit, MISSING_TRIGGER_TEXT, type TimeLimitAcasInput, type TimeLimitOutput } from "./engine";
import type { ClaimFamily } from "@/legal/rules/time-limits";
import { addDays, compareIso, daysBetween, todayISO } from "@/lib/dates";
import { reconcileSystemTasks, upsertSystemTask } from "@/tasks/service";

export type DeadlineRow = typeof deadlines.$inferSelect;

/** A stored row with its status and urgency derived for a given "today". */
export type PresentedDeadline = DeadlineRow & { daysRemaining: number | null };

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

interface ResolvedTrigger {
    date: string | null;
    precision: DatePrecision | undefined;
    source: string | undefined;
    confirmed: boolean;
    conflicts: string[];
    /** Extra missing-information hints specific to how the trigger was looked for. */
    hints: string[];
}

const NO_TRIGGER: ResolvedTrigger = { date: null, precision: undefined, source: undefined, confirmed: false, conflicts: [], hints: [] };

function fromFact(key: string, s: StructuredFactState): ResolvedTrigger | null {
    if (s.conflictingValues.length > 1) return { date: null, precision: undefined, source: `structured_fact:${key}`, confirmed: false, conflicts: s.conflictingValues, hints: [] };
    if (s.value) return { date: s.value, precision: s.precision ?? "exact", source: `structured_fact:${key}`, confirmed: true, conflicts: [], hints: [] };
    return null;
}

/** EDT chain: structured EDT → dismissal date → employment end date (only when the user said employment has ended). */
function resolveEdt(facts: Record<string, StructuredFactState>, employment: EmploymentRow): ResolvedTrigger {
    const edt = fromFact("effective_date_of_termination", facts.effective_date_of_termination);
    if (edt) return edt;
    const dismissal = fromFact("dismissal_date", facts.dismissal_date);
    if (dismissal) return dismissal;
    if (employment.endDate && employment.stillEmployed === false) {
        return { date: employment.endDate, precision: employment.endDatePrecision ?? "exact", source: "employment.end_date", confirmed: true, conflicts: [], hints: [] };
    }
    if (employment.endDate && employment.stillEmployed !== false) {
        return { ...NO_TRIGGER, hints: ["An employment end date is recorded but you have not confirmed that your employment has ended. Confirm this on My case."] };
    }
    return NO_TRIGGER;
}

export function resolveTriggerForFamily(family: ClaimFamily, facts: Record<string, StructuredFactState>, employment: EmploymentRow): ResolvedTrigger {
    switch (family) {
        case "unfair_dismissal":
        case "breach_of_contract":
        case "redundancy_payment":
        case "equal_pay":
            return resolveEdt(facts, employment);
        case "discrimination":
        case "whistleblowing_detriment":
            // The last act ONLY. A dismissal is never assumed to be the act complained of.
            return fromFact("date_of_last_act", facts.date_of_last_act) ?? NO_TRIGGER;
        case "unlawful_deductions":
            return fromFact("date_of_deduction", facts.date_of_deduction) ?? NO_TRIGGER;
        case "general":
            return fromFact("date_of_last_act", facts.date_of_last_act) ?? resolveEdt(facts, employment);
    }
}

/** Acas dates for the engine, with the basis on which Day B is fixed. */
function resolveAcas(acas: AcasProcessData, dayAFact: StructuredFactState, dayBFact: StructuredFactState): TimeLimitAcasInput {
    const dayA = acas.notificationDate ?? dayAFact.value ?? null;
    if (acas.certificateReceivedDate || acas.certificateIssueDate) {
        const r = resolveAcasDayB(acas);
        return { dayA, dayB: r.dayB, dayBBasis: r.basis, note: null };
    }
    // Legacy mirrored fact (issue date) with no process data: conservative.
    if (dayBFact.value) return { dayA, dayB: dayBFact.value, dayBBasis: "issue_date_assumed", note: null };
    return { dayA, dayB: null, dayBBasis: dayA ? "pending" : "none", note: null };
}

/**
 * Presentation status for a stored row on a given day. "expired" is derived,
 * never trusted from storage; "pending_acas" and "uncertain" never expire.
 */
export function presentDeadline(row: DeadlineRow, today: string): PresentedDeadline {
    let status: DeadlineStatus = row.status;
    let daysRemaining: number | null = null;
    if ((status === "calculated" || status === "expired") && row.calculatedDate) {
        daysRemaining = daysBetween(today, row.calculatedDate);
        status = compareIso(row.calculatedDate, today) < 0 ? "expired" : "calculated";
    }
    return { ...row, status, daysRemaining };
}

export async function computeCaseDeadlines(actor: Actor, caseId: string, opts?: { today?: string }): Promise<DeadlineRow[]> {
    const c = await requireCaseAccess(actor, caseId);
    const employment = await getEmployment(actor, caseId);
    const issues = await listIssues(actor, caseId);
    const acasProc = await getAcasProcess(caseId);
    const acasData = (acasProc?.data ?? {}) as AcasProcessData;
    const today = opts?.today ?? todayISO();

    const factKeys = ["effective_date_of_termination", "dismissal_date", "date_of_last_act", "date_of_deduction", "acas_day_a", "acas_day_b"] as const;
    const facts: Record<string, StructuredFactState> = {};
    for (const k of factKeys) facts[k] = await getStructuredFactState(caseId, k);

    const edt = resolveEdt(facts, employment);
    const dismissed = !!edt.date || edt.conflicts.length > 1 || employment.stillEmployed === false;
    const acas = resolveAcas(acasData, facts.acas_day_a, facts.acas_day_b);

    const families = relevantFamilies(c.entryRoute, issues.map((i) => i.category), dismissed);
    const outputs: TimeLimitOutput[] = [];
    for (const family of families) {
        const t = resolveTriggerForFamily(family, facts, employment);
        const out = calculateTimeLimit({
            jurisdiction: c.jurisdiction,
            family,
            triggerDate: t.date,
            triggerPrecision: t.precision,
            triggerSource: t.source,
            triggerConfirmed: t.confirmed,
            triggerConflicts: t.conflicts,
            acas,
            today,
        });
        if (t.hints.length && out.status === "uncertain") out.explanation.missingInformation.push(...t.hints);
        outputs.push(out);
    }

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
        computedForDate: today,
    }));

    // Internal process windows entered by the user (policy-dependent, never invented).
    const procs = await listProcesses(actor, caseId);
    for (const p of procs) {
        const data = p.data as Record<string, unknown>;
        const outcomeDate = typeof data.outcomeDate === "string" ? data.outcomeDate : null;
        const windowDays = typeof data.appealWindowDays === "number" ? data.appealWindowDays : null;
        if ((p.type === "grievance" || p.type === "disciplinary") && outcomeDate) {
            const dateOut = windowDays ? addDays(outcomeDate, windowDays) : null;
            const explanation: DeadlineExplanation = {
                triggerDate: outcomeDate,
                triggerDescription: "Date you received the outcome",
                trigger: { date: outcomeDate, precision: "exact", source: `process:${p.type}.outcomeDate`, confirmed: true },
                assumptions: windowDays ? [`Your employer's policy allows ${windowDays} days to appeal (as you entered it).`] : [],
                acasEffect: null,
                acas: { dayA: null, dayB: null, dayBBasis: "none", note: "Acas conciliation does not affect an employer's internal appeal window." },
                source: { title: "Your employer's grievance/disciplinary policy", reference: "Employer policy (check the outcome letter)", version: "user-entered" },
                warnings: windowDays ? (dateOut && compareIso(dateOut, today) < 0 ? ["This appeal window appears to have closed. Employers sometimes accept a late appeal; ask in writing and explain any delay."] : []) : ["Appeal time limits are set by your employer's policy, not by statute. Check the outcome letter and enter the number of days allowed."],
                missingInformation: windowDays ? [] : ["The number of days your employer's policy allows for an appeal."],
                secondary: null,
                unadjusted: null,
            };
            rows.push({
                id: newId(),
                caseId,
                kind: `${p.type}_appeal_window`,
                label: p.type === "grievance" ? "Deadline to appeal the grievance outcome" : "Deadline to appeal the disciplinary outcome",
                calculatedDate: dateOut,
                ruleId: "employer_policy_appeal_window",
                ruleVersion: "user-entered",
                explanation,
                status: dateOut ? (compareIso(dateOut, today) < 0 ? "expired" : "calculated") : "uncertain",
                computedForDate: today,
            });
        }
    }

    const db = await getDb();
    await db.transaction(async (tx) => {
        await tx.delete(deadlines).where(eq(deadlines.caseId, caseId));
        if (rows.length) await tx.insert(deadlines).values(rows);
    });

    await reconcileDeadlineTasks(caseId, rows);

    return db.select().from(deadlines).where(eq(deadlines.caseId, caseId));
}

/**
 * System tasks derived from the deadline rows. Tasks for deadlines that no
 * longer exist (a superseded date, a family no longer relevant) are withdrawn.
 */
async function reconcileDeadlineTasks(caseId: string, rows: (typeof deadlines.$inferInsert)[]): Promise<void> {
    const keep: string[] = [];
    // Surface the most urgent calculated deadline as a task. An expired
    // deadline still gets a task: the worker needs to know it appears to have
    // passed and that discretionary extensions exist.
    const dated = rows.filter((r) => r.calculatedDate).sort((a, b) => (a.calculatedDate! < b.calculatedDate! ? -1 : 1));
    const urgent = dated.find((r) => r.status === "calculated") ?? dated.find((r) => r.status === "expired");
    if (urgent) {
        const expired = urgent.status === "expired";
        const key = `deadline:${urgent.kind}`;
        keep.push(key);
        await upsertSystemTask(caseId, key, {
            title: expired ? `This deadline appears to have passed: ${urgent.label} (${urgent.calculatedDate}). Seek advice now.` : `Note the deadline: ${urgent.label} (${urgent.calculatedDate})`,
            kind: "deadline",
            dueDate: urgent.calculatedDate ?? null,
            description: "Open Important dates to see how this was worked out and what it assumes.",
            reason: `Worked out from ${urgent.explanation.triggerDescription.toLowerCase()} (${urgent.explanation.triggerDate}) using ${urgent.explanation.source.reference || "the rule you entered"}.`,
            priority: expired ? 100 : 90,
        });
    }
    const pending = rows.filter((r) => r.status === "pending_acas");
    if (pending.length) {
        keep.push("deadline:acas_day_b");
        await upsertSystemTask(caseId, "deadline:acas_day_b", {
            title: "Add the date you received your Acas certificate (Day B)",
            kind: "deadline",
            dueDate: null,
            description: `Your time limit is paused while Acas conciliation is in progress. It will be no earlier than ${pending[0].explanation.unadjusted?.date ?? "the unadjusted date"}, but cannot be worked out until Day B is known.`,
            reason: "Acas Day A is recorded but Day B is not (ERA 1996 s207B).",
            priority: 80,
        });
    }
    const missing = rows.filter((r) => r.status === "uncertain" && r.kind.startsWith("et_time_limit"));
    if (missing.length) {
        keep.push("deadline:missing_trigger");
        const conflicts = missing.filter((r) => (r.explanation.trigger?.conflictingValues?.length ?? 0) > 1);
        await upsertSystemTask(caseId, "deadline:missing_trigger", {
            title: conflicts.length ? "Resolve the conflicting dates so your time limit can be calculated" : "Confirm the key date so your time limit can be calculated",
            kind: "information",
            description: [...new Set(missing.flatMap((r) => r.explanation.missingInformation))].join(" "),
            reason: missing.map((r) => r.label).join(", "),
            priority: 70,
        });
    }
    await reconcileSystemTasks(caseId, "deadline:", keep);
}

/**
 * The case's deadlines, recomputed when any row is stale or when the stored
 * rows were computed for a different day, then presented for `today`.
 */
export async function listDeadlines(actor: Actor, caseId: string, opts?: { today?: string }): Promise<PresentedDeadline[]> {
    await requireCaseAccess(actor, caseId);
    const today = opts?.today ?? todayISO();
    const db = await getDb();
    let rows = await db.select().from(deadlines).where(eq(deadlines.caseId, caseId));
    if (rows.length === 0 || rows.some((r) => r.status === "stale" || r.computedForDate !== today)) {
        rows = await computeCaseDeadlines(actor, caseId, { today });
    }
    return rows.map((r) => presentDeadline(r, today));
}

/** Text used by the dashboard when a family's trigger is missing. */
export { MISSING_TRIGGER_TEXT };
