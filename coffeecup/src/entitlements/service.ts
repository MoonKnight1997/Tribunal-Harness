/**
 * Entitlements — what a user may do on a case.
 *
 * Entitlements are persisted separately from payment events and are never
 * granted from the client. `PAYMENTS_ENABLED=0` (the default while pricing is
 * experimental) makes every case fully entitled so the product can be used
 * and tested without a payment provider; when payments are on, the free tier
 * covers triage, urgent deadline warnings, a limited timeline and official
 * resources, and everything else needs a Case Pass or Claim Pack.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { entitlements, type ArtifactType, type EntitlementTier } from "@/db/schema";
import { newId } from "@/lib/ids";
import { EntitlementRequiredError } from "@/lib/errors";
import type { Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { PRICING } from "@/payments/pricing";

export type EntitlementRow = typeof entitlements.$inferSelect;

export function paymentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
    return env.PAYMENTS_ENABLED === "1" || env.PAYMENTS_ENABLED === "true";
}

export async function listEntitlements(actor: Actor, caseId: string): Promise<EntitlementRow[]> {
    const db = await getDb();
    return db.select().from(entitlements).where(and(eq(entitlements.caseId, caseId), eq(entitlements.userId, actor.userId)));
}

export async function hasEntitlement(actor: Actor, caseId: string, tier: EntitlementTier): Promise<boolean> {
    if (!paymentsEnabled()) return true;
    const rows = await listEntitlements(actor, caseId);
    const active = rows.filter((r) => r.status === "active");
    if (tier === "case_pass") return active.some((r) => r.tier === "case_pass" || r.tier === "claim_pack");
    return active.some((r) => r.tier === "claim_pack");
}

export async function requireEntitlement(actor: Actor, caseId: string, tier: EntitlementTier): Promise<void> {
    if (!(await hasEntitlement(actor, caseId, tier))) throw new EntitlementRequiredError(PRICING.tiers[tier].name);
}

/** Which artifacts need which tier. Deadline information is never paywalled. */
export function tierForArtifact(type: ArtifactType): EntitlementTier | null {
    switch (type) {
        case "potential_claims_summary":
        case "et1_readiness_pack":
        case "case_pack":
            return "claim_pack";
        default:
            return "case_pass";
    }
}

export async function requireEntitlementForArtifact(actor: Actor, caseId: string, type: ArtifactType): Promise<void> {
    const tier = tierForArtifact(type);
    if (tier) await requireEntitlement(actor, caseId, tier);
}

/** Server-side grant. Only the payment webhook handler and admin tooling call this. */
export async function grantEntitlement(input: { userId: string; caseId: string; tier: EntitlementTier; source: string; paymentRef?: string | null }): Promise<EntitlementRow> {
    const db = await getDb();
    const existing = (await db.select().from(entitlements).where(and(eq(entitlements.userId, input.userId), eq(entitlements.caseId, input.caseId), eq(entitlements.tier, input.tier), eq(entitlements.status, "active"))))[0];
    if (existing) return existing;
    const id = newId();
    await db.insert(entitlements).values({ id, userId: input.userId, caseId: input.caseId, tier: input.tier, source: input.source, paymentRef: input.paymentRef ?? null });
    await recordAudit({ userId: input.userId, caseId: input.caseId, action: "entitlement.granted", targetType: "entitlement", targetId: id, details: { tier: input.tier, source: input.source } });
    return (await db.select().from(entitlements).where(eq(entitlements.id, id)))[0];
}

export async function revokeEntitlement(input: { paymentRef: string; reason: "refunded" | "revoked" }): Promise<number> {
    const db = await getDb();
    const rows = await db.update(entitlements).set({ status: input.reason, revokedAt: new Date(), revokedReason: input.reason }).where(and(eq(entitlements.paymentRef, input.paymentRef), eq(entitlements.status, "active"))).returning();
    for (const r of rows) await recordAudit({ userId: r.userId, caseId: r.caseId, action: "entitlement.revoked", targetType: "entitlement", targetId: r.id, details: { reason: input.reason } });
    return rows.length;
}
