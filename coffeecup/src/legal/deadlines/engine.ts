/**
 * Deterministic deadline engine.
 *
 * Input: structured case facts (never free text, never an LLM).
 * Output: a calculated date OR an explicit statement of what is missing,
 * always with assumptions, the trigger date used, the Acas effect, the rule
 * version and its sources.
 *
 * Arithmetic is delegated to the retained Tribunal Harness calculator
 * (et-time-limit.ts): corresponding-date rule, s207B Acas clock-stop with the
 * no-revival rule, and the non-working-day warning that never moves the date.
 */

import type { Jurisdiction, DeadlineExplanation } from "@/db/schema";
import { addMonthsLessOneDay } from "./et-time-limit";
import { selectTimeLimitRule, type ClaimFamily, type TimeLimitRule } from "@/legal/rules/time-limits";
import { citeSource } from "@/legal/sources/registry";
import { addDays, compareIso, daysBetween, isIsoDate, parseUTC, todayISO, toISODate } from "@/lib/dates";
import { isNonWorkingDayEW } from "./non-working-days";

export interface TimeLimitInput {
    jurisdiction: Jurisdiction;
    family: ClaimFamily;
    /** The triggering date (EDT, last act, deduction payday…). null when unknown. */
    triggerDate: string | null;
    /** Whether the user marked the trigger date approximate. */
    triggerApproximate?: boolean;
    acasDayA?: string | null;
    acasDayB?: string | null;
    today?: string;
}

export interface TimeLimitOutput {
    kind: string;
    label: string;
    calculatedDate: string | null;
    status: "calculated" | "uncertain" | "expired";
    ruleId: string;
    ruleVersion: string;
    explanation: DeadlineExplanation;
    daysRemaining: number | null;
}

const FAMILY_LABELS: Record<ClaimFamily, string> = {
    unfair_dismissal: "Unfair dismissal claim",
    discrimination: "Discrimination claim",
    whistleblowing_detriment: "Whistleblowing detriment claim",
    unlawful_deductions: "Unpaid wages claim",
    breach_of_contract: "Breach of contract claim",
    redundancy_payment: "Redundancy payment claim",
    equal_pay: "Equal pay claim",
    general: "Tribunal claim",
};

function addMonths(iso: string, months: number): string {
    const d = parseUTC(iso);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + months;
    const targetYear = y + Math.floor(m / 12);
    const targetMonth = ((m % 12) + 12) % 12;
    const daysIn = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return toISODate(new Date(Date.UTC(targetYear, targetMonth, Math.min(d.getUTCDate(), daysIn))));
}

interface AcasResult {
    finalDate: string;
    effect: string | null;
    warnings: string[];
}

/** s207B ERA 1996: discount Day A→Day B; one-month-from-Day-B backstop; no revival. */
function applyAcas(base: string, dayA: string | null | undefined, dayB: string | null | undefined): AcasResult {
    if (!dayA) return { finalDate: base, effect: null, warnings: [] };
    if (compareIso(dayA, base) > 0) {
        return {
            finalDate: base,
            effect: "Acas conciliation started after the time limit had already expired, so it does not extend the deadline.",
            warnings: ["Acas Early Conciliation begun after the limit expired does not extend time (ERA 1996 s207B). The claim may already be out of time. Seek advice immediately."],
        };
    }
    if (!dayB) {
        return {
            finalDate: base,
            effect: `Acas Early Conciliation started on ${dayA} (Day A). The clock is paused, but the extended deadline cannot be calculated until the certificate date (Day B) is known.`,
            warnings: ["Add the Acas certificate date (Day B) as soon as you receive it so the extended deadline can be calculated."],
        };
    }
    const effectiveB = compareIso(dayB, dayA) < 0 ? dayA : dayB;
    const gap = daysBetween(dayA, effectiveB);
    const extended = addDays(base, gap);
    const oneMonthFromB = addMonths(effectiveB, 1);
    let final = compareIso(extended, oneMonthFromB) > 0 ? extended : oneMonthFromB;
    if (compareIso(final, base) < 0) final = base;
    const effect =
        final === extended
            ? `The ${gap} days between Day A (${dayA}) and Day B (${effectiveB}) are not counted, moving the deadline from ${base} to ${final}.`
            : `Because the limit would otherwise expire within a month of the certificate, it expires one month after Day B (${effectiveB}): ${final}.`;
    return { finalDate: final, effect, warnings: [] };
}

function computeForRule(rule: TimeLimitRule, input: TimeLimitInput, trigger: string, today: string) {
    const base = toISODate(addMonthsLessOneDay(parseUTC(trigger), rule.months));
    const acas = rule.acasExtensionApplies ? applyAcas(base, input.acasDayA, input.acasDayB) : { finalDate: base, effect: null, warnings: [] };
    const daysRemaining = daysBetween(today, acas.finalDate);
    return { base, acas, daysRemaining };
}

