/**
 * Versioned time-limit rules.
 *
 * The engine never applies "the" tribunal time limit. It selects the rule
 * whose jurisdiction, claim family and effective-date window match the
 * triggering event, then applies that rule deterministically. Adding a new
 * commencement date is a new rule row with a new version, not an edit.
 *
 * F08: each rule's `commencement.confirmedBySI` is derived PER RULE from the
 * source register (src/legal/rules/register.ts): true only where the register
 * records `status: "commenced"` with a commencement instrument. There is no
 * blanket flag. A rule that is not confirmed never leads on its own: the
 * engine leads with the conservative (shorter) rule that preceded it.
 */

import { TIME_LIMIT_CONFIG, ERA_2025, formatCommencementDate, formatCommencementMonth } from "@/legal/era-2025";
import { isRuleCommenced, registerEntry } from "@/legal/rules/register";
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
const SCOTLAND_CONTRACT_COMMENCEMENT = ERA_2025.ET_TIME_LIMIT_6_MONTHS_SCOTLAND_CONTRACT;
const DAY_BEFORE_SCOTLAND_CONTRACT = addDays(SCOTLAND_CONTRACT_COMMENCEMENT, -1);
const GB: Jurisdiction[] = ["england_wales", "scotland"];
const EW: Jurisdiction[] = ["england_wales"];
const SCOT: Jurisdiction[] = ["scotland"];

const ERA_2025_NOTE = `The six-month limit under the Employment Rights Act 2025 is reported to start on ${formatCommencementDate(COMMENCEMENT)} (${formatCommencementMonth(COMMENCEMENT)}). The commencement instrument has not yet been verified against the source register. Exact commencement date to be confirmed by Statutory Instrument.`;
const SCOTLAND_CONTRACT_NOTE = `For breach-of-contract claims in Scotland the six-month limit is reported to start on ${formatCommencementDate(SCOTLAND_CONTRACT_COMMENCEMENT)}, by a separate instrument of the Scottish Ministers that has not been identified or verified. Exact commencement date to be confirmed by Statutory Instrument.`;

/** Derive a rule's commencement metadata from the register. */
function commencementFor(ruleId: string, unconfirmedNote: string | null): TimeLimitRule["commencement"] {
    const confirmed = isRuleCommenced(ruleId);
    return { confirmedBySI: confirmed, note: confirmed ? null : unconfirmedNote };
}

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
        commencement: commencementFor("ud_3m_pre_era2025", null),
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
        commencement: commencementFor("ud_6m_era2025", ERA_2025_NOTE),
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
        commencement: commencementFor("disc_3m_pre_era2025", null),
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
        commencement: commencementFor("disc_6m_era2025", ERA_2025_NOTE),
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
        commencement: commencementFor("pd_3m_pre_era2025", null),
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
        commencement: commencementFor("pd_6m_era2025", ERA_2025_NOTE),
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
        commencement: commencementFor("wages_3m_pre_era2025", null),
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
        commencement: commencementFor("wages_6m_era2025", ERA_2025_NOTE),
        plainDescription: "Six months less one day from the payday of the deduction (Employment Rights Act 2025).",
    },
    // ── Breach of contract (Extension of Jurisdiction Orders 1994) ─────
    // Before the assumed commencement the two 1994 Orders are identical and are
    // modelled as one GB rule (historical row, preserved). From 1 October 2026 the
    // reported amending instruments differ: the E&W (Amendment) Order 2026 is
    // reported to extend only to England and Wales; the Scottish Order is a matter
    // for the Scottish Ministers and is reported to change on 9 November 2026. Each
    // jurisdiction therefore has its own window. Neither six-month rule is
    // confirmed, so the three-month rule leads in both.
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
        commencement: commencementFor("boc_3m_pre_era2025", null),
        plainDescription: "Three months less one day from the effective date of termination (tribunal route; £25,000 cap).",
    },
    {
        id: "boc_ew_6m_era2025",
        version: "era2025-assumed",
        jurisdictions: EW,
        claimFamilies: ["breach_of_contract"],
        effectiveFrom: COMMENCEMENT,
        effectiveTo: null,
        triggeringEvent: "effective_date_of_termination",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["et_extension_of_jurisdiction_1994", "et_extension_of_jurisdiction_ew_amendment_2026", "era1996_s207b"],
        commencement: commencementFor("boc_ew_6m_era2025", ERA_2025_NOTE),
        plainDescription: "Six months less one day from the effective date of termination (England and Wales; Extension of Jurisdiction (Amendment) Order 2026).",
    },
    {
        // Scotland keeps the unamended 1994 Order until the reported Scottish change.
        id: "boc_scotland_3m_interim",
        version: "2014-04-06",
        jurisdictions: SCOT,
        claimFamilies: ["breach_of_contract"],
        effectiveFrom: COMMENCEMENT,
        effectiveTo: DAY_BEFORE_SCOTLAND_CONTRACT,
        triggeringEvent: "effective_date_of_termination",
        months: 3,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["et_extension_of_jurisdiction_scotland_1994", "era1996_s207b"],
        commencement: commencementFor("boc_scotland_3m_interim", null),
        plainDescription: "Three months less one day from the effective date of termination (Scotland; the 1994 Order is unchanged until the Scottish amendment takes effect).",
    },
    {
        id: "boc_scotland_6m_era2025",
        version: "era2025-assumed",
        jurisdictions: SCOT,
        claimFamilies: ["breach_of_contract"],
        effectiveFrom: SCOTLAND_CONTRACT_COMMENCEMENT,
        effectiveTo: null,
        triggeringEvent: "effective_date_of_termination",
        months: 6,
        beginningWith: true,
        acasExtensionApplies: true,
        extensionDiscretion: "not_reasonably_practicable",
        sourceKeys: ["et_extension_of_jurisdiction_scotland_1994", "govuk_era2025_timetable", "era1996_s207b"],
        commencement: commencementFor("boc_scotland_6m_era2025", SCOTLAND_CONTRACT_NOTE),
        plainDescription: "Six months less one day from the effective date of termination (Scotland; reported Scottish amendment to the 1994 Order).",
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
        commencement: commencementFor("redundancy_payment_6m", null),
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
        commencement: commencementFor("equal_pay_6m", null),
        plainDescription: "Six months beginning with the last day of employment (standard case).",
    },
];

