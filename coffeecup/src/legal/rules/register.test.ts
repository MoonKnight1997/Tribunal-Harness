import { describe, it, expect } from "vitest";
import { LEGAL_RULE_REGISTER, registerEntry, isRuleCommenced, allGbEra2025TimeLimitRulesCommenced, ERA_2025_GB_TIME_LIMIT_RULE_IDS } from "./register";
import { TIME_LIMIT_RULES } from "./time-limits";
import { LEGAL_SOURCES, hasSource } from "@/legal/sources/registry";
import { ERA_2025_TRACKER, TIME_LIMIT_CONFIG } from "@/legal/era-2025";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe("source-to-rule register", () => {
    it("has unique rule ids", () => {
        const ids = LEGAL_RULE_REGISTER.map((e) => e.ruleId);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("every TIME_LIMIT_RULES entry has a register entry with matching window", () => {
        for (const rule of TIME_LIMIT_RULES) {
            const entry = registerEntry(rule.id);
            expect(entry, `missing register entry for ${rule.id}`).toBeDefined();
            expect(entry!.effectiveFrom).toBe(rule.effectiveFrom);
            expect(entry!.effectiveTo).toBe(rule.effectiveTo);
        }
    });

    it("every commenced entry names a commencement instrument with an SI number/chapter and URL", () => {
        for (const entry of LEGAL_RULE_REGISTER) {
            if (entry.status !== "commenced") continue;
            expect(entry.commencementInstrument, `${entry.ruleId} is commenced without an instrument`).toBeDefined();
            expect(entry.commencementInstrument!.siNumber.length).toBeGreaterThan(0);
            expect(entry.commencementInstrument!.url).toMatch(/^https:\/\//);
            expect(entry.commencementInstrument!.regulation.length).toBeGreaterThan(0);
        }
    });

    it("no time-limit rule is confirmedBySI unless its register entry is commenced with an instrument", () => {
        for (const rule of TIME_LIMIT_RULES) {
            const entry = registerEntry(rule.id)!;
            const expected = entry.status === "commenced" && entry.commencementInstrument !== undefined;
            expect(rule.commencement.confirmedBySI, rule.id).toBe(expected);
            expect(isRuleCommenced(rule.id)).toBe(expected);
            if (!expected) expect(rule.commencement.note).toMatch(/Statutory Instrument/);
        }
    });

    it("announced or assumed entries never carry a commencement instrument", () => {
        for (const entry of LEGAL_RULE_REGISTER) {
            if (entry.status === "announced" || entry.status === "assumed") {
                expect(entry.commencementInstrument, entry.ruleId).toBeUndefined();
            }
        }
    });

    it("every entry records a verification attempt with an ISO datetime, URL, method and note", () => {
        for (const entry of LEGAL_RULE_REGISTER) {
            expect(entry.verification.retrievedAt).toMatch(ISO_DATETIME);
            expect(entry.verification.url).toMatch(/^https:\/\//);
            expect(["fetched", "unreachable", "not_attempted"]).toContain(entry.verification.method);
            expect(entry.verification.note.length).toBeGreaterThan(0);
            expect(entry.tests.length).toBeGreaterThan(0);
            expect(entry.effectiveFrom).toMatch(ISO_DATE);
            if (entry.effectiveTo !== null) expect(entry.effectiveTo).toMatch(ISO_DATE);
        }
    });

    it("a status stronger than 'announced' for an ERA 2025 rule requires the instrument to have been fetched", () => {
        // Guard against upgrading a status from a snippet or timetable alone.
        for (const id of ERA_2025_GB_TIME_LIMIT_RULE_IDS) {
            const entry = registerEntry(id)!;
            if (entry.status === "commenced" || entry.status === "made_not_yet_commenced") {
                expect(entry.verification.method).toBe("fetched");
            }
        }
    });

    it("TIME_LIMIT_SI_CONFIRMED is derived from the register, true only when every GB ERA 2025 rule is commenced", () => {
        expect(TIME_LIMIT_CONFIG.TIME_LIMIT_SI_CONFIRMED).toBe(allGbEra2025TimeLimitRulesCommenced());
        // In this review no commencement instrument could be read, so the flag is false.
        expect(TIME_LIMIT_CONFIG.TIME_LIMIT_SI_CONFIRMED).toBe(false);
    });

    it("every sourceKeys key on a time-limit rule exists in the source registry", () => {
        for (const rule of TIME_LIMIT_RULES) {
            for (const key of rule.sourceKeys) {
                expect(hasSource(key), `${rule.id} cites unknown source ${key}`).toBe(true);
            }
        }
    });
});

describe("legal source registry", () => {
    it("every source has a URL, a lastVerifiedAt date (or null with a non-fetched verification) and a verification record", () => {
        for (const s of LEGAL_SOURCES) {
            expect(s.url, s.key).toMatch(/^https:\/\//);
            expect(s.verification, s.key).toBeDefined();
            expect(["fetched", "not_rechecked", "unreachable", "not_attempted"]).toContain(s.verification.method);
            if (s.lastVerifiedAt === null) {
                expect(s.verification.method, `${s.key} claims a fetch but has no date`).not.toBe("fetched");
            } else {
                expect(s.lastVerifiedAt).toMatch(ISO_DATE);
            }
            if (s.verification.method === "fetched") {
                // A claimed fetch must say when it happened.
                expect(s.verification.attemptedAt).toMatch(ISO_DATETIME);
            }
        }
    });

    it("has unique keys", () => {
        const keys = LEGAL_SOURCES.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("registers the commencement instruments, the EC Rules and the gov.uk timetable", () => {
        for (const key of ["era2025_act", "era2025_commencement_no1_2026", "era2025_commencement_no4_2026", "et_extension_of_time_limits_regs_2026", "et_extension_of_jurisdiction_ew_amendment_2026", "ec_rules_2014", "govuk_era2025_timetable"]) {
            expect(hasSource(key), key).toBe(true);
        }
        const timetable = LEGAL_SOURCES.find((s) => s.key === "govuk_era2025_timetable")!;
        expect(timetable.sourceType).toBe("govuk");
        expect(timetable.strength).toBe("secondary");
    });

    it("registry commencementConfirmed flags agree with the register", () => {
        const timeLimits = LEGAL_SOURCES.find((s) => s.key === "era2025_time_limits")!;
        expect(timeLimits.commencementConfirmed).toBe(allGbEra2025TimeLimitRulesCommenced());
        const qp = LEGAL_SOURCES.find((s) => s.key === "era2025_qualifying_period")!;
        expect(qp.commencementConfirmed).toBe(isRuleCommenced("QUALIFYING_PERIOD_6_MONTHS"));
    });
});

describe("tracker / register consistency", () => {
    it("every tracker entry carries sourceStatus, sourceUrl and verifiedAt (or null + unresolved)", () => {
        for (const e of ERA_2025_TRACKER) {
            expect(["commenced", "made_not_yet_commenced", "announced", "assumed", "unresolved"]).toContain(e.sourceStatus);
            expect(e.sourceUrl).toMatch(/^https:\/\//);
            if (e.verifiedAt === null) expect(e.unresolved, `${e.key} has no verifiedAt but is not marked unresolved`).toBe(true);
            else expect(e.verifiedAt).toMatch(ISO_DATE);
        }
    });

    it("an in-force tracker entry is never unresolved; an unresolved entry says so in its label", () => {
        for (const e of ERA_2025_TRACKER) {
            if (e.status === "in_force") expect(e.unresolved, e.key).toBe(false);
            if (e.sourceStatus === "unresolved") expect(e.commencement).toMatch(/Date under review — see source register/);
        }
    });

    it("tracker keys modelled in the register agree on status (unresolved ↔ register assumed/announced, never commenced)", () => {
        for (const e of ERA_2025_TRACKER) {
            const entry = registerEntry(e.key);
            if (!entry) continue;
            if (e.sourceStatus === "commenced") expect(entry.status).toBe("commenced");
            if (e.sourceStatus === "unresolved" || e.unresolved) expect(entry.status).not.toBe("commenced");
            if (e.sourceStatus !== "unresolved") expect(entry.status).toBe(e.sourceStatus);
        }
    });

    it("the items the 25 September 2026 timetable reports differently are unresolved, and their stored dates were not moved", () => {
        for (const key of ["HARASSMENT_ALL_REASONABLE_STEPS", "THIRD_PARTY_HARASSMENT", "NDA_VOID", "UNION_INFORM_RIGHT"]) {
            const e = ERA_2025_TRACKER.find((t) => t.key === key)!;
            expect(e.sourceStatus).toBe("unresolved");
            expect(e.tbc).toBe(true);
            expect(registerEntry(key)!.effectiveFrom).toBe("2026-10-01");
        }
    });
});
