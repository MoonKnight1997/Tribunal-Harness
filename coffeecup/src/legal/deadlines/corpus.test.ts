/**
 * Deadline corpus: pure engine cases with independently worked expected dates.
 *
 * Working method for every row: count forward N calendar months from the
 * trigger to the corresponding date, then take the day before (Dodds v
 * Walker). Where the later month has no corresponding day the period ends on
 * the last day of that month (no further day off). Acas: add (Day B − Day A)
 * days to the unadjusted date, then take the later of that and one calendar
 * month after Day B (ERA 1996 s207B(3)–(4)); never earlier than the
 * unadjusted date; never any extension if Day A is after the unadjusted date.
 */

import { describe, it, expect } from "vitest";
import { calculateTimeLimit, type TimeLimitInput } from "./engine";

const EW = "england_wales" as const;

interface Row {
    name: string;
    input: TimeLimitInput;
    expected: { status: string; date: string | null; unadjusted?: string | null; basis?: string };
}

const CORPUS: Row[] = [
    // ── Month ends and leap years (three months less one day) ────────────
    {
        name: "31 Jan 2026 + 3m: no 31 Apr → 30 Apr 2026 (last day of April, not reduced further)",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2026-01-31", today: "2026-02-01" },
        expected: { status: "calculated", date: "2026-04-30" },
    },
    {
        name: "30 Nov 2027 + 3m: no 30 Feb → 29 Feb 2028 (leap year)",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2027-11-30", today: "2027-12-01" },
        expected: { status: "calculated", date: "2028-02-29" },
    },
    {
        name: "30 Nov 2026 + 3m: no 30 Feb → 28 Feb 2027 (not a leap year)",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2026-11-30", today: "2026-12-01" },
        expected: { status: "calculated", date: "2027-02-28" },
    },
    {
        name: "31 May 2026 + 3m: corresponding 31 Aug exists → 30 Aug 2026",
        input: { jurisdiction: EW, family: "discrimination", triggerDate: "2026-05-31", today: "2026-06-01" },
        expected: { status: "calculated", date: "2026-08-30" },
    },
    {
        name: "1 Jun 2025 + 3m: corresponding 1 Sep → 31 Aug 2025 (a Sunday; date not moved)",
        input: { jurisdiction: EW, family: "discrimination", triggerDate: "2025-06-01", today: "2025-06-02" },
        expected: { status: "calculated", date: "2025-08-31" },
    },
    {
        name: "28 Feb 2026 + 3m: corresponding 28 May → 27 May 2026",
        input: { jurisdiction: EW, family: "unlawful_deductions", triggerDate: "2026-02-28", today: "2026-03-01" },
        expected: { status: "calculated", date: "2026-05-27" },
    },
    // ── Six-month limits (redundancy payment / equal pay) ───────────────
    {
        name: "31 Aug 2026 + 6m: no 31 Feb → 28 Feb 2027 (redundancy payment, six months)",
        input: { jurisdiction: EW, family: "redundancy_payment", triggerDate: "2026-08-31", today: "2026-09-01" },
        expected: { status: "calculated", date: "2027-02-28" },
    },
    {
        name: "31 Aug 2027 + 6m: no 31 Feb → 29 Feb 2028 (equal pay, leap year)",
        input: { jurisdiction: EW, family: "equal_pay", triggerDate: "2027-08-31", today: "2027-09-01" },
        expected: { status: "calculated", date: "2028-02-29" },
    },
    // ── Acas: ordinary extension and the one-month backstop ─────────────
    {
        name: "1 Jan 2025 → 31 Mar; Day A 1 Feb, Day B 15 Feb (14 days) → 14 Apr; one month from 15 Feb = 15 Mar → 14 Apr",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-02-01", dayB: "2025-02-15", dayBBasis: "received" }, today: "2025-03-01" },
        expected: { status: "calculated", date: "2025-04-14", basis: "received" },
    },
    {
        name: "1 Jan 2025 → 31 Mar; Day A 30 Mar, Day B 1 Apr (2 days) → 2 Apr; one month from 1 Apr = 1 May → 1 May (backstop)",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-03-30", dayB: "2025-04-01", dayBBasis: "received" }, today: "2025-04-02" },
        expected: { status: "calculated", date: "2025-05-01" },
    },
    {
        name: "3 Mar 2026 → 2 Jun; Day A 1 Apr, Day B 29 Apr (28 days) → 30 Jun; one month from 29 Apr = 29 May → 30 Jun",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2026-03-03", acas: { dayA: "2026-04-01", dayB: "2026-04-29", dayBBasis: "issue_date_assumed" }, today: "2026-05-01" },
        expected: { status: "calculated", date: "2026-06-30", basis: "issue_date_assumed" },
    },
    {
        name: "27 Feb 2026 → 26 May; Day A 20 Mar, Day B 17 Apr (28 days) → 23 Jun; one month from 17 Apr = 17 May → 23 Jun",
        input: { jurisdiction: "scotland", family: "unfair_dismissal", triggerDate: "2026-02-27", acas: { dayA: "2026-03-20", dayB: "2026-04-17", dayBBasis: "issue_date_assumed" }, today: "2026-05-01" },
        expected: { status: "calculated", date: "2026-06-23" },
    },
    // ── Acas: issue date vs receipt date ────────────────────────────────
    {
        name: "1 Jan 2025 → 31 Mar; Day A 1 Feb; only issue date 10 Mar known (37 days) → 7 May; one month from 10 Mar = 10 Apr → 7 May",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-02-01", dayB: "2025-03-10", dayBBasis: "issue_date_assumed" }, today: "2025-03-12" },
        expected: { status: "calculated", date: "2025-05-07", basis: "issue_date_assumed" },
    },
    {
        name: "same, but received 12 Mar by post (39 days) → 9 May (later than the issue-date figure, as required)",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-02-01", dayB: "2025-03-12", dayBBasis: "received" }, today: "2025-03-12" },
        expected: { status: "calculated", date: "2025-05-09", basis: "received" },
    },
    {
        name: "same, sent by email on 10 Mar → deemed received 10 Mar → 7 May",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-02-01", dayB: "2025-03-10", dayBBasis: "deemed_received" }, today: "2025-03-12" },
        expected: { status: "calculated", date: "2025-05-07", basis: "deemed_received" },
    },
    // ── Acas: pending, no revival, invalid ───────────────────────────────
    {
        name: "1 Jan 2026 → 31 Mar; Day A 1 Mar, no Day B; evaluated 1 Apr → pending_acas, floor 31 Mar, not expired",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2026-01-01", acas: { dayA: "2026-03-01", dayB: null, dayBBasis: "pending" }, today: "2026-04-01" },
        expected: { status: "pending_acas", date: null, unadjusted: "2026-03-31", basis: "pending" },
    },
    {
        name: "1 Jan 2025 → 31 Mar; Day A 10 Apr (after expiry) → no revival, stays 31 Mar and is expired on 21 Apr",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-04-10", dayB: "2025-04-20", dayBBasis: "received" }, today: "2025-04-21" },
        expected: { status: "expired", date: "2025-03-31" },
    },
    {
        name: "Day A after expiry with no Day B → still no revival (not pending)",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-04-10", dayB: null, dayBBasis: "pending" }, today: "2025-04-21" },
        expected: { status: "expired", date: "2025-03-31" },
    },
    {
        name: "Day B before Day A → uncertain, never clamped",
        input: { jurisdiction: EW, family: "unfair_dismissal", triggerDate: "2025-01-01", acas: { dayA: "2025-02-15", dayB: "2025-02-01", dayBBasis: "received" }, today: "2025-03-01" },
        expected: { status: "uncertain", date: null },
    },
    // ── Missing triggers: no substitution ───────────────────────────────
    {
        name: "discrimination with no last-act date → uncertain (a dismissal date is not substituted)",
        input: { jurisdiction: EW, family: "discrimination", triggerDate: null, today: "2026-09-27" },
        expected: { status: "uncertain", date: null },
    },
    {
        name: "unlawful deductions with no deduction date → uncertain",
        input: { jurisdiction: EW, family: "unlawful_deductions", triggerDate: null, today: "2026-09-27" },
        expected: { status: "uncertain", date: null },
    },
    // ── Jurisdictions ───────────────────────────────────────────────────
    {
        name: "Northern Ireland → uncertain (separate tribunal system)",
        input: { jurisdiction: "northern_ireland", family: "unfair_dismissal", triggerDate: "2026-03-03", today: "2026-04-01" },
        expected: { status: "uncertain", date: null },
    },
    {
        name: "Scotland → same GB rule: 3 Mar 2026 → 2 Jun 2026",
        input: { jurisdiction: "scotland", family: "unfair_dismissal", triggerDate: "2026-03-03", today: "2026-04-01" },
        expected: { status: "calculated", date: "2026-06-02" },
    },
    // ── Time passage is a presentation matter ───────────────────────────
    {
        name: "1 Aug 2026 deduction → 31 Oct 2026; on 1 Nov 2026 it is expired",
        input: { jurisdiction: EW, family: "unlawful_deductions", triggerDate: "2026-08-01", today: "2026-11-01" },
        expected: { status: "expired", date: "2026-10-31" },
    },
    {
        name: "1 Aug 2026 deduction → 31 Oct 2026; on 30 Oct 2026 it is calculated (1 day left)",
        input: { jurisdiction: EW, family: "unlawful_deductions", triggerDate: "2026-08-01", today: "2026-10-30" },
        expected: { status: "calculated", date: "2026-10-31" },
    },
];

