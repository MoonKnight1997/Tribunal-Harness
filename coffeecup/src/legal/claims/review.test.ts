import { describe, it, expect } from "vitest";
import { deterministicReview } from "./review";
import { STRENGTH_PHRASES, findForbiddenLanguage, redactForbiddenLanguage, containsForbiddenLanguage } from "./language";

const okFact = { id: "ok", status: "confirmed", provenance: "USER_CONFIRMED", disputed: false };

function reviewReasoning(reasoning: string) {
    const { elements, findings } = deterministicReview([{ elementKey: "reason", status: "supported", reasoning, supportingFactIds: ["ok"], contraryFactIds: [], missingInformation: [], sourceKeys: [] }], [okFact]);
    return { text: elements[0].reasoning, findings };
}

describe("shared forbidden-language list", () => {
    it("finds every match, case-insensitively, including percentages", () => {
        const matches = findForbiddenLanguage("A Strong case; the defence is WEAK; roughly 90% likely; 40 per cent; hopeless.").map((m) => m.text.toLowerCase());
        expect(matches).toEqual(["strong", "weak", "90%", "40 per cent", "hopeless"]);
    });
    it("is word-bounded", () => {
        expect(containsForbiddenLanguage("headstrong armstrong weakness")).toBe(false);
        expect(containsForbiddenLanguage("the case is strong")).toBe(true);
    });
    it("covers the phrases the draft checks use", () => {
        for (const p of ["strong", "weak", "winner", "hopeless", "likely to win", "likely to lose", "likely to succeed", "likely to fail", "good prospects", "poor prospects", "bound to"]) {
            expect(STRENGTH_PHRASES).toContain(p);
        }
    });
    it("redacts all occurrences, not just the first", () => {
        expect(redactForbiddenLanguage("strong then weak then 90%")).toBe("[assessment removed] then [assessment removed] then [assessment removed]");
    });
});

describe("deterministicReview sanitiser", () => {
    it("removes strong, weak and 90% from one reasoning string", () => {
        const { text, findings } = reviewReasoning("This is a strong point although one part is weak; I would put it at 90%.");
        expect(text).not.toMatch(/strong|weak|90%/i);
        expect(text.match(/\[assessment removed\]/g)).toHaveLength(3);
        expect(findings.some((f) => f.question === "output_within_evidence")).toBe(true);
    });
    it("is case-insensitive and catches later occurrences on their own", () => {
        expect(reviewReasoning("Weak.").text).toBe("[assessment removed].");
        expect(reviewReasoning("Fine so far. Then: likely to WIN.").text).toBe("Fine so far. Then: [assessment removed].");
    });
    it("leaves ordinary reasoning alone", () => {
        const { text, findings } = reviewReasoning("The confirmed fact states no hearing was held.");
        expect(text).toBe("The confirmed fact states no hearing was held.");
        expect(findings.filter((f) => f.question === "output_within_evidence")).toHaveLength(0);
    });
});
