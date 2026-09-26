import { describe, it, expect } from "vitest";
import { calculateTimeLimit } from "./engine";
import { selectTimeLimitRule } from "@/legal/rules/time-limits";
import { TIME_LIMIT_CONFIG } from "@/legal/era-2025";

const TODAY = "2026-04-01";

describe("rule selection is versioned by event date", () => {
    it("selects the pre-ERA 2025 three-month rule for an EDT before commencement", () => {
        const sel = selectTimeLimitRule("england_wales", "unfair_dismissal", "2026-03-03");
        expect(sel.rule?.id).toBe("ud_3m_pre_era2025");
        expect(sel.conservativeRule).toBeNull();
    });

    it("selects the ERA 2025 six-month rule on/after commencement but supplies the conservative rule while the SI is unconfirmed", () => {
        const sel = selectTimeLimitRule("england_wales", "unfair_dismissal", TIME_LIMIT_CONFIG.COMMENCEMENT_DATE);
        expect(sel.rule?.id).toBe("ud_6m_era2025");
        expect(sel.conservativeRule?.id).toBe("ud_3m_pre_era2025");
    });

    it("has no rule for Northern Ireland and says why", () => {
        const sel = selectTimeLimitRule("northern_ireland", "unfair_dismissal", "2026-03-03");
        expect(sel.rule).toBeNull();
        expect(sel.reason).toMatch(/Northern Ireland/);
    });

    it("breach of contract rules apply in England, Wales and Scotland under the two 1994 Orders", () => {
        expect(selectTimeLimitRule("scotland", "breach_of_contract", "2026-03-03").rule?.id).toBe("boc_3m_pre_era2025");
        expect(selectTimeLimitRule("england_wales", "breach_of_contract", "2026-03-03").rule?.id).toBe("boc_3m_pre_era2025");
        expect(selectTimeLimitRule("northern_ireland", "breach_of_contract", "2026-03-03").rule).toBeNull();
    });
});

describe("calculateTimeLimit", () => {
    it("calculates three months less one day and explains itself", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2026-03-03", today: TODAY });
        expect(out.calculatedDate).toBe("2026-06-02");
        expect(out.status).toBe("calculated");
        expect(out.ruleId).toBe("ud_3m_pre_era2025");
        expect(out.explanation.triggerDate).toBe("2026-03-03");
        expect(out.explanation.source.reference).toBe("ERA 1996 s111(2)");
        expect(out.explanation.assumptions.join(" ")).toMatch(/Three months less one day/);
        expect(out.explanation.secondary).toBeNull();
    });

    it("refuses to invent a deadline when the trigger date is missing", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: null, today: TODAY });
        expect(out.calculatedDate).toBeNull();
        expect(out.status).toBe("uncertain");
        expect(out.explanation.missingInformation.length).toBeGreaterThan(0);
        expect(out.explanation.warnings[0]).toMatch(/not currently have enough information/);
    });

    it("applies the Acas clock-stop and records the effect", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2025-01-01", acasDayA: "2025-02-01", acasDayB: "2025-02-15", today: "2025-03-01" });
        expect(out.calculatedDate).toBe("2025-04-14");
        expect(out.explanation.acasEffect).toMatch(/14 days/);
    });

    it("uses the one-month-from-Day-B backstop when the remainder is short", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2025-01-01", acasDayA: "2025-03-30", acasDayB: "2025-04-01", today: "2025-04-02" });
        expect(out.calculatedDate).toBe("2025-05-01");
        expect(out.explanation.acasEffect).toMatch(/one month after Day B/);
    });

    it("does not revive an expired limit when conciliation starts late", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2025-01-01", acasDayA: "2025-04-10", acasDayB: "2025-04-20", today: "2025-04-21" });
        expect(out.calculatedDate).toBe("2025-03-31");
        expect(out.status).toBe("expired");
        expect(out.explanation.warnings.join(" ")).toMatch(/does not extend time/);
    });

    it("flags a missing Day B rather than guessing", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "discrimination", triggerDate: "2026-03-03", acasDayA: "2026-04-01", today: "2026-04-02" });
        expect(out.calculatedDate).toBe("2026-06-02");
        expect(out.explanation.missingInformation).toContain("Acas certificate date (Day B).");
    });

    it("leads with the conservative shorter deadline for acts after the unconfirmed ERA 2025 commencement", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2026-10-15", today: "2026-10-20" });
        expect(out.ruleId).toBe("ud_3m_pre_era2025");
        expect(out.calculatedDate).toBe("2027-01-14");
        expect(out.explanation.secondary?.date).toBe("2027-04-14");
        expect(out.explanation.assumptions.join(" ")).toMatch(/Statutory Instrument/);
    });

    it("warns about non-working days without moving the date", () => {
        // 1 Jun 2025 + 3 months less 1 day = 31 Aug 2025 (a Sunday).
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "discrimination", triggerDate: "2025-06-01", today: "2025-06-02" });
        expect(out.calculatedDate).toBe("2025-08-31");
        expect(out.explanation.warnings.join(" ")).toMatch(/NOT extended/);
    });

    it("warns when the trigger date is approximate", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "discrimination", triggerDate: "2026-03-03", triggerApproximate: true, today: TODAY });
        expect(out.explanation.warnings.join(" ")).toMatch(/approximate/);
    });

    it("explains the discretionary extension test when expired", () => {
        const disc = calculateTimeLimit({ jurisdiction: "england_wales", family: "discrimination", triggerDate: "2025-01-01", today: "2025-06-01" });
        expect(disc.explanation.warnings.join(" ")).toMatch(/just and equitable/);
        const ud = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2025-01-01", today: "2025-06-01" });
        expect(ud.explanation.warnings.join(" ")).toMatch(/not reasonably practicable/);
    });

    it("returns uncertain for Northern Ireland instead of applying GB rules", () => {
        const out = calculateTimeLimit({ jurisdiction: "northern_ireland", family: "unfair_dismissal", triggerDate: "2026-03-03", today: TODAY });
        expect(out.calculatedDate).toBeNull();
        expect(out.status).toBe("uncertain");
    });
});
