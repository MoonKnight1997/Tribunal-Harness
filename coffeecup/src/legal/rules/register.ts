/**
 * Source-to-rule register.
 *
 * Every rule the deadline engine (or the qualifying-period / tracker code)
 * relies on has one entry here recording the exact provision, the instrument,
 * its commencement position and how — and when — that position was verified.
 *
 * The register is the ONLY place a rule may be marked as commenced. A time-limit
 * rule's `commencement.confirmedBySI` is derived from `status === "commenced"`
 * together with a `commencementInstrument`, per rule. Nothing in this file may be
 * upgraded to "commenced" from a policy timetable, a law-firm bulletin or a
 * search-engine snippet: only from the made instrument itself, retrieved and
 * read (verification.method === "fetched") or a prior reviewed retrieval that is
 * recorded in docs/improvement-2026-09/SOURCE_VERIFICATION_REGISTER.md.
 *
 * Statuses
 *   commenced               — provision is in force (or its commencement day is fixed
 *                             by a made instrument that has been read); the
 *                             commencementInstrument is mandatory.
 *   made_not_yet_commenced  — an instrument fixing the day has been made and read,
 *                             but the day is in the future.
 *   announced               — a government statement or secondary source gives a
 *                             date; no instrument has been read. The engine treats
 *                             the rule as unconfirmed (conservative rule leads).
 *   assumed                 — the product's own working assumption; no source.
 *
 * This module is deliberately import-free (data only) so that both
 * `src/legal/era-2025.ts` and `src/legal/rules/time-limits.ts` can derive from
 * it without an import cycle.
 */

export type RuleStatus = "commenced" | "made_not_yet_commenced" | "announced" | "assumed";
export type VerificationMethod = "fetched" | "unreachable" | "not_attempted";
export type RegisterJurisdiction = "england_wales" | "scotland" | "great_britain";

export interface CommencementInstrument {
    title: string;
    /** SI number ("2026/3") or chapter ("2025 c. 36"). */
    siNumber: string;
    url: string;
    /** The regulation / section that fixes the day. */
    regulation: string;
}

export interface RuleVerification {
    /** ISO datetime of the retrieval attempt this entry rests on. */
    retrievedAt: string;
    url: string;
    method: VerificationMethod;
    /** What was (or was not) retrieved, HTTP status, and any secondary leads. */
    note: string;
}

export interface RuleRegisterEntry {
    /** Matches TIME_LIMIT_RULES[].id, or another rule / commencement key. */
    ruleId: string;
    provision: string;
    instrument: string;
    jurisdiction: RegisterJurisdiction[];
    effectiveFrom: string;
    effectiveTo: string | null;
    /** Plain-English predicate for when the rule applies. */
    transition: string;
    status: RuleStatus;
    commencementInstrument?: CommencementInstrument;
    verification: RuleVerification;
    /** Test names (file :: test) that prove the boundary. */
    tests: string[];
    /** Secondary leads that were NOT verified against an instrument. Never used to change behaviour. */
    unverifiedLeads?: string[];
}

/**
 * The retrieval session this register was last worked on. Every entry below
 * that says `method: "unreachable"` was attempted in this session: the agent
 * proxy answered 403 to CONNECT for legislation.gov.uk, gov.uk, acas.org.uk,
 * parliament.uk hosts and the National Archives web archive, and the WebFetch
 * tool reported EGRESS_BLOCKED for the same hosts and for every secondary host
 * tried. See docs/improvement-2026-09/SOURCE_VERIFICATION_REGISTER.md.
 */
export const REGISTER_SESSION = {
    retrievedAt: "2026-09-27T00:06:25Z",
    outcome: "No primary source could be retrieved (network egress blocked). Search-index snippets only; treated as leads.",
} as const;

const UNREACHABLE = (url: string, note: string): RuleVerification => ({
    retrievedAt: REGISTER_SESSION.retrievedAt,
    url,
    method: "unreachable",
    note: `HTTP CONNECT refused (403) by the egress proxy; WebFetch: EGRESS_BLOCKED. ${note}`,
});