describe("deadline corpus", () => {
    for (const row of CORPUS) {
        it(row.name, () => {
            const out = calculateTimeLimit(row.input);
            expect(out.status).toBe(row.expected.status);
            expect(out.calculatedDate).toBe(row.expected.date);
            if (row.expected.unadjusted !== undefined) expect(out.explanation.unadjusted?.date ?? null).toBe(row.expected.unadjusted);
            if (row.expected.basis) expect(out.explanation.acas?.dayBBasis).toBe(row.expected.basis);
            // Invariants that hold for every row.
            if (out.status === "pending_acas") {
                expect(out.calculatedDate).toBeNull();
                expect(out.explanation.warnings.join(" ")).not.toMatch(/appears to have passed/);
            }
            if (out.status === "uncertain") expect(out.calculatedDate).toBeNull();
            expect(out.explanation.trigger).toBeDefined();
            expect(out.explanation.acas).toBeDefined();
            expect(JSON.stringify(out)).not.toMatch(/\d+%/);
        });
    }

    it("Scotland output carries the bank-holiday note", () => {
        const out = calculateTimeLimit({ jurisdiction: "scotland", family: "unfair_dismissal", triggerDate: "2026-03-03", today: "2026-04-01" });
        expect(out.explanation.assumptions.join(" ")).toMatch(/Scottish bank holidays/);
    });
});
