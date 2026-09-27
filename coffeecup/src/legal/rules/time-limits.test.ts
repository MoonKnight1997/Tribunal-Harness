import { describe, it, expect } from "vitest";
import { selectTimeLimitRule, TIME_LIMIT_RULES, ruleById } from "./time-limits";
import { calculateTimeLimit } from "@/legal/deadlines/engine";
import { ERA_2025, TIME_LIMIT_CONFIG } from "@/legal/era-2025";

/**
 * Cohort tests for the ERA 2025 boundary.
 *
 * Expected results are worked independently from the statutory arithmetic
 * ("N months beginning with the trigger date" ends the day before the
 * corresponding date; Dodds v Walker) — not from the engine. Where the
 * commencement instrument could NOT be verified in the source register, the
 * test asserts the CONSERVATIVE selection (three-month rule leads) and says so
 * in its name. These tests must be revisited when an instrument is recorded.
 */

const TODAY = "2026-10-02";
const COMMENCEMENT = TIME_LIMIT_CONFIG.COMMENCEMENT_DATE; // 2026-10-01 unless overridden

describe("rule table integrity", () => {
    it("rule ids are unique and historical rows are preserved", () => {
        const ids = TIME_LIMIT_RULES.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ["ud_3m_pre_era2025", "disc_3m_pre_era2025", "pd_3m_pre_era2025", "wages_3m_pre_era2025", "boc_3m_pre_era2025", "redundancy_payment_6m", "equal_pay_6m"]) {
            expect(ruleById(id), id).toBeDefined();
        }
    });

    it("no two rules overlap for the same jurisdiction and family on any day", () => {
        const probes = ["2026-09-30", "2026-10-01", "2026-11-08", "2026-11-09", "2027-06-01"];
        const families = ["unfair_dismissal", "discrimination", "whistleblowing_detriment", "unlawful_deductions", "breach_of_contract", "redundancy_payment", "equal_pay"] as const;
        for (const j of ["england_wales", "scotland"] as const) {
            for (const f of families) {
                for (const d of probes) {
                    const matches = TIME_LIMIT_RULES.filter((r) => r.jurisdictions.includes(j) && r.claimFamilies.includes(f) && d >= r.effectiveFrom && (r.effectiveTo === null || d <= r.effectiveTo));
                    expect(matches.length, `${j}/${f}/${d}`).toBe(1);
                }
            }
        }
    });

    it("the assumed GB commencement is the register's 1 October 2026 unless overridden", () => {
        if (!process.env.ERA_2025_TIME_LIMIT_COMMENCEMENT) expect(COMMENCEMENT).toBe("2026-10-01");
        expect(ERA_2025.ET_TIME_LIMIT_6_MONTHS_SCOTLAND_CONTRACT).toBe("2026-11-09");
    });
});

describe("E&W unfair dismissal", () => {
    it("E&W unfair dismissal: EDT 2026-09-30 selects the three-month rule with no conservative fallback", () => {
        const sel = selectTimeLimitRule("england_wales", "unfair_dismissal", "2026-09-30");
        expect(sel.rule?.id).toBe("ud_3m_pre_era2025");
        expect(sel.conservativeRule).toBeNull();
        expect(sel.registerStatus).toBe("commenced");
        // 30 Sep + 3 months beginning with → ends 29 Dec 2026.
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2026-09-30", today: TODAY });
        expect(out.calculatedDate).toBe("2026-12-29");
        expect(out.explanation.secondary).toBeNull();
    });

    it("E&W unfair dismissal: EDT 2026-10-01 leads with the three-month rule while the ERA 2025 commencement is unverified", () => {
        const sel = selectTimeLimitRule("england_wales", "unfair_dismissal", "2026-10-01");
        expect(sel.rule?.id).toBe("ud_6m_era2025");
        expect(sel.rule?.commencement.confirmedBySI).toBe(false);
        expect(sel.conservativeRule?.id).toBe("ud_3m_pre_era2025");
        expect(sel.registerStatus).toBe("announced");
        // Conservative: 1 Oct + 3 months → 31 Dec 2026. Secondary: 1 Oct + 6 months → 31 Mar 2027.
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2026-10-01", today: TODAY });
        expect(out.ruleId).toBe("ud_3m_pre_era2025");
        expect(out.calculatedDate).toBe("2026-12-31");
        expect(out.explanation.secondary?.date).toBe("2027-03-31");
        expect(out.explanation.assumptions.join(" ")).toMatch(/Statutory Instrument/);
    });
});