const LEG = "https://www.legislation.gov.uk";
const GOVUK_TIMETABLE = "https://www.gov.uk/government/publications/implementing-the-plan-to-make-work-pay-and-employment-rights-act/plan-to-make-work-pay-and-employment-rights-act-timeline-update";

/** Working assumption for the ERA 2025 six-month limit (GB). */
export const ASSUMED_TIME_LIMIT_COMMENCEMENT = "2026-10-01";
/** Date reported (unverified) for the Scottish contract-claims change. */
export const REPORTED_SCOTLAND_CONTRACT_CLAIMS_COMMENCEMENT = "2026-11-09";
const DAY_BEFORE_ASSUMED = "2026-09-30";
const DAY_BEFORE_REPORTED_SCOTLAND = "2026-11-08";

const ERA_2025_TIME_LIMIT_LEADS = [
    "Search-index snippet (legislation.gov.uk annotations): Schedule 12 paragraphs 'in force by S.I. 2026/954 reg. 3' — instrument title, made date and text NOT retrieved.",
    "Search-index snippet (Thompsons Solicitors, weekly issue 908): 'Section 152 ... together with Schedule 12, will extend the time limit ... from three months to six months.'",
    "Search-index snippet (multiple law-firm bulletins, gov.uk timetable as reported): six-month limit takes effect 1 October 2026 for acts/EDTs on or after that date; series of acts → last act.",
    "Search-index snippet: The Employment Tribunal (Extension of Time Limits) (Miscellaneous Amendments and Transitional Provisions) Regulations 2026, reported as SI 2026/758, in force 1 October 2026, reg 10 transitional (act or failure on or after 1 October 2026) — amends seven other SIs, not ERA 1996 itself.",
];

