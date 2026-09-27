import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { closeDb, getDb } from "@/db/client";
import { artifacts, usageCounters } from "@/db/schema";
import { signUp } from "@/auth/service";
import { createCase, updateEmployment, addPerson } from "@/cases/service";
import { addEvent } from "@/timeline/service";
import { addFact } from "@/facts/service";
import { startProcess } from "@/processes/service";
import { generateArtifact, editArtifact, getArtifact, hashPayload } from "./service";
import { ARTIFACT_POLICY, assertArtifactAllowed } from "./policy";
import { tierForArtifact } from "@/entitlements/service";
import { buildEt1ReadinessPack, saveEt1PackArtifact } from "@/et1/service";
import { proposeSituationSummary } from "@/cases/dashboard";
import { handleWebhook, startCheckout, setPaymentProviderForTests } from "@/payments/service";
import { MockPaymentProvider } from "@/payments/providers/mock";
import { offeredPricing } from "@/payments/pricing";
import { MockBackend } from "@/ai/providers/mock";
import { createProvider } from "@/ai/structured";
import { resolveModelFor, setProviderForTests } from "@/ai/routing";
import type { LLMProvider, TextRequest } from "@/ai/provider";
import { EntitlementRequiredError, FeatureDisabledError, NotFoundError, ValidationError } from "@/lib/errors";
import { ARTIFACT_TYPES } from "@/db/enums";

let alice: { userId: string };
let bob: { userId: string };

/** A real mock provider wrapped so tests can see every text request. */
const textCalls: TextRequest[] = [];
function spyProvider(): LLMProvider {
    const real = createProvider(new MockBackend(), (cap) => resolveModelFor(cap, "mock"));
    return {
        name: real.name,
        structuredGenerate: (req) => real.structuredGenerate(req),
        textGenerate: async (req) => {
            textCalls.push(req);
            return real.textGenerate(req);
        },
    };
}

async function usageCount(userId: string, caseId: string): Promise<number> {
    const db = await getDb();
    const rows = await db.select().from(usageCounters).where(and(eq(usageCounters.userId, userId), eq(usageCounters.caseId, caseId), eq(usageCounters.kind, "ai_generation")));
    return rows.reduce((n, r) => n + r.count, 0);
}

async function rowById(id: string) {
    const db = await getDb();
    return (await db.select().from(artifacts).where(eq(artifacts.id, id)))[0];
}

async function seededCase(actor: { userId: string }) {
    const c = await createCase(actor, { entryRoute: "dismissal" });
    await updateEmployment(actor, c.id, { employerName: "Acme Ltd", employmentStatus: "employee", startDate: "2021-03-01", endDate: "2026-03-03", stillEmployed: false, jobTitle: "Driver" });
    await addPerson(actor, c.id, { name: "Jane Smith", role: "manager" });
    await addEvent(actor, c.id, { date: "2026-03-03", title: "Dismissed by letter", category: "dismissal" });
    await addFact(actor, c.id, { statement: "No hearing was held before I was dismissed.", status: "confirmed" });
    return c;
}

beforeAll(async () => {
    alice = { userId: (await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true })).user.id };
    bob = { userId: (await signUp({ email: "bob@example.com", password: "a strong password", acceptedTerms: true })).user.id };
});

beforeEach(() => {
    MockBackend.clearScripts();
    textCalls.length = 0;
    setProviderForTests(spyProvider());
});

afterEach(() => {
    setProviderForTests(null);
    setPaymentProviderForTests(null);
});

afterAll(async () => {
    await closeDb();
});

// ── F02: editArtifact must not accept unexpected keys or move rows ───────────

