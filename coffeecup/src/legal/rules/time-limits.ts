/**
 * Versioned time-limit rules.
 *
 * The engine never applies "the" tribunal time limit. It selects the rule
 * whose jurisdiction, claim family and effective-date window match the
 * triggering event, then applies that rule deterministically. Adding a new
 * commencement date is a new rule row with a new version, not an edit.
 */

import { TIME_LIMIT_CONFIG, formatCommencementMonth } from "@/legal/era-2025";
import { addDays } from "@/lib/dates";
import type { Jurisdiction } from "@/db/schema";

export type ClaimFamily =
    | "unfair_dismissal"
    | "discrimination"
    | "whistleblowing_detriment"
    | "unlawful_deductions"
    | "breach_of_contract"
    | "redundancy_payment"
    | "equal_pay"
    | "general";

export type TriggeringEvent =
    | "effective_date_of_termination"
    | "date_of_last_act"
    | "date_of_deduction"
    | "relevant_date"
    | "last_day_of_employment";

export interface TimeLimitRule {
    id: string;
    version: string;
    jurisdictions: Jurisdiction[];
    claimFamilies: ClaimFamily[];
    /** Inclusive window on the triggering event date. null effectiveTo = open. */
    effectiveFrom: string;
    effectiveTo: string | null;
    triggeringEvent: TriggeringEvent;
    months: number;
    /** "less one day": period is N months beginning WITH the trigger date. */
    beginningWith: boolean;
    acasExtensionApplies: boolean;
    extensionDiscretion: "not_reasonably_practicable" | "just_and_equitable" | "none";
    sourceKeys: string[];
    commencement: { confirmedBySI: boolean; note: string | null };
    plainDescription: string;
}

const COMMENCEMENT = TIME_LIMIT_CONFIG.COMMENCEMENT_DATE;
const DAY_BEFORE_COMMENCEMENT = addDays(COMMENCEMENT, -1);
const GB: Jurisdiction[] = ["england_wales", "scotland"];

const ERA_2025_NOTE = `The six-month limit under the Employment Rights Act 2025 is assumed to start in ${formatCommencementMonth(COMMENCEMENT)}. Exact commencement date to be confirmed by Statutory Instrument.`;

