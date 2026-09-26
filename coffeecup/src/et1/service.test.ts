import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeDb } from "@/db/client";
import { signUp } from "@/auth/service";
import { createCase, updateEmployment, listCases } from "@/cases/service";
import { setStructuredFact, addFact, listConfirmedFacts } from "@/facts/service";
import { addEvent } from "@/timeline/service";
import { addIssue } from "@/issues/service";
import { startProcess, updateProcessData } from "@/processes/service";
import { buildEt1ReadinessPack, renderEt1Pack, saveEt1PackArtifact } from "./service";
import { buildCasePack, renderCasePackMarkdown } from "@/exports/service";
import { resourcesFor } from "@/resources/directory";
import { triage, createCaseFromIntake } from "@/intake/service";
import { buildDashboard } from "@/cases/dashboard";
import { handleWebhook, startCheckout, setPaymentProviderForTests } from "@/payments/service";
import { MockPaymentProvider } from "@/payments/providers/mock";
import { hasEntitlement, listEntitlements } from "@/entitlements/service";
import { generateArtifact } from "@/artifacts/service";
import { EntitlementRequiredError } from "@/lib/errors";
import { purgeCaseNow, deleteAccount } from "@/cases/retention";
import { uploadDocument, getDocumentBytes } from "@/documents/service";
import { identifyClaims } from "@/claims/service";

let alice: { userId: string };

beforeAll(async () => {
    const a = await signUp({ email: "alice@example.com", password: "a strong password", acceptedTerms: true });
    alice = { userId: a.user.id };
});

afterAll(async () => {
    await closeDb();
});