export function calculateTimeLimit(input: TimeLimitInput): TimeLimitOutput {
    const today = input.today ?? todayISO();
    const label = FAMILY_LABELS[input.family];
    const kind = `et_time_limit:${input.family}`;

    const missing: string[] = [];
    if (!input.triggerDate) missing.push("The triggering date is not recorded (for example the dismissal date or the date of the last act).");
    else if (!isIsoDate(input.triggerDate)) missing.push("The triggering date is not a valid date.");

    if (missing.length > 0) {
        return {
            kind,
            label,
            calculatedDate: null,
            status: "uncertain",
            ruleId: "none",
            ruleVersion: "none",
            daysRemaining: null,
            explanation: {
                triggerDate: null,
                triggerDescription: "Not yet known",
                assumptions: [],
                acasEffect: null,
                source: { title: "No rule applied", reference: "", version: "none" },
                warnings: ["We do not currently have enough information to work out which time-limit rule applies. Confirm the triggering date."],
                missingInformation: missing,
            },
        };
    }

    const trigger = input.triggerDate!;
    const selection = selectTimeLimitRule(input.jurisdiction, input.family, trigger);
    if (!selection.rule) {
        return {
            kind,
            label,
            calculatedDate: null,
            status: "uncertain",
            ruleId: "none",
            ruleVersion: "none",
            daysRemaining: null,
            explanation: {
                triggerDate: trigger,
                triggerDescription: "Triggering date recorded",
                assumptions: [],
                acasEffect: null,
                source: { title: "No rule applied", reference: "", version: "none" },
                warnings: [selection.reason],
                missingInformation: ["A jurisdiction and claim type that this tool supports."],
            },
        };
    }

    // Conservative direction: when the matching rule's commencement is not
    // confirmed by SI, lead with the shorter rule that applied before it.
    const primaryRule = selection.conservativeRule ?? selection.rule;
    const secondaryRule = selection.conservativeRule ? selection.rule : null;

    const primary = computeForRule(primaryRule, input, trigger, today);
    const assumptions: string[] = [
        `${primaryRule.plainDescription}`,
        `Triggering date used: ${trigger}${input.triggerApproximate ? " (marked approximate by you — confirm the exact date)" : ""}.`,
    ];
    if (secondaryRule) {
        assumptions.push(
            `${secondaryRule.commencement.note} Until it is confirmed, the shorter three-month deadline is shown as the deadline to work to.`,
        );
    }
    if (input.jurisdiction === "scotland") {
        assumptions.push("Scottish bank holidays are not checked; the non-working-day warning uses the England and Wales calendar.");
    }

    const warnings = [...primary.acas.warnings];
    if (input.triggerApproximate) warnings.push("The triggering date is approximate. The deadline may be earlier than shown. Confirm the exact date.");
    if (primaryRule.triggeringEvent === "date_of_last_act") {
        warnings.push("If the treatment is continuing, time normally runs from the end of the last act. If you are unsure, treat the earliest possible date as the trigger.");
    }
    if (isNonWorkingDayEW(primary.acas.finalDate)) {
        warnings.push(`This deadline falls on a weekend or bank holiday. The time limit is NOT extended: present the claim on or before ${primary.acas.finalDate}.`);
    }
    if (primary.daysRemaining >= 0 && primary.daysRemaining <= 14) {
        warnings.push(`Urgent: this deadline is ${primary.daysRemaining} day${primary.daysRemaining === 1 ? "" : "s"} away.`);
    }
    if (primary.daysRemaining < 0) {
        warnings.push(
            primaryRule.extensionDiscretion === "just_and_equitable"
                ? "This deadline appears to have passed. A tribunal can still accept a late discrimination claim if it considers it just and equitable, but this is discretionary. Seek advice immediately."
                : primaryRule.extensionDiscretion === "not_reasonably_practicable"
                    ? "This deadline appears to have passed. A tribunal can only accept a late claim of this kind if it was not reasonably practicable to present it in time. Seek advice immediately."
                    : "This deadline appears to have passed. Seek advice immediately.",
        );
    }

    let secondary: DeadlineExplanation["secondary"] = null;
    if (secondaryRule) {
        const s = computeForRule(secondaryRule, input, trigger, today);
        secondary = {
            label: `${secondaryRule.months}-month limit if the Employment Rights Act 2025 commencement is confirmed`,
            date: s.acas.finalDate,
            note: secondaryRule.commencement.note ?? "",
        };
    }

    const primarySource = citeSource(primaryRule.sourceKeys[0]);

    return {
        kind,
        label,
        calculatedDate: primary.acas.finalDate,
        status: primary.daysRemaining < 0 ? "expired" : "calculated",
        ruleId: primaryRule.id,
        ruleVersion: primaryRule.version,
        daysRemaining: primary.daysRemaining,
        explanation: {
            triggerDate: trigger,
            triggerDescription: describeTrigger(primaryRule),
            assumptions,
            acasEffect: primary.acas.effect,
            source: { title: primarySource.title, reference: primarySource.reference, url: primarySource.url, version: primaryRule.version },
            warnings,
            missingInformation: input.acasDayA && !input.acasDayB ? ["Acas certificate date (Day B)."] : [],
            secondary,
        },
    };
}

function describeTrigger(rule: TimeLimitRule): string {
    switch (rule.triggeringEvent) {
        case "effective_date_of_termination":
            return "Effective date of termination (the day your employment ended)";
        case "date_of_last_act":
            return "Date of the act complained of (or the last act in a continuing series)";
        case "date_of_deduction":
            return "Payday of the deduction (or the last deduction in a series)";
        case "relevant_date":
            return "Relevant date (usually the date the employment ended)";
        case "last_day_of_employment":
            return "Last day of employment";
    }
}