export interface RuleSelection {
    rule: TimeLimitRule | null;
    /** Where the SI is unconfirmed, the conservative rule that would apply if the new regime is not yet in force. */
    conservativeRule: TimeLimitRule | null;
    reason: string;
    /** F08: the register status of the selected rule ("commenced", "announced", …) or null when no rule. */
    registerStatus: string | null;
}

/**
 * Pick the rule for a jurisdiction, claim family and trigger date. When the
 * matching rule's commencement is unconfirmed, also return the conservative
 * (shorter) rule that applied before it, so the engine can lead with the
 * shorter deadline.
 */
export function selectTimeLimitRule(jurisdiction: Jurisdiction, family: ClaimFamily, triggerDate: string): RuleSelection {
    if (jurisdiction === "northern_ireland") {
        return { rule: null, conservativeRule: null, registerStatus: null, reason: "Northern Ireland has a separate tribunal system (Industrial Tribunals and the Fair Employment Tribunal); its time limits are not yet modelled here." };
    }
    const candidates = TIME_LIMIT_RULES.filter(
        (r) => r.jurisdictions.includes(jurisdiction) && r.claimFamilies.includes(family) && triggerDate >= r.effectiveFrom && (r.effectiveTo === null || triggerDate <= r.effectiveTo),
    );
    const rule = candidates[0] ?? null;
    if (!rule) {
        return { rule: null, conservativeRule: null, registerStatus: null, reason: `No time-limit rule is registered for ${family} in this jurisdiction on ${triggerDate}.` };
    }
    let conservativeRule: TimeLimitRule | null = null;
    if (!rule.commencement.confirmedBySI) {
        conservativeRule =
            TIME_LIMIT_RULES.filter(
                (r) => r.id !== rule.id && r.jurisdictions.includes(jurisdiction) && r.claimFamilies.includes(family) && r.effectiveTo !== null && r.effectiveTo < rule.effectiveFrom,
            ).sort((a, b) => (a.effectiveTo! < b.effectiveTo! ? 1 : -1))[0] ?? null;
    }
    return { rule, conservativeRule, registerStatus: registerEntry(rule.id)?.status ?? null, reason: "ok" };
}

export function ruleById(id: string): TimeLimitRule | undefined {
    return TIME_LIMIT_RULES.find((r) => r.id === id);
}