export const LEGAL_RULE_REGISTER: RuleRegisterEntry[] = [
    // ── Unfair dismissal ────────────────────────────────────────────────
    {
        ruleId: "ud_3m_pre_era2025",
        provision: "Employment Rights Act 1996, s111(2)(a)–(b)",
        instrument: "Employment Rights Act 1996 (1996 c. 18)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "1996-08-22",
        effectiveTo: DAY_BEFORE_ASSUMED,
        transition: "Applies where the effective date of termination is before the (unconfirmed) ERA 2025 commencement; while that commencement is unconfirmed this rule also leads for later EDTs as the conservative rule.",
        status: "commenced",
        commencementInstrument: { title: "Employment Rights Act 1996, s243 (commencement)", siNumber: "1996 c. 18", url: `${LEG}/ukpga/1996/18/section/243`, regulation: "s243" },
        verification: UNREACHABLE(`${LEG}/ukpga/1996/18/section/111`, "Long-standing consolidated provision; last read at the 2026-09-24 review recorded in the registry."),
        tests: ["time-limits.test.ts :: E&W unfair dismissal: EDT 2026-09-30 selects the three-month rule with no conservative fallback"],
    },
    {
        ruleId: "ud_6m_era2025",
        provision: "Employment Rights Act 1996, s111(2) as amended by Employment Rights Act 2025, s152 and Sch 12 (section/schedule numbers reported by secondary sources; not verified against the Act text)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: ASSUMED_TIME_LIMIT_COMMENCEMENT,
        effectiveTo: null,
        transition: "Reported: applies where the effective date of termination is on or after 1 October 2026. Transitional/saving text of the commencement instrument NOT read; treatment of periods already running at commencement unknown.",
        status: "announced",
        verification: UNREACHABLE(`${LEG}/ukpga/2025/36/contents`, "Neither the Act nor any commencement regulations could be retrieved. No commencement instrument is recorded; the rule stays unconfirmed and the three-month rule leads."),
        tests: ["time-limits.test.ts :: E&W unfair dismissal: EDT 2026-10-01 leads with the three-month rule while the ERA 2025 commencement is unverified"],
        unverifiedLeads: ERA_2025_TIME_LIMIT_LEADS,
    },
    // ── Discrimination ──────────────────────────────────────────────────
    {
        ruleId: "disc_3m_pre_era2025",
        provision: "Equality Act 2010, s123(1)(a)",
        instrument: "Equality Act 2010 (2010 c. 15)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2010-10-01",
        effectiveTo: DAY_BEFORE_ASSUMED,
        transition: "Applies where the act complained of (or the end of conduct extending over a period, s123(3)(a)) is before the unconfirmed ERA 2025 commencement; leads as the conservative rule afterwards.",
        status: "commenced",
        commencementInstrument: { title: "The Equality Act 2010 (Commencement No. 4, Savings, Consequential, Transitional, Transitory and Incidental Provisions and Revocation) Order 2010", siNumber: "2010/2317", url: `${LEG}/uksi/2010/2317/contents/made`, regulation: "art 2" },
        verification: UNREACHABLE(`${LEG}/ukpga/2010/15/section/123`, "Long-standing provision; last read at the 2026-09-24 review."),
        tests: ["time-limits.test.ts :: E&W discrimination: last act 2026-09-30 selects the three-month rule with no conservative fallback"],
    },
    {
        ruleId: "disc_6m_era2025",
        provision: "Equality Act 2010, s123(1)(a) as amended by Employment Rights Act 2025, s152 and Sch 12 (reported)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: ASSUMED_TIME_LIMIT_COMMENCEMENT,
        effectiveTo: null,
        transition: "Reported: applies where the act complained of (or the last act in a series) occurs on or after 1 October 2026. Commencement instrument not read.",
        status: "announced",
        verification: UNREACHABLE(`${LEG}/ukpga/2025/36/contents`, "As for ud_6m_era2025."),
        tests: ["time-limits.test.ts :: E&W discrimination: last act 2026-10-01 leads with the three-month rule while the ERA 2025 commencement is unverified"],
        unverifiedLeads: ERA_2025_TIME_LIMIT_LEADS,
    },
    // ── Whistleblowing detriment ────────────────────────────────────────
    {
        ruleId: "pd_3m_pre_era2025",
        provision: "Employment Rights Act 1996, s48(3)(a)",
        instrument: "Employment Rights Act 1996 (1996 c. 18) as amended by the Public Interest Disclosure Act 1998",
        jurisdiction: ["great_britain"],
        effectiveFrom: "1999-07-02",
        effectiveTo: DAY_BEFORE_ASSUMED,
        transition: "Applies where the act or failure to act (or the last in a series) is before the unconfirmed ERA 2025 commencement; leads as the conservative rule afterwards.",
        status: "commenced",
        commencementInstrument: { title: "The Public Interest Disclosure Act 1998 (Commencement) Order 1999", siNumber: "1999/1547", url: `${LEG}/uksi/1999/1547/made`, regulation: "art 2" },
        verification: UNREACHABLE(`${LEG}/ukpga/1996/18/section/48`, "Long-standing provision; last read at the 2026-09-24 review."),
        tests: ["time-limits.test.ts :: whistleblowing detriment follows the same boundary"],
    },
    {
        ruleId: "pd_6m_era2025",
        provision: "Employment Rights Act 1996, s48(3)(a) as amended by Employment Rights Act 2025, s152 and Sch 12 (reported)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: ASSUMED_TIME_LIMIT_COMMENCEMENT,
        effectiveTo: null,
        transition: "Reported: applies where the detriment (or the last in a series) occurs on or after 1 October 2026. Commencement instrument not read.",
        status: "announced",
        verification: UNREACHABLE(`${LEG}/ukpga/2025/36/contents`, "As for ud_6m_era2025."),
        tests: ["time-limits.test.ts :: whistleblowing detriment follows the same boundary"],
        unverifiedLeads: ERA_2025_TIME_LIMIT_LEADS,
    },
    // ── Unlawful deductions ─────────────────────────────────────────────
    {
        ruleId: "wages_3m_pre_era2025",
        provision: "Employment Rights Act 1996, s23(2)–(3)",
        instrument: "Employment Rights Act 1996 (1996 c. 18)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "1996-08-22",
        effectiveTo: DAY_BEFORE_ASSUMED,
        transition: "Applies where the payday of the deduction (or the last in a series) is before the unconfirmed ERA 2025 commencement; leads as the conservative rule afterwards.",
        status: "commenced",
        commencementInstrument: { title: "Employment Rights Act 1996, s243 (commencement)", siNumber: "1996 c. 18", url: `${LEG}/ukpga/1996/18/section/243`, regulation: "s243" },
        verification: UNREACHABLE(`${LEG}/ukpga/1996/18/section/23`, "Long-standing provision; last read at the 2026-09-24 review."),
        tests: ["time-limits.test.ts :: wages deductions: payday 2026-09-30 selects the three-month rule; payday 2026-10-01 leads with it conservatively"],
    },
    {
        ruleId: "wages_6m_era2025",
        provision: "Employment Rights Act 1996, s23(2) as amended by Employment Rights Act 2025, s152 and Sch 12 (reported)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: ASSUMED_TIME_LIMIT_COMMENCEMENT,
        effectiveTo: null,
        transition: "Reported: applies where the payday of the deduction (or the last in a series) is on or after 1 October 2026. Commencement instrument not read.",
        status: "announced",
        verification: UNREACHABLE(`${LEG}/ukpga/2025/36/contents`, "As for ud_6m_era2025."),
        tests: ["time-limits.test.ts :: wages deductions: payday 2026-09-30 selects the three-month rule; payday 2026-10-01 leads with it conservatively"],
        unverifiedLeads: ERA_2025_TIME_LIMIT_LEADS,
    },
    // ── Breach of contract ──────────────────────────────────────────────
    {
        ruleId: "boc_3m_pre_era2025",
        provision: "Employment Tribunals Extension of Jurisdiction (England and Wales) Order 1994, art 7; Employment Tribunals Extension of Jurisdiction (Scotland) Order 1994, art 7",
        instrument: "SI 1994/1623 and SI 1994/1624",
        jurisdiction: ["england_wales", "scotland"],
        effectiveFrom: "1994-07-12",
        effectiveTo: DAY_BEFORE_ASSUMED,
        transition: "Applies where the effective date of termination is before 1 October 2026 (both Orders). From 1 October 2026 the two jurisdictions are modelled separately because the reported amending instruments differ.",
        status: "commenced",
        commencementInstrument: { title: "Employment Tribunals Extension of Jurisdiction (England and Wales) Order 1994, art 1; (Scotland) Order 1994, art 1", siNumber: "1994/1623; 1994/1624", url: `${LEG}/uksi/1994/1623/article/1/made`, regulation: "art 1 (in force 12 July 1994)" },
        verification: UNREACHABLE(`${LEG}/uksi/1994/1623/article/7/made`, "Long-standing provision; last read at the 2026-09-24 review."),
        tests: ["time-limits.test.ts :: breach of contract before 1 October 2026 uses the single GB rule in both jurisdictions"],
    },
    {
        ruleId: "boc_ew_6m_era2025",
        provision: "Employment Tribunals Extension of Jurisdiction (England and Wales) Order 1994, art 7 as amended by the Employment Tribunals Extension of Jurisdiction (England and Wales) (Amendment) Order 2026 (reported)",
        instrument: "The Employment Tribunals Extension of Jurisdiction (England and Wales) (Amendment) Order 2026 (reported as SI 2026/759; draft ISBN 9780348282832)",
        jurisdiction: ["england_wales"],
        effectiveFrom: ASSUMED_TIME_LIMIT_COMMENCEMENT,
        effectiveTo: null,
        transition: "Reported: applies where the effective date of termination is on or after 1 October 2026 in England and Wales. Made instrument not read; no commencement recorded, so the three-month rule leads.",
        status: "announced",
        verification: UNREACHABLE(`${LEG}/ukdsi/2026/9780348282832`, "Draft affirmative instrument approved by both Houses (reported: Commons division 1 July 2026). Made SI number 2026/759 appears only in a search snippet."),
        tests: ["time-limits.test.ts :: E&W breach of contract: EDT 2026-10-01 leads with the three-month rule while the amending Order is unverified"],
        unverifiedLeads: [
            "Search-index snippet: 'This Order comes into force on 1st October 2026' and 'applies only to England and Wales ... the power to amend the equivalent Scottish legislation rests with Scottish Ministers'.",
        ],
    },
    {
        ruleId: "boc_scotland_3m_interim",
        provision: "Employment Tribunals Extension of Jurisdiction (Scotland) Order 1994, art 7",
        instrument: "SI 1994/1624",
        jurisdiction: ["scotland"],
        effectiveFrom: ASSUMED_TIME_LIMIT_COMMENCEMENT,
        effectiveTo: DAY_BEFORE_REPORTED_SCOTLAND,
        transition: "Scotland only: the unamended three-month limit continues to apply to EDTs from 1 October 2026 until the reported Scottish amendment (9 November 2026) — the E&W Amendment Order does not extend to Scotland.",
        status: "commenced",
        commencementInstrument: { title: "Employment Tribunals Extension of Jurisdiction (Scotland) Order 1994, art 1", siNumber: "1994/1624", url: `${LEG}/uksi/1994/1624/article/1/made`, regulation: "art 1 (in force 12 July 1994)" },
        verification: UNREACHABLE(`${LEG}/uksi/1994/1624/article/7/made`, "Long-standing provision; last read at the 2026-09-24 review. Its continuation past 1 October 2026 rests on the reported non-extension of the E&W Order to Scotland."),
        tests: ["time-limits.test.ts :: Scotland breach of contract: EDT 2026-10-01 and 2026-11-08 apply the unamended three-month Scottish Order with no six-month alternative"],
    },
    {
        ruleId: "boc_scotland_6m_era2025",
        provision: "Employment Tribunals Extension of Jurisdiction (Scotland) Order 1994, art 7 as expected to be amended by an instrument of the Scottish Ministers (not identified)",
        instrument: "Not identified — no Scottish statutory instrument title or number located",
        jurisdiction: ["scotland"],
        effectiveFrom: REPORTED_SCOTLAND_CONTRACT_CLAIMS_COMMENCEMENT,
        effectiveTo: null,
        transition: "Reported (gov.uk timetable, as relayed by secondary sources): six months for Scottish contract claims where the EDT is on or after 9 November 2026. No instrument read; the three-month rule leads.",
        status: "announced",
        verification: UNREACHABLE(GOVUK_TIMETABLE, "gov.uk timetable not retrievable. Date appears only in search snippets of secondary commentary."),
        tests: ["time-limits.test.ts :: Scotland breach of contract: EDT 2026-11-09 leads with the three-month rule while the Scottish commencement is unresolved"],
        unverifiedLeads: ["Search-index snippet: 'For breach of employment contract claims in Scotland the change will take place on 9 November 2026.'"],
    },
    // ── Redundancy payment & equal pay (unchanged) ─────────────────────
    {
        ruleId: "redundancy_payment_6m",
        provision: "Employment Rights Act 1996, s164(1)",
        instrument: "Employment Rights Act 1996 (1996 c. 18)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "1996-08-22",
        effectiveTo: null,
        transition: "Six months beginning with the relevant date, subject to one of the s164(1) steps. Not affected by the reported ERA 2025 time-limit changes.",
        status: "commenced",
        commencementInstrument: { title: "Employment Rights Act 1996, s243 (commencement)", siNumber: "1996 c. 18", url: `${LEG}/ukpga/1996/18/section/243`, regulation: "s243" },
        verification: UNREACHABLE(`${LEG}/ukpga/1996/18/section/164`, "Long-standing provision; last read at the 2026-09-24 review."),
        tests: ["time-limits.test.ts :: redundancy payment and equal pay rules are unchanged across the boundary"],
    },
    {
        ruleId: "equal_pay_6m",
        provision: "Equality Act 2010, s129(3) (standard case)",
        instrument: "Equality Act 2010 (2010 c. 15)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2010-10-01",
        effectiveTo: null,
        transition: "Six months beginning with the last day of employment. Not affected by the reported ERA 2025 time-limit changes.",
        status: "commenced",
        commencementInstrument: { title: "The Equality Act 2010 (Commencement No. 4, Savings, Consequential, Transitional, Transitory and Incidental Provisions and Revocation) Order 2010", siNumber: "2010/2317", url: `${LEG}/uksi/2010/2317/contents/made`, regulation: "art 2" },
        verification: UNREACHABLE(`${LEG}/ukpga/2010/15/section/129`, "Long-standing provision; last read at the 2026-09-24 review."),
        tests: ["time-limits.test.ts :: redundancy payment and equal pay rules are unchanged across the boundary"],
    },
    // ── Qualifying period ───────────────────────────────────────────────
    {
        ruleId: "qualifying_period_2y",
        provision: "Employment Rights Act 1996, s108(1) (two years)",
        instrument: "The Unfair Dismissal and Statement of Reasons for Dismissal (Variation of Qualifying Period) Order 2012",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2012-04-06",
        effectiveTo: "2026-12-31",
        transition: "Applies to dismissals with an effective date of termination before 1 January 2027 (the reported commencement of the ERA 2025 six-month period).",
        status: "commenced",
        commencementInstrument: { title: "The Unfair Dismissal and Statement of Reasons for Dismissal (Variation of Qualifying Period) Order 2012", siNumber: "2012/989", url: `${LEG}/uksi/2012/989/made`, regulation: "art 1–2" },
        verification: UNREACHABLE(`${LEG}/ukpga/1996/18/section/108`, "Long-standing provision; last read at the 2026-09-24 review."),
        tests: ["qualifying-period.test.ts (retained)"],
    },
    {
        ruleId: "QUALIFYING_PERIOD_6_MONTHS",
        provision: "Employment Rights Act 2025, s25 and Sch 3 (reported)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2027-01-01",
        effectiveTo: null,
        transition: "Reported: applies to dismissals with an effective date of termination on or after 1 January 2027. Transitional text not read.",
        status: "announced",
        verification: UNREACHABLE(`${LEG}/uksi/2026/559/made`, "The Employment Rights Act 2025 (Commencement No. 4 and Transitional and Saving Provisions) Regulations 2026 (SI 2026/559) is reported by search snippets to commence s25 and Sch 3 with the remainder in force on 1 January 2027, and paragraph 5 of Sch 3 on 1 July 2026. Instrument not retrieved, so the status stays 'announced'."),
        tests: ["era-2025.test.ts :: tracker/register consistency"],
        unverifiedLeads: ["Search-index snippet (legislation.gov.uk explanatory note): 'These Regulations commence section 25 of, and Schedule 3 to, the Employment Rights Act 2025 ... with the remainder coming into force on 1st January 2027.'"],
    },
    // ── Other commencement keys tracked in the UI ──────────────────────
    {
        ruleId: "HARASSMENT_ALL_REASONABLE_STEPS",
        provision: "Equality Act 2010, s109(4) as amended by Employment Rights Act 2025 (section not verified)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2026-10-01",
        effectiveTo: null,
        transition: "Code stores 1 October 2026 (assumed). The government timetable as reported gives 30 October 2026. Neither the timetable nor any commencement instrument could be retrieved. Date under review.",
        status: "assumed",
        verification: UNREACHABLE(GOVUK_TIMETABLE, "Timetable not retrievable; 30 October 2026 appears in search snippets of CMS, CIPD, Blake Morgan and Squire Patton Boggs bulletins."),
        tests: ["era-2025.test.ts :: tracker/register consistency"],
        unverifiedLeads: ["Search-index snippet: 'From 30 October 2026, employers will be required to take all reasonable steps to prevent sexual harassment'."],
    },
    {
        ruleId: "THIRD_PARTY_HARASSMENT",
        provision: "Equality Act 2010, s40 (new third-party liability) as amended by Employment Rights Act 2025 (section not verified)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2026-10-01",
        effectiveTo: null,
        transition: "As for HARASSMENT_ALL_REASONABLE_STEPS: code stores 1 October 2026 (assumed); timetable reported as 30 October 2026. Date under review.",
        status: "assumed",
        verification: UNREACHABLE(GOVUK_TIMETABLE, "As above."),
        tests: ["era-2025.test.ts :: tracker/register consistency"],
        unverifiedLeads: ["Search-index snippet: 'From 30 October 2026, employers will be liable for the harassment of their employees by third parties'."],
    },
    {
        ruleId: "NDA_VOID",
        provision: "Employment Rights Act 1996, new s202A (as reported) inserted by Employment Rights Act 2025",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2026-10-01",
        effectiveTo: null,
        transition: "Code stores October 2026 (assumed). Reported: 'will come into force in 2027, although no specific date has yet been confirmed'; regulations defining excepted agreements under consultation. Date under review.",
        status: "assumed",
        verification: UNREACHABLE(GOVUK_TIMETABLE, "Timetable not retrievable; 2027 appears in search snippets (DLA Piper, Stephens Scown, CMS)."),
        tests: ["era-2025.test.ts :: tracker/register consistency"],
        unverifiedLeads: ["Search-index snippet: 'The new NDA regime ... will come into force in 2027, although no specific date has yet been confirmed.'"],
    },
    {
        ruleId: "UNION_INFORM_RIGHT",
        provision: "Trade Union and Labour Relations (Consolidation) Act 1992, new duty to give a statement of the right to join a trade union (section not verified)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2026-10-01",
        effectiveTo: null,
        transition: "Code stores October 2026 (assumed). Reported: the duty to inform takes effect 1 January 2027 (existing workers by 5 April 2027); other trade-union measures 30 October 2026. Date under review.",
        status: "assumed",
        verification: UNREACHABLE(GOVUK_TIMETABLE, "Timetable and Personnel Today report not retrievable; 1 January 2027 appears in search snippets."),
        tests: ["era-2025.test.ts :: tracker/register consistency"],
        unverifiedLeads: ["Search-index snippet (Personnel Today): 'The duty to inform workers takes effect on 1 January 2027, while other trade union measures will be introduced on 30 October 2026.'"],
    },
    {
        ruleId: "COMPENSATORY_AWARD_UNCAPPED",
        provision: "Employment Rights Act 1996, s124 (cap) as amended by Employment Rights Act 2025 (section not verified)",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2027-01-01",
        effectiveTo: null,
        transition: "Code stores 1 January 2027. Whether SI 2026/559 commences this provision was not verified. Date under review.",
        status: "assumed",
        verification: UNREACHABLE(`${LEG}/uksi/2026/559/made`, "Not retrieved."),
        tests: ["era-2025.test.ts :: tracker/register consistency"],
    },
    {
        ruleId: "FIRE_AND_REHIRE_AUTO_UNFAIR",
        provision: "Employment Rights Act 1996, new s104I (as reported) inserted by Employment Rights Act 2025",
        instrument: "Employment Rights Act 2025 (2025 c. 36)",
        jurisdiction: ["great_britain"],
        effectiveFrom: "2027-01-01",
        effectiveTo: null,
        transition: "Code stores 1 January 2027; reported as 'pushed back from October 2026 to January 2027'. Commencement instrument not verified. Date under review.",
        status: "assumed",
        verification: UNREACHABLE(GOVUK_TIMETABLE, "Not retrieved."),
        tests: ["era-2025.test.ts :: tracker/register consistency"],
    },
];

const byRuleId = new Map(LEGAL_RULE_REGISTER.map((e) => [e.ruleId, e]));

export function registerEntry(ruleId: string): RuleRegisterEntry | undefined {
    return byRuleId.get(ruleId);
}

/**
 * A rule is confirmed by instrument only when the register says it has
 * commenced AND names the commencing instrument. Anything else is unconfirmed
 * and the engine leads with the conservative (shorter) rule.
 */
export function isRuleCommenced(ruleId: string): boolean {
    const e = byRuleId.get(ruleId);
    return !!e && e.status === "commenced" && e.commencementInstrument !== undefined;
}

/** The ERA 2025 six-month rules for Great Britain (E&W + Scotland, excluding the separately-made Scottish contract-claims change). */
export const ERA_2025_GB_TIME_LIMIT_RULE_IDS = ["ud_6m_era2025", "disc_6m_era2025", "pd_6m_era2025", "wages_6m_era2025", "boc_ew_6m_era2025"] as const;

export function allGbEra2025TimeLimitRulesCommenced(): boolean {
    return ERA_2025_GB_TIME_LIMIT_RULE_IDS.every((id) => isRuleCommenced(id));
}
