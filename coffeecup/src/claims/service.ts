/**
 * Claims service — persists ClaimCandidates and ClaimElements for a case.
 *
 * Gated server-side by ENABLE_PERSONALISED_CLAIM_IDENTIFICATION and (when
 * payments are on) the Claim Pack entitlement. Reads only confirmed facts.
 */

import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { claimCandidates, claimElements, type AcasProcessData } from "@/db/schema";
import { newId } from "@/lib/ids";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { getEmployment } from "@/cases/service";
import { listConfirmedFacts } from "@/facts/service";
import { listIssues } from "@/issues/service";
import { getAcasProcess } from "@/processes/service";
import { requireFlag } from "@/flags/guard";
import { requireEntitlement } from "@/entitlements/service";
import { checkAndCountUsage } from "@/entitlements/fair-use";
import { ValidationError } from "@/lib/errors";
import { getProvider } from "@/ai/routing";
import { runClaimEngine, type EngineInput } from "@/legal/claims/engine";

export type ClaimCandidateRow = typeof claimCandidates.$inferSelect;
export type ClaimElementRow = typeof claimElements.$inferSelect;

export async function buildEngineInput(actor: Actor, caseId: string): Promise<EngineInput> {
    const c = await requireCaseAccess(actor, caseId);
    const employment = await getEmployment(actor, caseId);
    const issues = await listIssues(actor, caseId);
    const facts = await listConfirmedFacts(caseId);
    const acasProc = await getAcasProcess(caseId);
    const acas = (acasProc?.data ?? {}) as AcasProcessData;
    return {
        jurisdiction: c.jurisdiction,
        entryRoute: c.entryRoute,
        issueCategories: issues.map((i) => i.category),
        employmentStatus: employment.employmentStatus,
        employmentStart: employment.startDate,
        employmentEnd: employment.endDate,
        stillEmployed: employment.stillEmployed,
        facts: facts.map((f) => ({ id: f.id, statement: f.statement, provenance: f.provenance, status: f.status, disputed: f.disputed, key: f.key, value: f.value })),
        acas: {
            status: acas.certificateStatus ?? (acas.notificationDate ? "in_progress" : "not_started"),
            dayA: acas.notificationDate ?? facts.find((f) => f.key === "acas_day_a")?.value ?? null,
            dayB: acas.certificateIssueDate ?? facts.find((f) => f.key === "acas_day_b")?.value ?? null,
        },
    };
}

function inputsHash(input: EngineInput): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
}

export async function identifyClaims(actor: Actor, caseId: string): Promise<ClaimCandidateRow[]> {
    requireFlag("ENABLE_PERSONALISED_CLAIM_IDENTIFICATION");
    await requireCaseAccess(actor, caseId);
    await requireEntitlement(actor, caseId, "claim_pack");
    const usage = await checkAndCountUsage(actor.userId, caseId, "claim_analysis");
    if (!usage.ok) throw new ValidationError(usage.reason);

    const input = await buildEngineInput(actor, caseId);
    const provider = await getProvider();
    const results = await runClaimEngine(provider, input);
    const hash = inputsHash(input);

    const db = await getDb();
    await db.delete(claimCandidates).where(eq(claimCandidates.caseId, caseId));
    for (const r of results) {
        const id = newId();
        await db.insert(claimCandidates).values({
            id,
            caseId,
            claimType: r.claimType,
            label: r.label,
            triggeredBy: r.triggeredBy,
            supportingFactIds: r.supportingFactIds,
            contraryFactIds: r.contraryFactIds,
            relevantDocumentIds: [],
            missingFacts: r.missingFacts,
            timeLimit: r.timeLimit ? { calculatedDate: r.timeLimit.calculatedDate, summary: r.timeLimit.summary } : null,
            acasStatus: r.acasStatus,
            sources: r.sources,
            uncertainties: r.uncertainties,
            alternatives: r.alternatives,
            reviewerResult: r.reviewerResult as unknown as Record<string, unknown>,
            stale: false,
            inputsHash: hash,
        });
        if (r.elements.length) {
            await db.insert(claimElements).values(
                r.elements.map((e, i) => ({ id: newId(), caseId, claimCandidateId: id, elementKey: e.elementKey, label: e.label, status: e.status, reasoning: e.reasoning, supportingFactIds: e.supportingFactIds, contraryFactIds: e.contraryFactIds, missingInformation: e.missingInformation, sourceKeys: e.sourceKeys, order: i })),
            );
        }
    }
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "claims.identified", details: { candidates: results.length, provider: provider.name } });
    return listClaimCandidates(actor, caseId);
}

export async function listClaimCandidates(actor: Actor, caseId: string): Promise<ClaimCandidateRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    return db.select().from(claimCandidates).where(eq(claimCandidates.caseId, caseId)).orderBy(asc(claimCandidates.label));
}

export async function listClaimElements(actor: Actor, caseId: string, candidateId: string): Promise<ClaimElementRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    return db.select().from(claimElements).where(eq(claimElements.claimCandidateId, candidateId)).orderBy(asc(claimElements.order));
}
