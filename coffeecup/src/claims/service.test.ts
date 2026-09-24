import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import { createCase, updateEmployment, updateCase } from "@/cases/service";
import { addFact, setStructuredFact, correctFact, getStructuredFact } from "@/facts/service";
import { identifyClaims, listClaimCandidates, listClaimElements, buildEngineInput } from "./service";
import { triggerCandidates } from "@/legal/claims/engine";
import { deterministicReview } from "@/legal/claims/review";
import { MockBackend } from "@/ai/providers/mock";
import { FeatureDisabledError } from "@/lib/errors";

let alice: { userId: string };

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
});

beforeEach(() => MockBackend.clearScripts());

afterAll(async () => {
    await closeDb();
});

async function dismissedCase() {
    const c = await createCase(alice, { entryRoute: "dismissal" });
    await updateEmployment(alice, c.id, { employerName: "Acme Ltd", employmentStatus: "employee", startDate: "2021-03-01", endDate: "2026-03-03", stillEmployed: false });
    await setStructuredFact(alice, c.id, "employment_start", "2021-03-01", "I started work on 1 March 2021.");
    await setStructuredFact(alice, c.id, "dismissal_date", "2026-03-03", "I was dismissed on 3 March 2026.");
    await addFact(alice, c.id, { statement: "No investigation meeting or disciplinary hearing was held before I was dismissed.", status: "confirmed" });
    await addFact(alice, c.id, { statement: "The dismissal letter says the reason was gross misconduct.", status: "confirmed", provenance: "EMPLOYER_ALLEGATION" });
    return c;
}

describe("feature flag gating", () => {
    it("refuses claim identification when the flag is off, at the service layer", async () => {
        const c = await dismissedCase();
        await expect(identifyClaims(alice, c.id)).rejects.toBeInstanceOf(FeatureDisabledError);
        expect(await listClaimCandidates(alice, c.id)).toHaveLength(0);
    });
});

describe("deterministic triggers", () => {
    it("proposes dismissal-related claims for a dismissed employee and not for a pay-only issue", async () => {
        const c = await dismissedCase();
        const input = await buildEngineInput(alice, c.id);
        const ids = triggerCandidates(input).map((x) => x.def.id);
        expect(ids).toContain("unfair_dismissal");
        expect(ids).toContain("wrongful_dismissal");
        expect(ids).not.toContain("unlawful_deductions");

        const pay = await createCase(alice, { entryRoute: "pay" });
        const payInput = await buildEngineInput(alice, pay.id);
        const payIds = triggerCandidates(payInput).map((x) => x.def.id);
        expect(payIds).toContain("unlawful_deductions");
        expect(payIds).not.toContain("unfair_dismissal");
    });
});

