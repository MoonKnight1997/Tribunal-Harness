/**
 * Deterministic deadline engine.
 *
 * Input: structured case facts (never free text, never an LLM).
 * Output: a calculated date OR an explicit statement of what is missing,
 * always with assumptions, the trigger date used (and where it came from,
 * how precise it is and whether it is confirmed), the Acas effect (and the
 * basis on which Day B was fixed), the rule version and its sources.
 *
 * Arithmetic is delegated to the retained Tribunal Harness calculator
 * (et-time-limit.ts): corresponding-date rule, s207B Acas clock-stop with the
 * no-revival rule, and the non-working-day warning that never moves the date.
 *
 * Legal basis for the Acas handling (stated here so the code can be checked
 * against it):
 *
 * - ERA 1996 s207B(2): Day A is the day the prospective claimant complies with
 *   the Early Conciliation requirement (Acas receives the notification). Day B
 *   is the day the claimant receives, or is treated as receiving, the
 *   certificate.
 * - s207B(3): the period beginning with the day after Day A and ending with
 *   Day B is not counted when working out the time limit.
 * - s207B(4): if the limit would expire between Day A and one month after
 *   Day B, it expires one month after Day B instead.
 * - Conciliation begun after the limit had already expired does not revive
 *   the claim (no-revival: s207B only extends a limit that has not yet run).
 * - Deemed receipt: Early Conciliation Rules (Schedule to SI 2014/254, rule
 *   9): a certificate sent by email is treated as received on the day it is
 *   sent; by post, on the day it would be delivered in the ordinary course of
 *   post. This product never fabricates a postal delay: when only the
 *   issue/sent date is known, Day B is taken to be that date
 *   ("issue_date_assumed"), which gives the shorter extension and so never
 *   overstates the time available.
 * - Pending conciliation (Day A known, Day B not): the extended limit cannot
 *   be calculated. The status is "pending_acas" with no calculated date; the
 *   unadjusted date is reported as a floor ("no earlier than") because EC
 *   began before expiry.
 * - Reversed or inconsistent Acas dates are never clamped: the result is
 *   "uncertain" with an explicit warning.
 */

import type { AcasBasis, DatePrecision, DeadlineExplanation, DeadlineStatus, DeadlineTrigger, Jurisdiction } from "@/db/schema";
import { addMonthsLessOneDay } from "./et-time-limit";
import { selectTimeLimitRule, type ClaimFamily, type TimeLimitRule } from "@/legal/rules/time-limits";
import { citeSource } from "@/legal/sources/registry";
import { addDays, compareIso, daysBetween, isIsoDate, parseUTC, todayISO, toISODate } from "@/lib/dates";
import { isNonWorkingDayEW } from "./non-working-days";

export interface TimeLimitAcasInput {
    dayA: string | null;
    dayB: string | null;
    dayBBasis: AcasBasis["dayBBasis"];
    note?: string | null;
}

export interface TimeLimitInput {
    jurisdiction: Jurisdiction;
    family: ClaimFamily;
    /** The triggering date (EDT, last act, deduction payday…). null when unknown. */
    triggerDate: string | null;
    /** @deprecated Use triggerPrecision. Kept for callers that still pass a boolean. */
    triggerApproximate?: boolean;
    /** Precision of the trigger date as recorded (facts.valuePrecision / employment precision). */
    triggerPrecision?: DatePrecision;
    /** Where the trigger came from, e.g. "structured_fact:dismissal_date", "employment.end_date". */
    triggerSource?: string;
    /** Whether the trigger was entered or confirmed by the user. */
    triggerConfirmed?: boolean;
    /** Distinct competing confirmed values for the trigger. More than one → uncertain. */
    triggerConflicts?: string[];
    /** @deprecated Use `acas`. Legacy Day A (kept working). */
    acasDayA?: string | null;
    /** @deprecated Use `acas`. Legacy Day B (treated as an issue date, conservatively). */
    acasDayB?: string | null;
    /** Acas Early Conciliation dates with the basis on which Day B was fixed. */
    acas?: TimeLimitAcasInput;
    today?: string;
}

/** Engine statuses. "stale" is a storage state only and is never produced here. */
export type TimeLimitStatus = Exclude<DeadlineStatus, "stale">;