describe("ET1 readiness pack", () => {
    it("assembles structured sections from the case and lists what is missing", async () => {
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await updateEmployment(alice, c.id, { employerName: "Acme Ltd", employmentStatus: "employee", startDate: "2021-03-01", endDate: "2026-03-03", stillEmployed: false, jobTitle: "Driver" });
        await setStructuredFact(alice, c.id, "dismissal_date", "2026-03-03", "I was dismissed on 3 March 2026.");
        await addFact(alice, c.id, { statement: "No hearing was held before I was dismissed.", status: "confirmed" });
        await addFact(alice, c.id, { statement: "The employer says I was late three times.", status: "confirmed", provenance: "EMPLOYER_ALLEGATION" });
        await addEvent(alice, c.id, { date: "2026-03-03", title: "Dismissed by letter", category: "dismissal" });
        await addIssue(alice, c.id, { title: "Dismissal", category: "dismissal", desiredResolution: "Compensation for lost earnings." });
        const acas = await startProcess(alice, c.id, { type: "acas_early_conciliation", startedOn: "2026-04-01" });
        await updateProcessData(alice, c.id, acas.id, { notificationDate: "2026-04-01", certificateIssueDate: "2026-04-29", certificateStatus: "issued", certificateNumber: "R123456/26/01" });

        const pack = await buildEt1ReadinessPack(alice, c.id, { userEmail: "alice@example.com", userName: null });
        expect(pack.respondent.data.employerName).toBe("Acme Ltd");
        expect(pack.respondent.missing.join(" ")).toMatch(/legal name/);
        expect(pack.acas.data.certificateNumber).toBe("R123456/26/01");
        expect(pack.acas.missing).toHaveLength(0);
        expect(pack.timeLimits.data[0].date).toBe("2026-06-30");
        expect(pack.timeLimits.data[0].sourceReference).toBe("ERA 1996 s111(2)");
        expect(pack.particulars.data).toContain("No hearing was held before I was dismissed.");
        // Employer allegations are not presented as the worker's particulars.
        expect(pack.particulars.data.join(" ")).not.toMatch(/late three times/);
        expect(pack.remedy.data.desiredResolution).toContain("Compensation for lost earnings.");
        expect(pack.claimCategories.missing.join(" ")).toMatch(/not enabled/);
        expect(pack.missingRequired.join(" ")).toMatch(/legal name/);
        expect(pack.filing.officialRoute.url).toMatch(/gov\.uk/);
        expect(pack.filing.note).toMatch(/does not submit/);

        const md = renderEt1Pack(pack);
        expect(md).toMatch(/# ET1 readiness pack/);
        expect(md).toMatch(/Where to file/);
        expect(md).toMatch(/\[ \] The employer's legal name/);
        const saved = await saveEt1PackArtifact(alice, c.id, pack);
        expect(saved.type).toBe("et1_readiness_pack");
        expect(saved.version).toBe(1);
    });

    it("includes claim categories when the flag is on", async () => {
        process.env.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION = "true";
        const c = await createCase(alice, { entryRoute: "dismissal" });
        await updateEmployment(alice, c.id, { employmentStatus: "employee", startDate: "2021-03-01", endDate: "2026-03-03", stillEmployed: false });
        await identifyClaims(alice, c.id);
        const pack = await buildEt1ReadinessPack(alice, c.id);
        expect(pack.claimCategories.data.some((x) => x.claimType === "unfair_dismissal")).toBe(true);
        expect(pack.provenance.claimCandidateIds.length).toBeGreaterThan(0);
    });
});

describe("case pack export", () => {
    it("renders JSON and Markdown containing the whole record", async () => {
        const c = await createCase(alice, { entryRoute: "grievance" });
        await updateEmployment(alice, c.id, { employerName: "Acme Ltd" });
        await addEvent(alice, c.id, { date: "2026-01-10", title: "Told my shifts were changing", category: "communication" });
        await generateArtifact(alice, c.id, "chronology");
        const pack = await buildCasePack(alice, c.id);
        expect(pack.events).toHaveLength(1);
        expect(pack.artifacts).toHaveLength(1);
        const md = renderCasePackMarkdown(pack);
        expect(md).toMatch(/# Case pack: My grievance/);
        expect(md).toMatch(/Told my shifts were changing/);
        expect(md).toMatch(/Important dates/);
        expect(md).toMatch(/legal information/i);
    });
});

describe("resource directory", () => {
    it("filters by jurisdiction and ranks by relevance without commercial bias", () => {
        const ni = resourcesFor({ jurisdiction: "northern_ireland", tags: ["dismissal"] });
        expect(ni.some((r) => r.id === "lra_ni")).toBe(true);
        expect(ni.some((r) => r.id === "acas")).toBe(false);
        const ew = resourcesFor({ jurisdiction: "england_wales", tags: ["acas_early_conciliation"] });
        expect(ew[0].id).toBe("acas");
        expect(ew.find((r) => r.category === "commercial")?.description).toMatch(/No service is recommended/);
    });
});

describe("intake", () => {
    it("anonymous triage suggests routes, gives an urgency warning and official resources, without persisting", async () => {
        const before = (await listCases(alice)).length;
        const res = await triage({ jurisdiction: "england_wales", entryRoute: "not_sure", description: "I was sacked last week after I complained about unpaid overtime and my manager shouting at me.", stillEmployed: false, endDate: "2026-09-15" });
        expect(res.suggestedRoutes.map((r) => r.route)).toEqual(expect.arrayContaining(["dismissal", "pay"]));
        expect(res.urgency.level).toBe("watch");
        expect(res.urgency.deadline).toBe("2026-12-14");
        expect(res.resources.some((r) => r.name === "Acas")).toBe(true);
        expect((await listCases(alice)).length).toBe(before);
    });

    it("flags an expired time limit at triage", async () => {
        const res = await triage({ jurisdiction: "england_wales", entryRoute: "dismissal", description: "", stillEmployed: false, endDate: "2025-01-10" });
        expect(res.urgency.level).toBe("expired");
    });

    it("creates a case with structured facts, Acas process and deadlines from intake answers", async () => {
        const { caseId } = await createCaseFromIntake(alice, {
            jurisdiction: "england_wales",
            entryRoute: "acas_certificate_received",
            description: "I was dismissed on 3 March 2026 and Acas has sent me a certificate.",
            stillEmployed: false,
            employmentStatus: "employee",
            employerName: "Acme Ltd",
            startDate: "2021-03-01",
            endDate: "2026-03-03",
            acasNotificationDate: "2026-04-01",
            acasCertificateDate: "2026-04-29",
            acasCertificateNumber: "R000/26/01",
            desiredOutcome: "My job back or compensation.",
        });
        const dash = await buildDashboard(alice, caseId);
        expect(dash.case.stage).toBe("acas_early_conciliation");
        expect(dash.processes.some((p) => p.type === "acas_early_conciliation" && p.state === "certificate_issued")).toBe(true);
        expect(dash.important[0].date).toBe("2026-06-30");
        expect(dash.nextSteps.length).toBeGreaterThan(0);
        expect(dash.counts.facts).toBeGreaterThanOrEqual(3);
        const facts = await listConfirmedFacts(caseId);
        expect(facts.find((f) => f.key === "acas_day_b")?.value).toBe("2026-04-29");
    });
});

describe("payments and entitlements", () => {
    const mock = new MockPaymentProvider("test-secret");

    it("grants entitlements only from a verified webhook, ignores replays, and revokes on refund", async () => {
        process.env.PAYMENTS_ENABLED = "1";
        setPaymentProviderForTests(mock);
        const c = await createCase(alice, { entryRoute: "dismissal" });
        expect(await hasEntitlement(alice, c.id, "case_pass")).toBe(false);
        await expect(generateArtifact(alice, c.id, "chronology")).rejects.toBeInstanceOf(EntitlementRequiredError);

        const checkout = await startCheckout(alice, c.id, "case_pass", { origin: "http://localhost:3000" });
        expect(checkout.url).toMatch(/upgrade\/success/);

        // Tampered signature is rejected.
        const hook = mock.buildCompletedWebhook({ sessionId: checkout.sessionId, userId: alice.userId, caseId: c.id, tier: "case_pass" });
        await expect(handleWebhook(hook.body, "deadbeef")).rejects.toThrow(/signature/i);
        expect(await hasEntitlement(alice, c.id, "case_pass")).toBe(false);

        const first = await handleWebhook(hook.body, hook.signature);
        expect(first.outcome).toBe("granted");
        expect(await hasEntitlement(alice, c.id, "case_pass")).toBe(true);
        expect(await hasEntitlement(alice, c.id, "claim_pack")).toBe(false);
        const second = await handleWebhook(hook.body, hook.signature);
        expect(second.outcome).toBe("duplicate");
        expect((await listEntitlements(alice, c.id)).filter((e) => e.status === "active")).toHaveLength(1);

        const chron = await generateArtifact(alice, c.id, "chronology");
        expect(chron.type).toBe("chronology");

        const refund = mock.buildRefundWebhook({ sessionId: checkout.sessionId });
        expect((await handleWebhook(refund.body, refund.signature)).outcome).toBe("revoked");
        expect(await hasEntitlement(alice, c.id, "case_pass")).toBe(false);
        expect((await listEntitlements(alice, c.id))[0].status).toBe("refunded");

        // Deadlines are never paywalled.
        const dash = await buildDashboard(alice, c.id);
        expect(dash.important.length).toBeGreaterThan(0);
        setPaymentProviderForTests(null);
    });

    it("claim pack covers case pass features", async () => {
        process.env.PAYMENTS_ENABLED = "1";
        setPaymentProviderForTests(mock);
        const c = await createCase(alice, { entryRoute: "dismissal" });
        const hook = mock.buildCompletedWebhook({ sessionId: `cs_${c.id}`, userId: alice.userId, caseId: c.id, tier: "claim_pack" });
        await handleWebhook(hook.body, hook.signature);
        expect(await hasEntitlement(alice, c.id, "case_pass")).toBe(true);
        expect(await hasEntitlement(alice, c.id, "claim_pack")).toBe(true);
        setPaymentProviderForTests(null);
    });
});

describe("deletion", () => {
    it("purges a case and its stored files, and deletes an account with all its cases", async () => {
        const other = await signUp({ email: "leaver@example.com", password: "a strong password", acceptedTerms: true });
        const leaver = { userId: other.user.id };
        const c = await createCase(leaver, { entryRoute: "pay" });
        const { document } = await uploadDocument(leaver, c.id, { filename: "payslip.txt", mimeType: "text/plain", body: Buffer.from("Net pay 1 March 2026: £1,200") });
        await purgeCaseNow(leaver.userId, c.id);
        await expect(getDocumentBytes(leaver, c.id, document.id)).rejects.toThrow(/not found/i);
        expect(await listCases(leaver)).toHaveLength(0);

        const c2 = await createCase(leaver, { entryRoute: "pay" });
        await deleteAccount(leaver.userId);
        await expect(listCases(leaver)).resolves.toEqual([]);
        await expect(buildDashboard(leaver, c2.id)).rejects.toThrow(/not found/i);
    });
});