describe("E&W discrimination", () => {
    it("E&W discrimination: last act 2026-09-30 selects the three-month rule with no conservative fallback", () => {
        const sel = selectTimeLimitRule("england_wales", "discrimination", "2026-09-30");
        expect(sel.rule?.id).toBe("disc_3m_pre_era2025");
        expect(sel.conservativeRule).toBeNull();
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "discrimination", triggerDate: "2026-09-30", today: TODAY });
        expect(out.calculatedDate).toBe("2026-12-29");
    });

    it("E&W discrimination: last act 2026-10-01 leads with the three-month rule while the ERA 2025 commencement is unverified", () => {
        const sel = selectTimeLimitRule("england_wales", "discrimination", "2026-10-01");
        expect(sel.rule?.id).toBe("disc_6m_era2025");
        expect(sel.conservativeRule?.id).toBe("disc_3m_pre_era2025");
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "discrimination", triggerDate: "2026-10-01", today: TODAY });
        expect(out.ruleId).toBe("disc_3m_pre_era2025");
        expect(out.calculatedDate).toBe("2026-12-31");
        expect(out.explanation.secondary?.date).toBe("2027-03-31");
    });
});

describe("whistleblowing detriment", () => {
    it("whistleblowing detriment follows the same boundary", () => {
        expect(selectTimeLimitRule("scotland", "whistleblowing_detriment", "2026-09-30").rule?.id).toBe("pd_3m_pre_era2025");
        const after = selectTimeLimitRule("scotland", "whistleblowing_detriment", "2026-10-01");
        expect(after.rule?.id).toBe("pd_6m_era2025");
        expect(after.conservativeRule?.id).toBe("pd_3m_pre_era2025");
    });
});

describe("unlawful deductions across the boundary", () => {
    it("wages deductions: payday 2026-09-30 selects the three-month rule; payday 2026-10-01 leads with it conservatively", () => {
        const before = selectTimeLimitRule("england_wales", "unlawful_deductions", "2026-09-30");
        expect(before.rule?.id).toBe("wages_3m_pre_era2025");
        expect(before.conservativeRule).toBeNull();
        const after = selectTimeLimitRule("england_wales", "unlawful_deductions", "2026-10-01");
        expect(after.rule?.id).toBe("wages_6m_era2025");
        expect(after.conservativeRule?.id).toBe("wages_3m_pre_era2025");
        // Payday 31 Oct 2026 + 3 months beginning with → 30 Jan 2027 (corresponding date 31 Jan exists).
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unlawful_deductions", triggerDate: "2026-10-31", today: "2026-11-01" });
        expect(out.ruleId).toBe("wages_3m_pre_era2025");
        expect(out.calculatedDate).toBe("2027-01-30");
        // Six-month alternative: 31 Oct + 6 months → 30 Apr 2027.
        expect(out.explanation.secondary?.date).toBe("2027-04-30");
    });
});