export const TIME_LIMIT_RULES: TimeLimitRule[] = [
    // ── Unfair dismissal ────────────────────────────────────────────────
    {
        id: "ud_3m_pre_era2025",
        version: "2014-04-06",
        jurisdictions: GB,
        claimFamilies: ["unfair_dismissal"],
        effectiveFrom: "1996-08-22",
        effectiveTo: DAY_BEFORE_COMMENCEMENT,
        triggeringEvent: "effective_date_of_termination",
        months: 3,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["era1996_s111", "era1996_s207b"],
        commencement: { confirmedBySI: true, note: null },
        plainDescription: "Three months less one day from the effective date of termination.",
    },
    {
        id: "ud_6m_era2025",
        version: "era2025-assumed",
        jurisdictions: GB,
        claimFamilies: ["unfair_dismissal"],
        effectiveFrom: COMMENCEMENT,
        effectiveTo: null,
        triggeringEvent: "effective_date_of_termination",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["era1996_s111", "era2025_time_limits", "era1996_s207b"],
        commencement: { confirmedBySI: TIME_LIMIT_CONFIG.TIME_LIMIT_SI_CONFIRMED, note: ERA_2025_NOTE },
        plainDescription: "Six months less one day from the effective date of termination (Employment Rights Act 2025).",
    },
    // ── Discrimination (EA 2010) ────────────────────────────────────────
    {
        id: "disc_3m_pre_era2025",
        version: "2014-04-06",
        jurisdictions: GB,
        claimFamilies: ["discrimination"],
        effectiveFrom: "2010-10-01",
        effectiveTo: DAY_BEFORE_COMMENCEMENT,
        triggeringEvent: "date_of_last_act",
        months: 3,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "just_and_equitable",
        sourceKeys: ["ea2010_s123", "era1996_s207b"],
        commencement: { confirmedBySI: true, note: null },
        plainDescription: "Three months less one day from the act complained of (or the end of a continuing course of conduct).",
    },
    {
        id: "disc_6m_era2025",
        version: "era2025-assumed",
        jurisdictions: GB,
        claimFamilies: ["discrimination"],
        effectiveFrom: COMMENCEMENT,
        effectiveTo: null,
        triggeringEvent: "date_of_last_act",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "just_and_equitable",
        sourceKeys: ["ea2010_s123", "era2025_time_limits", "era1996_s207b"],
        commencement: { confirmedBySI: TIME_LIMIT_CONFIG.TIME_LIMIT_SI_CONFIRMED, note: ERA_2025_NOTE },
        plainDescription: "Six months less one day from the act complained of (Employment Rights Act 2025).",
    },
    // ── Whistleblowing detriment ────────────────────────────────────────
    {
        id: "pd_3m_pre_era2025",
        version: "2014-04-06",
        jurisdictions: GB,
        claimFamilies: ["whistleblowing_detriment"],
        effectiveFrom: "1999-07-02",
        effectiveTo: DAY_BEFORE_COMMENCEMENT,
        triggeringEvent: "date_of_last_act",
        months: 3,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["era1996_part_iva", "era1996_s207b"],
        commencement: { confirmedBySI: true, note: null },
        plainDescription: "Three months less one day from the detriment (or the last in a series).",
    },
    {
        id: "pd_6m_era2025",
        version: "era2025-assumed",
        jurisdictions: GB,
        claimFamilies: ["whistleblowing_detriment"],
        effectiveFrom: COMMENCEMENT,
        effectiveTo: null,
        triggeringEvent: "date_of_last_act",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["era1996_part_iva", "era2025_time_limits", "era1996_s207b"],
        commencement: { confirmedBySI: TIME_LIMIT_CONFIG.TIME_LIMIT_SI_CONFIRMED, note: ERA_2025_NOTE },
        plainDescription: "Six months less one day from the detriment (Employment Rights Act 2025).",
    },
    // ── Unlawful deductions from wages ──────────────────────────────────
    {
        id: "wages_3m_pre_era2025",
        version: "2014-04-06",
        jurisdictions: GB,
        claimFamilies: ["unlawful_deductions"],
        effectiveFrom: "1996-08-22",
        effectiveTo: DAY_BEFORE_COMMENCEMENT,
        triggeringEvent: "date_of_deduction",
        months: 3,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["era1996_s23", "era1996_s207b"],
        commencement: { confirmedBySI: true, note: null },
        plainDescription: "Three months less one day from the payday of the deduction (or the last in a series).",
    },
    {
        id: "wages_6m_era2025",
        version: "era2025-assumed",
        jurisdictions: GB,
        claimFamilies: ["unlawful_deductions"],
        effectiveFrom: COMMENCEMENT,
        effectiveTo: null,
        triggeringEvent: "date_of_deduction",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["era1996_s23", "era2025_time_limits", "era1996_s207b"],
        commencement: { confirmedBySI: TIME_LIMIT_CONFIG.TIME_LIMIT_SI_CONFIRMED, note: ERA_2025_NOTE },
        plainDescription: "Six months less one day from the payday of the deduction (Employment Rights Act 2025).",
    },
    // ── Breach of contract (Extension of Jurisdiction Orders 1994, E&W and Scotland) ──
    {
        id: "boc_3m_pre_era2025",
        version: "2014-04-06",
        jurisdictions: GB,
        claimFamilies: ["breach_of_contract"],
        effectiveFrom: "1994-07-12",
        effectiveTo: DAY_BEFORE_COMMENCEMENT,
        triggeringEvent: "effective_date_of_termination",
        months: 3,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["et_extension_of_jurisdiction_1994", "et_extension_of_jurisdiction_scotland_1994", "era1996_s207b"],
        commencement: { confirmedBySI: true, note: null },
        plainDescription: "Three months less one day from the effective date of termination (tribunal route; £25,000 cap).",
    },
    {
        id: "boc_6m_era2025",
        version: "era2025-assumed",
        jurisdictions: GB,
        claimFamilies: ["breach_of_contract"],
        effectiveFrom: COMMENCEMENT,
        effectiveTo: null,
        triggeringEvent: "effective_date_of_termination",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["et_extension_of_jurisdiction_1994", "et_extension_of_jurisdiction_scotland_1994", "era2025_time_limits", "era1996_s207b"],
        commencement: { confirmedBySI: TIME_LIMIT_CONFIG.TIME_LIMIT_SI_CONFIRMED, note: ERA_2025_NOTE },
        plainDescription: "Six months less one day from the effective date of termination (Employment Rights Act 2025).",
    },
    // ── Redundancy payment & equal pay (already six months) ─────────────
    {
        id: "redundancy_payment_6m",
        version: "1996-08-22",
        jurisdictions: GB,
        claimFamilies: ["redundancy_payment"],
        effectiveFrom: "1996-08-22",
        effectiveTo: null,
        triggeringEvent: "relevant_date",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "none",
        sourceKeys: ["era1996_s164", "era1996_s207b"],
        commencement: { confirmedBySI: true, note: null },
        plainDescription: "Six months beginning with the relevant date, provided one of the steps in s164(1) is taken.",
    },
    {
        id: "equal_pay_6m",
        version: "2010-10-01",
        jurisdictions: GB,
        claimFamilies: ["equal_pay"],
        effectiveFrom: "2010-10-01",
        effectiveTo: null,
        triggeringEvent: "last_day_of_employment",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "none",
        sourceKeys: ["ea2010_s129", "era1996_s207b"],
        commencement: { confirmedBySI: true, note: null },
        plainDescription: "Six months beginning with the last day of employment (standard case).",
    },
];

