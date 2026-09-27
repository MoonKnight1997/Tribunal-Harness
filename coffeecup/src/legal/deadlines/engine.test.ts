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

    it("reports pending conciliation (Day A known, Day B not) as pending_acas with the unadjusted date as a floor, never a calculated date", () => {
        // 3 Mar 2026 + 3m less 1 day = 2 Jun 2026 (unadjusted). Day A 1 Apr is before that, so s207B applies but Day B is unknown.
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "discrimination", triggerDate: "2026-03-03", acasDayA: "2026-04-01", today: "2026-04-02" });
        expect(out.status).toBe("pending_acas");
        expect(out.calculatedDate).toBeNull();
        expect(out.daysRemaining).toBeNull();
        expect(out.explanation.unadjusted?.date).toBe("2026-06-02");
        expect(out.explanation.unadjusted?.note).toMatch(/no earlier than 2026-06-02/);
        expect(out.explanation.acas?.dayBBasis).toBe("pending");
        expect(out.explanation.missingInformation).toContain("The date you received your Acas certificate (Day B).");
    });

    it("never labels a pending conciliation as expired once the unadjusted date passes (F05)", () => {
        // Event 1 Jan 2026 → unadjusted 31 Mar 2026. Day A 1 Mar 2026 (before expiry). Evaluated 1 Apr 2026.
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2026-01-01", acas: { dayA: "2026-03-01", dayB: null, dayBBasis: "pending" }, today: "2026-04-01" });
        expect(out.status).toBe("pending_acas");
        expect(out.calculatedDate).toBeNull();
        expect(out.explanation.unadjusted?.date).toBe("2026-03-31");
        expect(out.explanation.warnings.join(" ")).not.toMatch(/appears to have passed/);
    });

    it("uses the receipt date as Day B when given, and the issue date only as a conservative fallback", () => {
        // 1 Jan 2025 + 3m less 1 day = 31 Mar 2025. Day A 1 Feb.
        // Issue date 10 Mar → gap 37 days → 7 May 2025; one month from 10 Mar = 10 Apr → 7 May.
        const issued = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-02-01", dayB: "2025-03-10", dayBBasis: "issue_date_assumed" }, today: "2025-03-12" });
        expect(issued.calculatedDate).toBe("2025-05-07");
        expect(issued.explanation.acas?.dayBBasis).toBe("issue_date_assumed");
        expect(issued.explanation.acasEffect).toMatch(/never earlier/);
        // Receipt 12 Mar by post → gap 39 days → 9 May 2025 (later, as it must be).
        const received = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-02-01", dayB: "2025-03-12", dayBBasis: "received" }, today: "2025-03-12" });
        expect(received.calculatedDate).toBe("2025-05-09");
        expect(received.explanation.acas?.dayBBasis).toBe("received");
    });

    it("returns uncertain with a warning for reversed or inconsistent Acas dates instead of clamping", () => {
        const reversed = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-02-15", dayB: "2025-02-01", dayBBasis: "received" }, today: "2025-03-01" });
        expect(reversed.status).toBe("uncertain");
        expect(reversed.calculatedDate).toBeNull();
        expect(reversed.explanation.warnings.join(" ")).toMatch(/Day B .* is before Day A/);
        const noDayA = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: null, dayB: "2025-02-15", dayBBasis: "received" }, today: "2025-03-01" });
        expect(noDayA.status).toBe("uncertain");
        expect(noDayA.explanation.warnings.join(" ")).toMatch(/Day A/);
    });

    it("returns uncertain and lists the values when confirmed trigger dates conflict", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: null, triggerConflicts: ["2026-03-03", "2026-03-10"], today: TODAY });
        expect(out.status).toBe("uncertain");
        expect(out.explanation.trigger?.conflictingValues).toEqual(["2026-03-03", "2026-03-10"]);
        expect(out.explanation.missingInformation.join(" ")).toMatch(/My case/);
    });

    it("carries the trigger precision and source into the explanation", () => {
        const out = calculateTimeLimit({ jurisdiction: "england_wales", family: "unfair_dismissal", triggerDate: "2026-03-03", triggerPrecision: "approximate", triggerSource: "employment.end_date", triggerConfirmed: true, today: TODAY });
        expect(out.status).toBe("calculated");
        expect(out.explanation.trigger).toMatchObject({ date: "2026-03-03", precision: "approximate", source: "employment.end_date", confirmed: true });
        expect(out.explanation.warnings.join(" ")).toMatch(/approximate/);
    });

    it("gives family-specific missing-information text and never substitutes another event", () => {
        const disc = calculateTimeLimit({ jurisdiction: "england_wales", family: "discrimination", triggerDate: null, today: TODAY });
        expect(disc.explanation.missingInformation[0]).toMatch(/last act.*dismissal date as the last act on My case/);
        const wages = calculateTimeLimit({ jurisdiction: "england_wales", family: "unlawful_deductions", triggerDate: null, today: TODAY });
        expect(wages.explanation.missingInformation[0]).toMatch(/payday of the deduction/);
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

    it("applies the same GB rules in Scotland and notes the bank-holiday calendar", () => {
        const out = calculateTimeLimit({ jurisdiction: "scotland", family: "unfair_dismissal", triggerDate: "2026-03-03", today: TODAY });
        expect(out.calculatedDate).toBe("2026-06-02");
        expect(out.explanation.assumptions.join(" ")).toMatch(/Scottish bank holidays are not checked/);
    });
});