describe("breach of contract — England & Wales and Scotland modelled separately from 1 October 2026", () => {
    it("breach of contract before 1 October 2026 uses the single GB rule in both jurisdictions", () => {
        expect(selectTimeLimitRule("england_wales", "breach_of_contract", "2026-09-30").rule?.id).toBe("boc_3m_pre_era2025");
        expect(selectTimeLimitRule("scotland", "breach_of_contract", "2026-09-30").rule?.id).toBe("boc_3m_pre_era2025");
        expect(selectTimeLimitRule("scotland", "breach_of_contract", "2026-09-30").conservativeRule).toBeNull();
    });

    it("E&W breach of contract: EDT 2026-10-01 leads with the three-month rule while the amending Order is unverified", () => {
        const sel = selectTimeLimitRule("england_wales", "breach_of_contract", "2026-10-01");
        expect(sel.rule?.id).toBe("boc_ew_6m_era2025");
        expect(sel.rule?.jurisdictions).toEqual(["england_wales"]);
        expect(sel.conservativeRule?.id).toBe("boc_3m_pre_era2025");
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "breach_of_contract", triggerDate: "2026-10-01", today: TODAY });
        expect(out.ruleId).toBe("boc_3m_pre_era2025");
        expect(out.calculatedDate).toBe("2026-12-31");
        expect(out.explanation.secondary?.date).toBe("2027-03-31");
    });

    it("Scotland breach of contract: EDT 2026-10-01 and 2026-11-08 apply the unamended three-month Scottish Order with no six-month alternative", () => {
        for (const edt of ["2026-10-01", "2026-11-08"]) {
            const sel = selectTimeLimitRule("scotland", "breach_of_contract", edt);
            expect(sel.rule?.id, edt).toBe("boc_scotland_3m_interim");
            expect(sel.rule?.months).toBe(3);
            expect(sel.rule?.commencement.confirmedBySI).toBe(true);
            expect(sel.conservativeRule).toBeNull();
        }
        // 8 Nov + 3 months beginning with → 7 Feb 2027; no secondary shown because the E&W Order does not extend to Scotland.
        const out = calculateTimeLimit({ jurisdiction: "scotland", family: "breach_of_contract", triggerDate: "2026-11-08", today: "2026-11-09" });
        expect(out.ruleId).toBe("boc_scotland_3m_interim");
        expect(out.calculatedDate).toBe("2027-02-07");
        expect(out.explanation.secondary).toBeNull();
    });

    it("Scotland breach of contract: EDT 2026-11-09 leads with the three-month rule while the Scottish commencement is unresolved", () => {
        const sel = selectTimeLimitRule("scotland", "breach_of_contract", "2026-11-09");
        expect(sel.rule?.id).toBe("boc_scotland_6m_era2025");
        expect(sel.rule?.commencement.confirmedBySI).toBe(false);
        expect(sel.rule?.commencement.note).toMatch(/Scottish Ministers/);
        expect(sel.conservativeRule?.id).toBe("boc_scotland_3m_interim");
        // Conservative: 9 Nov + 3 months → 8 Feb 2027. Secondary: 9 Nov + 6 months → 8 May 2027.
        const out = calculateTimeLimit({ jurisdiction: "scotland", family: "breach_of_contract", triggerDate: "2026-11-09", today: "2026-11-10" });
        expect(out.ruleId).toBe("boc_scotland_3m_interim");
        expect(out.calculatedDate).toBe("2027-02-08");
        expect(out.explanation.secondary?.date).toBe("2027-05-08");
    });
});

describe("unchanged families and unsupported jurisdictions", () => {
    it("redundancy payment and equal pay rules are unchanged across the boundary", () => {
        for (const d of ["2026-09-30", "2026-10-01", "2026-11-09"]) {
            const rp = selectTimeLimitRule("england_wales", "redundancy_payment", d);
            expect(rp.rule?.id).toBe("redundancy_payment_6m");
            expect(rp.conservativeRule).toBeNull();
            const ep = selectTimeLimitRule("scotland", "equal_pay", d);
            expect(ep.rule?.id).toBe("equal_pay_6m");
            expect(ep.conservativeRule).toBeNull();
        }
    });

    it("Northern Ireland has no rule in any family", () => {
        for (const f of ["unfair_dismissal", "discrimination", "breach_of_contract", "unlawful_deductions"] as const) {
            const sel = selectTimeLimitRule("northern_ireland", f, "2026-10-01");
            expect(sel.rule).toBeNull();
            expect(sel.registerStatus).toBeNull();
            expect(sel.reason).toMatch(/Northern Ireland/);
        }
    });
});