export interface RuleSelection {
    rule: TimeLimitRule | null;
    /** Where the SI is unconfirmed, the conservative rule that would apply if the new regime is not yet in force. */
    conservativeRule: TimeLimitRule | null;
    reason: string;
}

/**
 * Pick the rule for a jurisdiction, claim family and trigger date. When the
 * matching rule's commencement is unconfirmed, also return the conservative
 * (shorter) rule that applied before it, so the engine can lead with the
 * shorter deadline.
 */
export function selectTimeLimitRule(jurisdiction: Jurisdiction, family: ClaimFamily, triggerDate: string): RuleSelection {
    if (jurisdiction === "northern_ireland") {
        return { rule: null, conservativeRule: null, reason: "Northern Ireland has a separate tribunal system (Industrial Tribunals and the Fair Employment Tribunal); its time limits are not yet modelled here." };
    }
    const candidates = TIME_LIMIT_RULES.filter(
        (r) => r.jurisdictions.includes(jurisdiction) && r.claimFamilies.includes(family) && triggerDate >= r.effectiveFrom && (r.effectiveTo === null || triggerDate <= r.effectiveTo),
    );
    const rule = candidates[0] ?? null;
    if (!rule) {
        return { rule: null, conservativeRule: null, reason: `No time-limit rule is registered for ${family} in this jurisdiction on ${triggerDate}.` };
    }
    let conservativeRule: TimeLimitRule | null = null;
    if (!rule.commencement.confirmedBySI) {
        conservativeRule =
            TIME_LIMIT_RULES.filter(
                (r) => r.id !== rule.id && r.jurisdictions.includes(jurisdiction) && r.claimFamilies.includes(family) && r.effectiveTo !== null && r.effectiveTo < rule.effectiveFrom,
            ).sort((a, b) => (a.effectiveTo! < b.effectiveTo! ? 1 : -1))[0] ?? null;
    }
    return { rule, conservativeRule, reason: "ok" };
}

export function ruleById(id: string): TimeLimitRule | undefined {
    return TIME_LIMIT_RULES.find((r) => r.id === id);
}