export interface TimeLimitOutput {
    kind: string;
    label: string;
    calculatedDate: string | null;
    status: TimeLimitStatus;
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

/** What is missing when no trigger is recorded, per claim family (no substitution between families). */
export const MISSING_TRIGGER_TEXT: Record<ClaimFamily, string> = {
    unfair_dismissal: "The date your employment ended (the effective date of termination).",
    breach_of_contract: "The date your employment ended (the effective date of termination).",
    discrimination: "The date of the last act you are complaining about. If the dismissal itself is the act, record the dismissal date as the last act on My case.",
    whistleblowing_detriment: "The date of the last act you are complaining about. If the dismissal itself is the act, record the dismissal date as the last act on My case.",
    unlawful_deductions: "The payday of the deduction you are complaining about (or the last deduction in a series).",
    redundancy_payment: "The date your employment ended (the relevant date).",
    equal_pay: "The last day of your employment.",
    general: "The triggering date (for example the dismissal date or the date of the last act).",
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

type AcasOutcome = "none" | "extended" | "no_revival" | "pending" | "invalid";

interface AcasResult {
    outcome: AcasOutcome;
    /** The operative date when outcome is none/extended/no_revival; the unadjusted base otherwise. */
    finalDate: string;
    effect: string | null;
    warnings: string[];
}

/** Normalise legacy acasDayA/acasDayB inputs into the explicit Acas basis shape. */
function resolveAcasInput(input: TimeLimitInput): TimeLimitAcasInput {
    if (input.acas) return input.acas;
    const dayA = input.acasDayA ?? null;
    const dayB = input.acasDayB ?? null;
    // Legacy callers mirrored the certificate ISSUE date as Day B. Treat it as
    // an issue date (conservative) rather than pretend it was a receipt date.
    const dayBBasis: AcasBasis["dayBBasis"] = dayB ? "issue_date_assumed" : dayA ? "pending" : "none";
    return { dayA, dayB, dayBBasis, note: null };
}

/**
 * s207B ERA 1996 applied to a base (unadjusted) date.
 * Never clamps reversed dates; never revives an expired limit; never guesses
 * Day B when it is not known.
 */
function applyAcas(base: string, acas: TimeLimitAcasInput): AcasResult {
    const { dayA, dayB } = acas;
    if (!dayA && !dayB) return { outcome: "none", finalDate: base, effect: null, warnings: [] };
    if (!dayA && dayB) {
        return {
            outcome: "invalid",
            finalDate: base,
            effect: null,
            warnings: ["An Acas certificate date is recorded but the date Acas received your notification (Day A) is not. The Acas extension cannot be worked out without Day A. Add it on the Acas page."],
        };
    }
    const a = dayA!;
    if (dayB && compareIso(dayB, a) < 0) {
        return {
            outcome: "invalid",
            finalDate: base,
            effect: null,
            warnings: [`The Acas dates are inconsistent: Day B (${dayB}) is before Day A (${a}). The certificate cannot be received before Acas was notified. Check both dates on the Acas page.`],
        };
    }
    if (compareIso(a, base) > 0) {
        // No revival: s207B only extends a limit that had not yet expired when EC began.
        return {
            outcome: "no_revival",
            finalDate: base,
            effect: "Acas conciliation started after the time limit had already expired, so it does not extend the deadline.",
            warnings: ["Acas Early Conciliation begun after the limit expired does not extend time (ERA 1996 s207B). The claim may already be out of time. Seek advice immediately."],
        };
    }
    if (!dayB) {
        return {
            outcome: "pending",
            finalDate: base,
            effect: `Acas Early Conciliation started on ${a} (Day A), before the unadjusted limit (${base}). Under ERA 1996 s207B the time between Day A and the day you receive the certificate (Day B) is not counted, so the final deadline will be no earlier than ${base}; it cannot be worked out until Day B is known.`,
            warnings: ["Add the date you received your Acas certificate (Day B) as soon as you have it so the extended deadline can be calculated."],
        };
    }
    // s207B(3): discount Day A → Day B; s207B(4): one-month-from-Day-B backstop.
    const gap = daysBetween(a, dayB);
    const extended = addDays(base, gap);
    const oneMonthFromB = addMonths(dayB, 1);
    let final = compareIso(extended, oneMonthFromB) > 0 ? extended : oneMonthFromB;
    if (compareIso(final, base) < 0) final = base;
    const basisNote =
        acas.dayBBasis === "received"
            ? `Day B is the date you received the certificate (${dayB}).`
            : acas.dayBBasis === "deemed_received"
                ? `Day B is the date on the certificate (${dayB}); a certificate sent by email is treated as received the day it is sent (Early Conciliation Rules, SI 2014/254, rule 9).`
                : `Day B has been taken as the date on the certificate (${dayB}) because the date you received it is not recorded. If you received it later the true deadline may be slightly later, never earlier.`;
    const effect =
        final === extended
            ? `The ${gap} days between Day A (${a}) and Day B (${dayB}) are not counted (ERA 1996 s207B(3)), moving the deadline from ${base} to ${final}. ${basisNote}`
            : `Because the limit would otherwise expire within a month of Day B, it expires one month after Day B (${dayB}): ${final} (ERA 1996 s207B(4)). ${basisNote}`;
    return { outcome: "extended", finalDate: final, effect, warnings: [] };
}

function computeForRule(rule: TimeLimitRule, acas: TimeLimitAcasInput, trigger: string, today: string) {
    const base = toISODate(addMonthsLessOneDay(parseUTC(trigger), rule.months));
    const acasRes: AcasResult = rule.acasExtensionApplies ? applyAcas(base, acas) : { outcome: "none", finalDate: base, effect: null, warnings: [] };
    const daysRemaining = daysBetween(today, acasRes.finalDate);
    return { base, acas: acasRes, daysRemaining };
}

function triggerRecord(input: TimeLimitInput, precision: DatePrecision | null): DeadlineTrigger {
    return {
        date: input.triggerDate && isIsoDate(input.triggerDate) ? input.triggerDate : null,
        precision,
        source: input.triggerSource ?? null,
        confirmed: input.triggerConfirmed ?? true,
        ...(input.triggerConflicts && input.triggerConflicts.length > 1 ? { conflictingValues: [...input.triggerConflicts] } : {}),
    };
}

function acasRecord(acas: TimeLimitAcasInput, note: string | null): AcasBasis {
    return { dayA: acas.dayA, dayB: acas.dayB, dayBBasis: acas.dayBBasis, note: note ?? acas.note ?? null };
}

const PRECISION_WARNING: Record<Exclude<DatePrecision, "exact">, string> = {
    approximate: "The triggering date is approximate. The deadline may be earlier than shown. Confirm the exact date.",
    month: "Only the month of the triggering date is known. The deadline may be earlier than shown. Confirm the exact date.",
    year: "Only the year of the triggering date is known. The deadline may be earlier than shown. Confirm the exact date.",
};

export function calculateTimeLimit(input: TimeLimitInput): TimeLimitOutput {
    const today = input.today ?? todayISO();
    const label = FAMILY_LABELS[input.family];
    const kind = `et_time_limit:${input.family}`;
    const acasIn = resolveAcasInput(input);
    const precision: DatePrecision | null = input.triggerDate ? input.triggerPrecision ?? (input.triggerApproximate ? "approximate" : "exact") : null;
    const trigger = triggerRecord(input, precision);

    const uncertain = (opts: { triggerDescription: string; warnings: string[]; missing: string[]; assumptions?: string[] }): TimeLimitOutput => ({
        kind,
        label,
        calculatedDate: null,
        status: "uncertain",
        ruleId: "none",
        ruleVersion: "none",
        daysRemaining: null,
        explanation: {
            triggerDate: trigger.date,
            triggerDescription: opts.triggerDescription,
            trigger,
            assumptions: opts.assumptions ?? [],
            acasEffect: null,
            acas: acasRecord(acasIn, null),
            source: { title: "No rule applied", reference: "", version: "none" },
            warnings: opts.warnings,
            missingInformation: opts.missing,
            secondary: null,
            unadjusted: null,
        },
    });

    // Competing confirmed values are never silently resolved by recency.
    if (input.triggerConflicts && input.triggerConflicts.length > 1) {
        return uncertain({
            triggerDescription: "Conflicting dates recorded",
            warnings: [`More than one confirmed date is recorded for the triggering event (${input.triggerConflicts.join(", ")}). The time limit cannot be worked out until you say which is right.`],
            missing: ["Resolve the conflicting dates on My case: keep the correct one and correct or reject the other."],
        });
    }

    if (!input.triggerDate) {
        return uncertain({
            triggerDescription: "Not yet known",
            warnings: ["We do not currently have enough information to work out this time limit. Confirm the triggering date."],
            missing: [MISSING_TRIGGER_TEXT[input.family]],
        });
    }
    if (!isIsoDate(input.triggerDate)) {
        return uncertain({ triggerDescription: "Not yet known", warnings: ["The triggering date is not a valid date."], missing: ["The triggering date is not a valid date."] });
    }

    const triggerDate = input.triggerDate;
    const selection = selectTimeLimitRule(input.jurisdiction, input.family, triggerDate);
    if (!selection.rule) {
        return uncertain({
            triggerDescription: "Triggering date recorded",
            warnings: [selection.reason],
            missing: ["A jurisdiction and claim type that this tool supports."],
        });
    }

    // Conservative direction: when the matching rule's commencement is not
    // confirmed by SI, lead with the shorter rule that applied before it.
    const primaryRule = selection.conservativeRule ?? selection.rule;
    const secondaryRule = selection.conservativeRule ? selection.rule : null;

    const primary = computeForRule(primaryRule, acasIn, triggerDate, today);

    const assumptions: string[] = [
        `${primaryRule.plainDescription}`,
        `Triggering date used: ${triggerDate}${precision && precision !== "exact" ? ` (recorded as ${precision === "approximate" ? "approximate" : `${precision} only`} — confirm the exact date)` : ""}${input.triggerSource ? ` (from ${describeSource(input.triggerSource)})` : ""}.`,
    ];
    if (input.triggerConfirmed === false) assumptions.push("The triggering date has not been confirmed by you yet.");
    if (secondaryRule) {
        assumptions.push(`${secondaryRule.commencement.note} Until it is confirmed, the shorter three-month deadline is shown as the deadline to work to.`);
    }
    if (input.jurisdiction === "scotland") {
        assumptions.push("The same Great Britain time-limit rules apply in Scotland. Scottish bank holidays are not checked; the non-working-day warning uses the England and Wales calendar.");
    }

    // Inconsistent Acas dates: never clamp, never present a date as calculated.
    if (primary.acas.outcome === "invalid") {
        return uncertain({
            triggerDescription: describeTrigger(primaryRule),
            warnings: [...primary.acas.warnings],
            missing: ["Consistent Acas dates: Day A (notification) on or before Day B (certificate received)."],
            assumptions,
        });
    }

    const warnings = [...primary.acas.warnings];
    if (precision && precision !== "exact") warnings.push(PRECISION_WARNING[precision]);
    if (primaryRule.triggeringEvent === "date_of_last_act") {
        warnings.push("If the treatment is continuing, time normally runs from the end of the last act. If you are unsure, treat the earliest possible date as the trigger.");
    }

    let secondary: DeadlineExplanation["secondary"] = null;
    if (secondaryRule) {
        const s = computeForRule(secondaryRule, acasIn, triggerDate, today);
        secondary = {
            label: `${secondaryRule.months}-month limit if the Employment Rights Act 2025 commencement is confirmed`,
            date: s.acas.finalDate,
            note: `${secondaryRule.commencement.note ?? ""}${s.acas.outcome === "pending" ? " Shown without the Acas extension, which cannot be worked out until Day B is known." : ""}`.trim(),
        };
    }

    const primarySource = citeSource(primaryRule.sourceKeys[0]);
    const source = { title: primarySource.title, reference: primarySource.reference, url: primarySource.url, version: primaryRule.version };

    // Pending conciliation: the extended limit is not calculable. Report the
    // unadjusted date only as a floor. Never "expired" while pending.
    if (primary.acas.outcome === "pending") {
        return {
            kind,
            label,
            calculatedDate: null,
            status: "pending_acas",
            ruleId: primaryRule.id,
            ruleVersion: primaryRule.version,
            daysRemaining: null,
            explanation: {
                triggerDate,
                triggerDescription: describeTrigger(primaryRule),
                trigger,
                assumptions,
                acasEffect: primary.acas.effect,
                acas: acasRecord(acasIn, "Conciliation is in progress: Day B is not yet known, so the extension cannot be calculated."),
                source,
                warnings,
                missingInformation: ["The date you received your Acas certificate (Day B)."],
                secondary,
                unadjusted: {
                    date: primary.base,
                    note: `Without Acas the limit would have expired on ${primary.base}. Because conciliation began before that date, the final deadline will be no earlier than ${primary.base}, but it cannot be worked out until the certificate date (Day B) is known.`,
                },
            },
        };
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

    const acasNote =
        primary.acas.outcome === "no_revival"
            ? "Conciliation began after the unadjusted limit had expired; s207B does not revive an expired limit."
            : primary.acas.outcome === "extended"
                ? acasIn.dayBBasis === "received"
                    ? "Day B is the date you received the certificate."
                    : acasIn.dayBBasis === "deemed_received"
                        ? "Day B is the date on the certificate: sent by email, so treated as received that day (SI 2014/254 rule 9)."
                        : "Day B has been taken as the date on the certificate because the receipt date is not recorded (conservative: the true deadline may be slightly later, never earlier)."
                : null;

    return {
        kind,
        label,
        calculatedDate: primary.acas.finalDate,
        status: primary.daysRemaining < 0 ? "expired" : "calculated",
        ruleId: primaryRule.id,
        ruleVersion: primaryRule.version,
        daysRemaining: primary.daysRemaining,
        explanation: {
            triggerDate,
            triggerDescription: describeTrigger(primaryRule),
            trigger,
            assumptions,
            acasEffect: primary.acas.effect,
            acas: acasRecord(acasIn, acasNote),
            source,
            warnings,
            missingInformation: [],
            secondary,
            unadjusted: null,
        },
    };
}

function describeSource(source: string): string {
    if (source.startsWith("structured_fact:")) return `the "${source.slice("structured_fact:".length).replace(/_/g, " ")}" date recorded on My case`;
    if (source === "employment.end_date") return "the employment end date on My case";
    if (source === "intake") return "your intake answers";
    return source.replace(/[_.]/g, " ");
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