describe("F02 editArtifact", () => {
    it("rejects caseId / generatedBy / basis / stale before any write and leaves the row untouched", async () => {
        const aliceCase = await seededCase(alice);
        const bobCase = await createCase(bob, { entryRoute: "pay" });
        const art = await generateArtifact(alice, aliceCase.id, "chronology");
        const before = await rowById(art.id);

        const attempts: unknown[] = [
            { caseId: bobCase.id },
            { content: "hi", caseId: bobCase.id },
            { generatedBy: "attacker" },
            { basis: { factIds: [], eventIds: [], documentIds: [], inputsHash: "x" } },
            { stale: false },
            { status: "published" },
            { title: "" },
            {},
        ];
        for (const patch of attempts) {
            await expect(editArtifact(alice, aliceCase.id, art.id, patch)).rejects.toBeInstanceOf(ValidationError);
        }
        const after = await rowById(art.id);
        expect(after.caseId).toBe(aliceCase.id);
        expect(after.generatedBy).toBe(before.generatedBy);
        expect(after.basis).toEqual(before.basis);
        expect(after.stale).toBe(before.stale);
        expect(after.content).toBe(before.content);
        expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

        // Bob still cannot see it, through his own case id or Alice's.
        await expect(getArtifact(bob, bobCase.id, art.id)).rejects.toBeInstanceOf(ValidationError);
        await expect(getArtifact(bob, aliceCase.id, art.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("accepts content, title and status; the first content edit keeps the generated original", async () => {
        const c = await seededCase(alice);
        const art = await generateArtifact(alice, c.id, "chronology");
        expect(art.userEditedAt).toBeNull();
        expect(art.generatedContent).toBeNull();

        const renamed = await editArtifact(alice, c.id, art.id, { title: "My chronology", status: "final" });
        expect(renamed.title).toBe("My chronology");
        expect(renamed.status).toBe("final");
        expect(renamed.userEditedAt).toBeNull();

        const edited = await editArtifact(alice, c.id, art.id, { content: `${art.content}\n\nAdded by me.` });
        expect(edited.userEditedAt).not.toBeNull();
        expect(edited.generatedContent).toBe(art.content);

        const again = await editArtifact(alice, c.id, art.id, { content: "Rewritten entirely." });
        expect(again.generatedContent).toBe(art.content);
        expect(again.userEditedAt?.getTime()).toBe(edited.userEditedAt?.getTime());
    });

    it("cannot edit another user's artifact even with the right artifact id", async () => {
        const aliceCase = await seededCase(alice);
        const art = await generateArtifact(alice, aliceCase.id, "chronology");
        await expect(editArtifact(bob, aliceCase.id, art.id, { content: "x" })).rejects.toBeInstanceOf(NotFoundError);
        expect((await rowById(art.id)).content).toBe(art.content);
    });
});

// ── F07: policy gates every generation path ─────────────────────────────────

describe("F07 artifact policy", () => {
    it("has an entry for every artifact type and drives tierForArtifact", () => {
        for (const t of ARTIFACT_TYPES) {
            expect(ARTIFACT_POLICY[t]).toBeDefined();
            expect(tierForArtifact(t)).toBe(ARTIFACT_POLICY[t].tier);
        }
        expect(ARTIFACT_POLICY.case_pack.allowedViaGenericGeneration).toBe(false);
        expect(ARTIFACT_POLICY.et1_readiness_pack.flags).toEqual(["ENABLE_PERSONALISED_ET1_DRAFTING"]);
        expect(ARTIFACT_POLICY.potential_claims_summary.flags).toEqual(["ENABLE_PERSONALISED_CLAIM_IDENTIFICATION"]);
    });

    it("refuses model-drafted ET1 and possible-claims output with flags off: no row, no usage, no model call", async () => {
        const c = await seededCase(alice);
        for (const type of ["et1_readiness_pack", "potential_claims_summary"] as const) {
            await expect(generateArtifact(alice, c.id, type)).rejects.toBeInstanceOf(FeatureDisabledError);
            await expect(assertArtifactAllowed(alice, c.id, type)).rejects.toMatchObject({ code: "feature_disabled", status: 404 });
        }
        const db = await getDb();
        expect(await db.select().from(artifacts).where(eq(artifacts.caseId, c.id))).toHaveLength(0);
        expect(await usageCount(alice.userId, c.id)).toBe(0);
        expect(textCalls).toHaveLength(0);
    });

    it("drafts them when the flags are on (mock provider, offline)", async () => {
        process.env.ENABLE_PERSONALISED_ET1_DRAFTING = "true";
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await seededCase(alice);
        const et1 = await generateArtifact(alice, c.id, "et1_readiness_pack");
        expect(et1.generation?.task).toBe("draft_et1_readiness_pack_v2");
        expect(et1.generation?.provider).toBe("mock");
        const claims = await generateArtifact(alice, c.id, "potential_claims_summary");
        expect(claims.type).toBe("potential_claims_summary");
        expect(textCalls).toHaveLength(2);
        expect(await usageCount(alice.userId, c.id)).toBe(2);
    });

    it("keeps the deterministic ET1 readiness pack available with every flag off", async () => {
        const c = await seededCase(alice);
        const pack = await buildEt1ReadinessPack(alice, c.id);
        const saved = await saveEt1PackArtifact(alice, c.id, pack);
        expect(saved.type).toBe("et1_readiness_pack");
        expect(saved.generation).toMatchObject({ provider: "deterministic", task: "et1_readiness_pack_v1", payloadHash: hashPayload(JSON.stringify(pack)) });
        expect(saved.generation?.ruleVersions.length).toBeGreaterThan(0);
        expect(saved.generation?.sourceVersions.map((s) => s.key)).toContain("govuk_et1");
        expect(saved.reviewFlags).toEqual([]);
        expect(textCalls).toHaveLength(0);
        // A pack built for one case cannot be saved to another.
        const other = await createCase(alice, { entryRoute: "pay" });
        await expect(saveEt1PackArtifact(alice, other.id, pack)).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses case_pack via generateArtifact and points to the export", async () => {
        const c = await seededCase(alice);
        await expect(generateArtifact(alice, c.id, "case_pack")).rejects.toThrow(/export/);
        await expect(generateArtifact(alice, c.id, "case_pack")).rejects.toBeInstanceOf(ValidationError);
        await expect(generateArtifact(alice, c.id, "not_a_type" as never)).rejects.toBeInstanceOf(ValidationError);
    });

    it("checks entitlement after flags when payments are on", async () => {
        process.env.PAYMENTS_ENABLED = "1";
        const c = await seededCase(alice);
        // Flag off wins over entitlement: still 404, not 402.
        await expect(generateArtifact(alice, c.id, "et1_readiness_pack")).rejects.toBeInstanceOf(FeatureDisabledError);
        // Flag on, nothing bought: 402.
        process.env.ENABLE_PERSONALISED_ET1_DRAFTING = "true";
        await expect(generateArtifact(alice, c.id, "et1_readiness_pack")).rejects.toBeInstanceOf(EntitlementRequiredError);
        await expect(generateArtifact(alice, c.id, "grievance_letter")).rejects.toBeInstanceOf(EntitlementRequiredError);
        expect(await usageCount(alice.userId, c.id)).toBe(0);
        expect(textCalls).toHaveLength(0);
    });

    it("generation for a guessed case id is a plain not-found", async () => {
        await expect(generateArtifact(bob, "no-such-case", "chronology")).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe("checkout and pricing agree with the flags", () => {
    const mock = new MockPaymentProvider("test-secret");

    it("refuses to sell the Claim Pack unless ENABLE_PAID_CLAIM_FEATURES is on", async () => {
        process.env.PAYMENTS_ENABLED = "1";
        setPaymentProviderForTests(mock);
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await expect(startCheckout(alice, c.id, "claim_pack", { origin: "http://localhost:3000" })).rejects.toBeInstanceOf(FeatureDisabledError);
        const casePass = await startCheckout(alice, c.id, "case_pass", { origin: "http://localhost:3000" });
        expect(casePass.url).toMatch(/upgrade\/success/);
        process.env.ENABLE_PAID_CLAIM_FEATURES = "true";
        const claimPack = await startCheckout(alice, c.id, "claim_pack", { origin: "http://localhost:3000" });
        expect(claimPack.sessionId).toBeTruthy();
    });

    it("lists the Claim Pack and claim features only when their flags are on", () => {
        const off = offeredPricing({});
        expect(off.tiers.map((t) => t.id)).toEqual(["case_pass"]);

        const packOnly = offeredPricing({ ENABLE_PAID_CLAIM_FEATURES: "true" });
        const cp = packOnly.tiers.find((t) => t.id === "claim_pack")!;
        expect(cp.includes.join(" ")).not.toMatch(/Possible-claim analysis|Drafted ET1 wording/);
        expect(cp.includes.join(" ")).toMatch(/ET1 readiness pack/);
        expect(cp.notYetEnabled).toEqual(expect.arrayContaining(["Possible-claim analysis", "Drafted ET1 wording to edit"]));

        const all = offeredPricing({ ENABLE_PAID_CLAIM_FEATURES: "true", ENABLE_PERSONALISED_CLAIM_IDENTIFICATION: "true", ENABLE_PERSONALISED_ET1_DRAFTING: "true" });
        const cpAll = all.tiers.find((t) => t.id === "claim_pack")!;
        expect(cpAll.includes).toEqual(expect.arrayContaining(["Possible-claim analysis", "Drafted ET1 wording to edit"]));
        expect(cpAll.notYetEnabled).toEqual([]);
    });

    it("a paid claim pack still cannot unlock a flagged-off feature", async () => {
        process.env.PAYMENTS_ENABLED = "1";
        setPaymentProviderForTests(mock);
        const c = await seededCase(alice);
        const hook = mock.buildCompletedWebhook({ sessionId: `cs_${c.id}`, userId: alice.userId, caseId: c.id, tier: "claim_pack" });
        await handleWebhook(hook.body, hook.signature);
        await expect(generateArtifact(alice, c.id, "potential_claims_summary")).rejects.toBeInstanceOf(FeatureDisabledError);
        const letter = await generateArtifact(alice, c.id, "grievance_letter");
        expect(letter.type).toBe("grievance_letter");
    });
});

// ── F09: supplementary input, provenance, fair use ───────────────────────────

describe("F09 supplementary input and provenance", () => {
    it("rejects extra that tries to rewrite authoritative fields", async () => {
        const c = await seededCase(alice);
        for (const extra of [{ facts: [{ statement: "I was never late." }] }, { events: [] }, { people: [{ name: "Nobody" }] }, { employer: "Evil Corp" }, { preparation: { keyIssues: ["x"], facts: [] } }, { instructions: "x".repeat(1001) }, "notes", [1]]) {
            await expect(generateArtifact(alice, c.id, "meeting_preparation", { extra })).rejects.toBeInstanceOf(ValidationError);
        }
        expect(textCalls).toHaveLength(0);
        expect(await usageCount(alice.userId, c.id)).toBe(0);
    });

    it("passes allowed notes only under supplementary, keeps the record intact and hashes the exact payload", async () => {
        const c = await seededCase(alice);
        const acas = await startProcess(alice, c.id, { type: "acas_early_conciliation", startedOn: "2026-04-01" });
        const preparation = { keyIssues: ["No hearing", "Dismissal letter gave no reason"], stepsTaken: ["Raised a grievance"], moneyIssues: "Two weeks' notice pay", desiredResolution: "Notice pay and a reference", questionsToClarify: ["Who decided?"] };
        const art = await generateArtifact(alice, c.id, "acas_preparation", { processId: acas.id, extra: { preparation } });

        expect(textCalls).toHaveLength(1);
        const sent = JSON.parse(textCalls[0].input) as { authoritative: Record<string, unknown>; supplementary: Record<string, unknown> };
        expect(Object.keys(sent).sort()).toEqual(["authoritative", "supplementary"]);
        expect(sent.supplementary).toEqual({ preparation });
        expect(sent.authoritative.preparation).toBeUndefined();
        expect(sent.authoritative.employer).toBe("Acme Ltd");
        expect((sent.authoritative.facts as unknown[]).length).toBe(1);
        expect((sent.authoritative.people as Array<{ name: string }>)[0].name).toBe("Jane Smith");
        expect(textCalls[0].task).toBe("draft_acas_preparation_v2");
        expect(textCalls[0].system).toMatch(/\[not in record\]/);
        expect(textCalls[0].system).toMatch(/never overrides/);

        expect(art.generation).toMatchObject({
            task: "draft_acas_preparation_v2",
            promptVersion: "v2",
            provider: "mock",
            model: "mock-mid",
            payloadHash: createHash("sha256").update(textCalls[0].input).digest("hex"),
            supplementaryKeys: ["preparation", "preparation.keyIssues", "preparation.stepsTaken", "preparation.moneyIssues", "preparation.desiredResolution", "preparation.questionsToClarify"],
        });
        expect(art.generation?.sourceVersions).toEqual([{ key: "acas_early_conciliation_guidance", version: "1" }]);
        expect(art.generation?.ruleVersions.length).toBeGreaterThan(0);
        expect(art.generatedBy).toBe("mock:mock-mid");
        expect(art.content).toMatch(/Two weeks' notice pay/);
        expect(art.content).toMatch(/legal information/i);

        // The supplementary notes are part of the basis hash: the same request
        // with different notes has a different basis.
        const art2 = await generateArtifact(alice, c.id, "acas_preparation", { processId: acas.id, extra: { preparation: { ...preparation, moneyIssues: "Nothing owed" } } });
        expect(art2.basis.inputsHash).not.toBe(art.basis.inputsHash);
        expect(art2.generation?.payloadHash).not.toBe(art.generation?.payloadHash);
    });

    it("records deterministic provenance for the chronology and audits without narrative", async () => {
        const c = await seededCase(alice);
        const chron = await generateArtifact(alice, c.id, "chronology");
        expect(chron.generation).toMatchObject({ provider: "deterministic", model: "deterministic", supplementaryKeys: [] });
        expect(chron.reviewFlags).toEqual([]);
        expect(textCalls).toHaveLength(0);
        expect(await usageCount(alice.userId, c.id)).toBe(0);
    });

    it("stores review flags from a scripted draft without altering the draft", async () => {
        const c = await seededCase(alice);
        const scripted = "# Meeting preparation\n\nMr Bloggs said on 14 February 2026 that the case is strong.\n\n_Generated from the case record._";
        MockBackend.scriptResponse("draft_meeting_preparation_v2", scripted);
        const art = await generateArtifact(alice, c.id, "meeting_preparation");
        expect(art.content.startsWith(scripted)).toBe(true);
        expect(art.reviewFlags.map((f) => f.kind).sort()).toEqual(["strength_assertion", "unsupported_date", "unsupported_name"]);
    });

    it("counts the situation summary against the fair-use allowance", async () => {
        const c = await seededCase(alice);
        expect(await usageCount(alice.userId, c.id)).toBe(0);
        await proposeSituationSummary(alice, c.id);
        expect(await usageCount(alice.userId, c.id)).toBe(1);
        process.env.FAIR_USE_AI_GENERATION_PER_DAY = "1";
        await expect(proposeSituationSummary(alice, c.id)).rejects.toThrow(/fair-use/);
    });
});
