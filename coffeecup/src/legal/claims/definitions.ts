/**
 * Claim definitions — the legal elements of each Employment Tribunal cause of
 * action the product understands. Ported from the Tribunal Harness claim
 * schemas (docs/MIGRATION_FROM_TRIBUNAL_HARNESS.md); the form fields were
 * dropped and the legal tests were restated as discrete elements with keys,
 * so the claim engine can report element-by-element status.
 *
 * Every element cites registry source keys. No element carries a strength
 * score: the engine reports supported / potentially supported / disputed /
 * unsupported on current information / information missing / not applicable.
 */

import { ERA_2025, formatCommencementLabel, isCommencementTbc } from "@/legal/era-2025";
import type { ClaimFamily } from "@/legal/rules/time-limits";

export interface ClaimElementDefinition {
    key: string;
    label: string;
    plain: string;
    sourceKeys: string[];
    /** Structured fact keys that bear on this element (for deterministic checks and missing-info prompts). */
    factKeys?: string[];
    /** Deterministic evaluator id (see engine.ts). */
    deterministic?: "employment_status" | "qualifying_service" | "dismissal_recorded" | "acas_status";
}

export interface ClaimDefinition {
    id: string;
    label: string;
    plain: string;
    statute: string;
    family: ClaimFamily;
    /** Trigger tags: entry routes / issue categories that make this claim a candidate. */
    triggers: string[];
    requiresDismissal: boolean;
    requiresEmployeeStatus: boolean;
    /** Claim only exists for events on/after this date (ERA 2025 provisions). null = no restriction. */
    availableFrom: string | null;
    availableFromTbc: boolean;
    elements: ClaimElementDefinition[];
    sourceKeys: string[];
    alternatives: string[];
}

const EMPLOYEE = { key: "employee_status", label: "You were an employee", plain: "Only employees (not most workers or the self-employed) can bring this claim.", sourceKeys: ["era1996_s230"], factKeys: ["employment_status"], deterministic: "employment_status" as const };
const WORKER = { key: "worker_status", label: "You were a worker or employee", plain: "Workers as well as employees are protected.", sourceKeys: ["era1996_s230"], factKeys: ["employment_status"], deterministic: "employment_status" as const };
const DISMISSED = { key: "dismissal", label: "You were dismissed", plain: "Your employment ended by dismissal, expiry of a fixed term, or resignation in response to a fundamental breach (constructive dismissal).", sourceKeys: ["era1996_s95"], factKeys: ["dismissal_date", "effective_date_of_termination"], deterministic: "dismissal_recorded" as const };