describe("claim identification (flag on)", () => {
    it("returns element-by-element statuses, deterministic time limits, sources and no scores", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await dismissedCase();
        const candidates = await identifyClaims(alice, c.id);
        const ud = candidates.find((x) => x.claimType === "unfair_dismissal")!;
        expect(ud).toBeDefined();
        expect(ud.timeLimit?.calculatedDate).toBe("2026-06-02");
        expect(ud.sources.some((s) => s.reference === "ERA 1996 s108")).toBe(true);
        expect(ud.uncertainties.join(" ")).toMatch(/not a prediction/);
        expect(JSON.stringify(ud)).not.toMatch(/\b(STRONG|WEAK|winner)\b/);

        const elements = await listClaimElements(alice, c.id, ud.id);
        const byKey = Object.fromEntries(elements.map((e) => [e.elementKey, e]));
        expect(byKey.employee_status.status).toBe("supported");
        expect(byKey.dismissal.status).toBe("supported");
        expect(byKey.qualifying_service.status).toBe("supported");
        expect(byKey.qualifying_service.reasoning).toMatch(/24-month requirement/);
        expect(["potentially_supported", "information_missing", "disputed"]).toContain(byKey.reason.status);
        expect(["potentially_supported", "information_missing", "disputed"]).toContain(byKey.fairness.status);
    });

    it("marks qualifying service unsupported for short service and explains automatically unfair exceptions", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await updateEmployment(alice, c.id, { employmentStatus: "employee", startDate: "2025-11-01", endDate: "2026-03-03", stillEmployed: false });
        const candidates = await identifyClaims(alice, c.id);
        const ud = candidates.find((x) => x.claimType === "unfair_dismissal")!;
        const q = (await listClaimElements(alice, c.id, ud.id)).find((e) => e.elementKey === "qualifying_service")!;
        expect(q.status).toBe("unsupported_on_current_information");
        expect(q.reasoning).toMatch(/Automatically unfair/);
    });

    it("says a claim is not available when the ERA 2025 provision is not yet in force for the event date", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await createCase(alice, { entryRoute: "contract_change" });
        await updateEmployment(alice, c.id, { employmentStatus: "employee", startDate: "2020-01-01", endDate: "2026-05-01", stillEmployed: false });
        const candidates = await identifyClaims(alice, c.id);
        const far = candidates.find((x) => x.claimType === "fire_and_rehire")!;
        expect(far).toBeDefined();
        expect(far.uncertainties.join(" ")).toMatch(/on or after/);
        const els = await listClaimElements(alice, c.id, far.id);
        expect(els.find((e) => e.elementKey === "reason_refusal_of_variation")?.status).toBe("not_applicable");
    });

    it("returns uncertainty, not GB rules, for Northern Ireland", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await dismissedCase();
        await updateCase(alice, c.id, { jurisdiction: "northern_ireland" });
        const candidates = await identifyClaims(alice, c.id);
        const ud = candidates.find((x) => x.claimType === "unfair_dismissal")!;
        expect(ud.uncertainties.join(" ")).toMatch(/Northern Ireland/);
        expect(ud.timeLimit?.calculatedDate).toBeNull();
    });

    it("downgrades model conclusions that cite unconfirmed or invented facts (deterministic review)", () => {
        const { elements, findings } = deterministicReview(
            [
                { elementKey: "reason", status: "supported", reasoning: "This is a strong point.", supportingFactIds: ["ghost", "alleg"], contraryFactIds: [], missingInformation: [], sourceKeys: ["era1996_s94_98", "made_up_source"] },
                { elementKey: "fairness", status: "supported", reasoning: "Fine.", supportingFactIds: ["ok"], contraryFactIds: [], missingInformation: [], sourceKeys: [] },
            ],
            [
                { id: "ok", status: "confirmed", provenance: "USER_CONFIRMED", disputed: false },
                { id: "alleg", status: "confirmed", provenance: "EMPLOYER_ALLEGATION", disputed: false },
            ],
        );
        const reason = elements.find((e) => e.elementKey === "reason")!;
        expect(reason.status).toBe("disputed");
        expect(reason.supportingFactIds).toEqual(["alleg"]);
        expect(reason.reasoning).toMatch(/\[assessment removed\]/);
        expect(reason.sourceKeys).toEqual(["era1996_s94_98"]);
        expect(findings.map((f) => f.question)).toEqual(expect.arrayContaining(["supported_by_confirmed_facts", "allegation_not_treated_as_evidence", "output_within_evidence", "legal_rules_sourced"]));
        expect(elements.find((e) => e.elementKey === "fairness")!.status).toBe("supported");
    });

    it("survives a model failure by marking elements information-missing, and marks candidates stale when a fact changes", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await dismissedCase();
        MockBackend.scriptResponse("analyse_claim_v1", new Error("provider timeout"));
        MockBackend.scriptResponse("analyse_claim_v1", new Error("provider timeout"));
        const candidates = await identifyClaims(alice, c.id);
        const ud = candidates.find((x) => x.claimType === "unfair_dismissal")!;
        expect(ud.uncertainties.join(" ")).toMatch(/unavailable/);
        const els = await listClaimElements(alice, c.id, ud.id);
        expect(els.find((e) => e.elementKey === "reason")?.status).toBe("information_missing");
        expect(els.find((e) => e.elementKey === "qualifying_service")?.status).toBe("supported");

        const dismissal = (await getStructuredFact(c.id, "dismissal_date"))!;
        await correctFact(alice, c.id, dismissal.id, { value: "2026-03-10" });
        const after = await listClaimCandidates(alice, c.id);
        expect(after.every((x) => x.stale)).toBe(true);
        expect(after[0].staleReason).toMatch(/dismissal_date/);
    });

    it("rejects hallucinated fact ids from the model", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await dismissedCase();
        MockBackend.scriptResponse(
            "analyse_claim_v1",
            JSON.stringify({ elements: [{ elementKey: "reason", status: "supported", reasoning: "Employer had no reason.", supportingFactIds: ["fact-that-does-not-exist"], contraryFactIds: [], missingInformation: [] }], contraryFactIds: [], missingFacts: [], uncertainties: [], alternatives: [] }),
        );
        const candidates = await identifyClaims(alice, c.id);
        const ud = candidates.find((x) => x.claimType === "unfair_dismissal")!;
        const reason = (await listClaimElements(alice, c.id, ud.id)).find((e) => e.elementKey === "reason")!;
        expect(reason.status).toBe("information_missing");
        expect(reason.supportingFactIds).toEqual([]);
        const rr = ud.reviewerResult as { deterministicFindings: Array<{ note: string }> };
        expect(rr.deterministicFindings.some((f) => /do not exist/.test(f.note))).toBe(true);
    });
});
