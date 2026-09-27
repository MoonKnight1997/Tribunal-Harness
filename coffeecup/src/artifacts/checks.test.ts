import { describe, it, expect } from "vitest";
import { checkDraft, findDatesInText, collectStrings } from "./checks";

const payload = {
    authoritative: {
        title: "Grievance letter",
        today: "2026-09-27",
        employer: "Acme Ltd",
        employment: { startDate: "2021-03-01", endDate: "2026-03-03" },
        people: [{ name: "Jane Smith", role: "line manager" }, { name: "Priya Patel", role: "HR" }],
        events: [{ date: "2026-03-03", title: "Dismissed by letter", description: "The letter said the reason was gross misconduct." }],
        facts: [{ statement: "I was dismissed on 3 March 2026.", value: "2026-03-03" }, { statement: "My pay was cut by 10% in January." }],
        documents: [{ filename: "dismissal-letter.pdf", date: "2026-03-03" }],
        process: { data: { preparation: { keyIssues: ["No hearing was held"] } } },
    },
    supplementary: { preparation: { moneyIssues: "Two weeks of unpaid notice, about £900." } },
};

const kinds = (content: string) => checkDraft(content, payload).map((f) => f.kind);

describe("findDatesInText", () => {
    it("finds ISO, long, ordinal, US and slash forms", () => {
        const found = findDatesInText("2026-03-03, 3 March 2026, 3rd March 2026, March 3, 2026, 03/03/2026, 3 Mar 2026").map((d) => d.iso);
        expect(found).toEqual(["2026-03-03", "2026-03-03", "2026-03-03", "2026-03-03", "2026-03-03", "2026-03-03"]);
    });
    it("ignores impossible dates", () => {
        expect(findDatesInText("2026-13-45 and 31 February 2026")).toEqual([]);
    });
});

describe("collectStrings", () => {
    it("walks nested objects and arrays", () => {
        expect(collectStrings({ a: "x", b: ["y", { c: "z", d: 1 }] })).toEqual(["x", "y", "z"]);
    });
});

describe("unsupported_date", () => {
    it("passes dates that are in the record, in any format", () => {
        expect(kinds("On 3rd March 2026 (2026-03-03) I was dismissed. I started on 1 March 2021. Today is 27 September 2026.")).toEqual([]);
    });
    it("flags a date that is not in the record, once per date", () => {
        const flags = checkDraft("The meeting on 14 February 2026 and again 14/02/2026 was not minuted.", payload);
        expect(flags.filter((f) => f.kind === "unsupported_date")).toHaveLength(1);
        expect(flags[0].note).toMatch(/14 February 2026/);
    });
});

describe("percentage", () => {
    it("flags percentages and spelled-out forms", () => {
        expect(kinds("There is a 90% chance. Roughly 60 per cent. Fifty percent.")).toEqual(expect.arrayContaining(["percentage", "percentage", "percentage"]));
        expect(kinds("There is a 90% chance.").filter((k) => k === "percentage")).toHaveLength(1);
    });
    it("does not flag a percentage that is a recorded fact", () => {
        expect(kinds("My pay was cut by 10% in January.")).toEqual([]);
    });
});

describe("strength_assertion", () => {
    it("flags every occurrence, case-insensitively and word-bounded", () => {
        const flags = checkDraft("This is a STRONG case. The employer's position is weak. You are likely to win. Good prospects overall. Bound to succeed.", payload);
        const s = flags.filter((f) => f.kind === "strength_assertion");
        expect(s.map((f) => f.excerpt.length > 0)).not.toContain(false);
        expect(s).toHaveLength(5);
    });
    it("does not flag substrings of ordinary words", () => {
        expect(kinds("The headstrong manager wrote weakly-worded notes about strongholds.")).toEqual([]);
    });
});

describe("unsupported_quote", () => {
    it("passes quotations present in the record, ignoring whitespace, case and curly quotes", () => {
        expect(kinds("The letter said “the reason WAS   gross misconduct.”")).toEqual([]);
        expect(kinds('You wrote: "Two weeks of unpaid notice, about £900."')).toEqual([]);
    });
    it("flags a long quotation that is not in the record", () => {
        expect(kinds('My manager said "you will never work in this industry again, I promise you that".')).toEqual(["unsupported_quote"]);
    });
    it("ignores short quoted fragments", () => {
        expect(kinds('She called it "unacceptable".')).toEqual([]);
    });
});

describe("fabricated_source", () => {
    it("flags neutral citations, case names, sections, Acts and Regulations that were not supplied", () => {
        const text = "See [2019] UKEAT 123 and Polkey v Dayton Services. Under section 98 and s.111 of the Employment Rights Act 1996 and the Working Time Regulations 1998.";
        const flags = checkDraft(text, payload).filter((f) => f.kind === "fabricated_source");
        const excerpts = flags.map((f) => f.note);
        expect(excerpts.some((n) => /\[2019\] UKEAT 123/.test(n))).toBe(true);
        expect(excerpts.some((n) => /Polkey v Dayton/.test(n))).toBe(true);
        expect(excerpts.some((n) => /section 98/.test(n))).toBe(true);
        expect(excerpts.some((n) => /s\.111/.test(n))).toBe(true);
        expect(excerpts.some((n) => /Employment Rights Act 1996/.test(n))).toBe(true);
        expect(excerpts.some((n) => /Working Time Regulations 1998/.test(n))).toBe(true);
    });
    it("does not flag a citation that the input itself contained", () => {
        const p = { authoritative: { ...payload.authoritative, timeLimits: [{ label: "Unfair dismissal (ERA 1996 s111)", date: "2026-06-02" }] } };
        expect(checkDraft("Time limit: ERA 1996 s111, 2 June 2026.", p).filter((f) => f.kind === "fabricated_source")).toEqual([]);
    });
});

describe("unsupported_name", () => {
    it("passes recorded people and the employer", () => {
        expect(kinds("I spoke with Jane Smith and Ms Patel at Acme Ltd about Priya Patel's email.")).toEqual([]);
    });
    it("flags an honorific followed by an unknown surname", () => {
        expect(kinds("I complained to Mr Jones in writing.")).toEqual(["unsupported_name"]);
    });
    it("flags an unknown two-word capitalised name mid-sentence", () => {
        expect(kinds("I was told by Gareth Williams that the decision was final.")).toEqual(["unsupported_name"]);
    });
    it("does not flag sentence starts, headings, months, institutions or salutations", () => {
        const text = ["## What I am asking for", "Dear Sir or Madam,", "Human Resources were informed in March 2026? Acas Early Conciliation applies.", "Yours sincerely,", "Employment Tribunal guidance was read. Kind Regards."].join("\n");
        expect(kinds(text).filter((k) => k === "unsupported_name")).toEqual([]);
    });
});

describe("clean draft", () => {
    it("returns no flags for a draft built only from the record", () => {
        const text = [
            "# Grievance letter",
            "",
            "Dear Jane Smith,",
            "",
            "I am writing to raise a formal grievance about my dismissal on 3 March 2026 by Acme Ltd.",
            "The letter said the reason was gross misconduct. No hearing was held. [confirm the date of the meeting]",
            "",
            "_Generated from the confirmed case record. Please read and edit before sending._",
        ].join("\n");
        expect(checkDraft(text, payload)).toEqual([]);
    });
});