export const CLAIM_DEFINITIONS: ClaimDefinition[] = [
    {
        id: "unfair_dismissal",
        label: "Unfair dismissal",
        plain: "Your employer dismissed you without a fair reason or without a fair process.",
        statute: "Employment Rights Act 1996, Part X (ss94–98)",
        family: "unfair_dismissal",
        triggers: ["dismissal", "redundancy", "disciplinary"],
        requiresDismissal: true,
        requiresEmployeeStatus: true,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["era1996_s94_98", "era1996_s108", "era1996_s111", "acas_code_2015"],
        alternatives: ["wrongful_dismissal", "whistleblowing"],
        elements: [
            EMPLOYEE,
            DISMISSED,
            { key: "qualifying_service", label: "You had enough continuous service", plain: "Two years for a dismissal before the ERA 2025 change, six months after it. No service is needed for automatically unfair reasons.", sourceKeys: ["era1996_s108", "era2025_qualifying_period"], factKeys: ["employment_start", "dismissal_date"], deterministic: "qualifying_service" },
            { key: "reason", label: "The employer's reason", plain: "The employer must show a potentially fair reason: capability, conduct, redundancy, illegality or some other substantial reason.", sourceKeys: ["era1996_s94_98"] },
            { key: "fairness", label: "Whether the employer acted reasonably", plain: "Was dismissal within the range of reasonable responses, and was a fair procedure followed?", sourceKeys: ["era1996_s94_98", "acas_code_2015"] },
        ],
    },
    {
        id: "wrongful_dismissal",
        label: "Wrongful dismissal (notice pay)",
        plain: "You were dismissed without the notice or notice pay your contract or the law required.",
        statute: "Common law breach of contract; ERA 1996 s86 (minimum notice)",
        family: "breach_of_contract",
        triggers: ["dismissal"],
        requiresDismissal: true,
        requiresEmployeeStatus: true,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["era1996_s86", "et_extension_of_jurisdiction_1994"],
        alternatives: ["unfair_dismissal"],
        elements: [
            EMPLOYEE,
            DISMISSED,
            { key: "notice_entitlement", label: "Your notice entitlement", plain: "The notice period in your contract, or the statutory minimum if longer.", sourceKeys: ["era1996_s86"], factKeys: ["employment_start", "dismissal_date"] },
            { key: "no_notice_given", label: "Notice was not given or paid", plain: "You were dismissed without working or being paid for that notice.", sourceKeys: ["era1996_s86"] },
            { key: "no_gross_misconduct", label: "No conduct justifying summary dismissal", plain: "An employer can dismiss without notice only for a fundamental breach by the employee (gross misconduct).", sourceKeys: ["era1996_s86"] },
        ],
    },
    {
        id: "direct_discrimination",
        label: "Direct discrimination",
        plain: "You were treated worse than someone else because of a protected characteristic.",
        statute: "Equality Act 2010, s13 and s39",
        family: "discrimination",
        triggers: ["discrimination"],
        requiresDismissal: false,
        requiresEmployeeStatus: false,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["ea2010_s13", "ea2010_s123"],
        alternatives: ["harassment", "victimisation", "indirect_discrimination"],
        elements: [
            { key: "protected_characteristic", label: "A protected characteristic", plain: "Age, disability, gender reassignment, marriage/civil partnership, pregnancy/maternity, race, religion or belief, sex, sexual orientation.", sourceKeys: ["ea2010_s4"] },
            { key: "less_favourable_treatment", label: "Less favourable treatment", plain: "You were treated worse than a real or hypothetical comparator in materially similar circumstances.", sourceKeys: ["ea2010_s13", "ea2010_s23"] },
            { key: "because_of", label: "Because of the characteristic", plain: "The characteristic was a reason for the treatment (it need not be the only reason).", sourceKeys: ["ea2010_s13", "ea2010_s136"] },
            { key: "employment_context", label: "In the course of employment", plain: "The treatment relates to recruitment, terms, promotion, dismissal or any other detriment at work.", sourceKeys: ["ea2010_s39"] },
        ],
    },
    {
        id: "indirect_discrimination",
        label: "Indirect discrimination",
        plain: "A rule or practice applied to everyone put people who share your characteristic, and you, at a disadvantage.",
        statute: "Equality Act 2010, s19",
        family: "discrimination",
        triggers: ["discrimination", "contract_change"],
        requiresDismissal: false,
        requiresEmployeeStatus: false,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["ea2010_s19", "ea2010_s123"],
        alternatives: ["direct_discrimination", "reasonable_adjustments"],
        elements: [
            { key: "pcp", label: "A provision, criterion or practice", plain: "A rule, policy or way of doing things applied to you.", sourceKeys: ["ea2010_s19"] },
            { key: "group_disadvantage", label: "Group disadvantage", plain: "The rule puts people who share your characteristic at a particular disadvantage compared with others.", sourceKeys: ["ea2010_s19"] },
            { key: "personal_disadvantage", label: "You were disadvantaged", plain: "The rule put you at that disadvantage.", sourceKeys: ["ea2010_s19"] },
            { key: "justification", label: "Whether the employer can justify it", plain: "The employer must show the rule is a proportionate means of achieving a legitimate aim.", sourceKeys: ["ea2010_s19"] },
        ],
    },
    {
        id: "harassment",
        label: "Harassment",
        plain: "Unwanted conduct related to a protected characteristic that violated your dignity or created a hostile environment.",
        statute: "Equality Act 2010, s26",
        family: "discrimination",
        triggers: ["discrimination"],
        requiresDismissal: false,
        requiresEmployeeStatus: false,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["ea2010_s26", "ea2010_s123"],
        alternatives: ["direct_discrimination", "victimisation"],
        elements: [
            { key: "unwanted_conduct", label: "Unwanted conduct", plain: "Behaviour you did not want.", sourceKeys: ["ea2010_s26"] },
            { key: "related_to_characteristic", label: "Related to a protected characteristic", plain: "The conduct was connected to a protected characteristic (yours or someone else's).", sourceKeys: ["ea2010_s26", "ea2010_s4"] },
            { key: "purpose_or_effect", label: "Purpose or effect", plain: "It had the purpose or effect of violating your dignity or creating an intimidating, hostile, degrading, humiliating or offensive environment.", sourceKeys: ["ea2010_s26"] },
            { key: "reasonableness", label: "Reasonable for it to have that effect", plain: "Taking into account your perception, the circumstances and whether it was reasonable for the conduct to have that effect.", sourceKeys: ["ea2010_s26"] },
        ],
    },
    {
        id: "victimisation",
        label: "Victimisation",
        plain: "You were treated badly because you complained about discrimination or supported someone who did.",
        statute: "Equality Act 2010, s27",
        family: "discrimination",
        triggers: ["discrimination", "grievance"],
        requiresDismissal: false,
        requiresEmployeeStatus: false,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["ea2010_s27", "ea2010_s123"],
        alternatives: ["direct_discrimination", "whistleblowing"],
        elements: [
            { key: "protected_act", label: "A protected act", plain: "You made or supported a complaint or allegation under the Equality Act, or gave evidence in such a case.", sourceKeys: ["ea2010_s27"] },
            { key: "detriment", label: "A detriment", plain: "You were subjected to something a reasonable worker would consider a disadvantage.", sourceKeys: ["ea2010_s27"] },
            { key: "because_of_protected_act", label: "Because of the protected act", plain: "The protected act was a reason for the detriment.", sourceKeys: ["ea2010_s27", "ea2010_s136"] },
        ],
    },
    {
        id: "reasonable_adjustments",
        label: "Failure to make reasonable adjustments",
        plain: "Your employer did not make reasonable changes to remove a disadvantage caused by your disability.",
        statute: "Equality Act 2010, ss20–21 and Schedule 8",
        family: "discrimination",
        triggers: ["disability_adjustments", "discrimination"],
        requiresDismissal: false,
        requiresEmployeeStatus: false,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["ea2010_s20_21", "ea2010_s6", "ea2010_s123"],
        alternatives: ["discrimination_arising_from_disability", "indirect_discrimination"],
        elements: [
            { key: "disability", label: "You have a disability", plain: "A physical or mental impairment with a substantial, long-term effect on day-to-day activities.", sourceKeys: ["ea2010_s6"] },
            { key: "employer_knowledge", label: "The employer knew or should have known", plain: "The employer knew, or could reasonably be expected to know, about the disability and the disadvantage.", sourceKeys: ["ea2010_s20_21"] },
            { key: "substantial_disadvantage", label: "A substantial disadvantage", plain: "A rule, physical feature or lack of an aid put you at a substantial disadvantage compared with non-disabled people.", sourceKeys: ["ea2010_s20_21"] },
            { key: "reasonable_steps_not_taken", label: "Reasonable steps were not taken", plain: "There were reasonable adjustments the employer failed to make.", sourceKeys: ["ea2010_s20_21"] },
        ],
    },
    {
        id: "whistleblowing",
        label: "Whistleblowing (protected disclosure)",
        plain: "You were treated badly or dismissed because you raised a concern about wrongdoing.",
        statute: "Employment Rights Act 1996, Part IVA, s47B and s103A",
        family: "whistleblowing_detriment",
        triggers: ["whistleblowing", "dismissal"],
        requiresDismissal: false,
        requiresEmployeeStatus: false,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["era1996_part_iva"],
        alternatives: ["unfair_dismissal", "victimisation"],
        elements: [
            WORKER,
            { key: "disclosure_of_information", label: "You disclosed information", plain: "You conveyed facts, not just an allegation or an expression of opinion.", sourceKeys: ["era1996_part_iva"] },
            { key: "qualifying_disclosure", label: "A qualifying disclosure", plain: `You reasonably believed it showed a criminal offence, breach of a legal obligation, miscarriage of justice, danger to health and safety, environmental damage or a cover-up (or, from ${formatCommencementLabel(ERA_2025.SEXUAL_HARASSMENT_WHISTLEBLOWING, isCommencementTbc("SEXUAL_HARASSMENT_WHISTLEBLOWING"))}, sexual harassment), and that disclosure was in the public interest.`, sourceKeys: ["era1996_part_iva"] },
            { key: "protected_disclosure", label: "Made to the right person", plain: "Usually your employer, or another prescribed person.", sourceKeys: ["era1996_part_iva"] },
            { key: "detriment_or_dismissal", label: "Detriment or dismissal", plain: "You suffered a detriment, or were dismissed.", sourceKeys: ["era1996_part_iva"], factKeys: ["date_of_last_act", "dismissal_date"] },
            { key: "causation", label: "Because of the disclosure", plain: "The disclosure materially influenced the detriment, or was the principal reason for dismissal.", sourceKeys: ["era1996_part_iva"] },
        ],
    },
    {
        id: "unlawful_deductions",
        label: "Unlawful deduction from wages",
        plain: "You were paid less than you were owed, or money was taken from your pay without authority.",
        statute: "Employment Rights Act 1996, s13 and s23",
        family: "unlawful_deductions",
        triggers: ["pay"],
        requiresDismissal: false,
        requiresEmployeeStatus: false,
        availableFrom: null,
        availableFromTbc: false,
        sourceKeys: ["era1996_s13", "era1996_s23"],
        alternatives: ["wrongful_dismissal"],
        elements: [
            WORKER,
            { key: "wages_properly_payable", label: "Wages were properly payable", plain: "You were entitled to the amount under your contract or statute.", sourceKeys: ["era1996_s13"] },
            { key: "deduction_made", label: "A deduction was made", plain: "You received less than the amount properly payable.", sourceKeys: ["era1996_s13"], factKeys: ["date_of_deduction"] },
            { key: "not_authorised", label: "The deduction was not authorised", plain: "It was not required by statute, permitted by a written contract term, or agreed by you in writing beforehand.", sourceKeys: ["era1996_s13"] },
        ],
    },
    {
        id: "fire_and_rehire",
        label: "Dismissal for refusing a contract change (fire and rehire)",
        plain: "You were dismissed because you would not agree to a change in your terms.",
        statute: "Employment Rights Act 2025 (automatically unfair dismissal for refusing a variation)",
        family: "unfair_dismissal",
        triggers: ["contract_change", "dismissal"],
        requiresDismissal: true,
        requiresEmployeeStatus: true,
        availableFrom: ERA_2025.FIRE_AND_REHIRE_AUTO_UNFAIR,
        availableFromTbc: isCommencementTbc("FIRE_AND_REHIRE_AUTO_UNFAIR"),
        sourceKeys: ["era2025_fire_and_rehire", "era1996_s94_98"],
        alternatives: ["unfair_dismissal"],
        elements: [
            EMPLOYEE,
            DISMISSED,
            { key: "reason_refusal_of_variation", label: "The reason was your refusal to accept a variation", plain: "You were dismissed because you did not agree to new terms (or to allow replacement with someone on new terms).", sourceKeys: ["era2025_fire_and_rehire"] },
            { key: "no_financial_distress_exception", label: "No financial-distress exception", plain: "The employer cannot show the variation was needed to avoid or reduce severe financial difficulties threatening its viability.", sourceKeys: ["era2025_fire_and_rehire"] },
        ],
    },
    {
        id: "zero_hours_rights",
        label: "Zero-hours contract rights",
        plain: "Rights to guaranteed hours, notice of shifts and payment for cancelled shifts.",
        statute: "Employment Rights Act 2025 (zero-hours provisions; commencement to be confirmed)",
        family: "general",
        triggers: ["contract_change", "pay"],
        requiresDismissal: false,
        requiresEmployeeStatus: false,
        availableFrom: ERA_2025.ZERO_HOURS_PROTECTIONS,
        availableFromTbc: true,
        sourceKeys: ["era2025_zero_hours"],
        alternatives: ["unlawful_deductions"],
        elements: [
            WORKER,
            { key: "zero_or_low_hours", label: "You were on a zero-hours or low-hours arrangement", plain: "Your contract guaranteed no or few hours.", sourceKeys: ["era2025_zero_hours"] },
            { key: "right_engaged", label: "A right was engaged", plain: "A guaranteed-hours offer was due, or a shift was changed or cancelled at short notice.", sourceKeys: ["era2025_zero_hours"] },
        ],
    },
];

const byId = new Map(CLAIM_DEFINITIONS.map((c) => [c.id, c]));

export function claimDefinition(id: string): ClaimDefinition | undefined {
    return byId.get(id);
}
