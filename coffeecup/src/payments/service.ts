/**
 * Payments service — checkout creation and webhook processing.
 *
 * - The client never grants an entitlement: only a verified webhook does.
 * - Every webhook event is stored once (provider + event id unique) so a
 *   replayed event is a no-op.
 * - Refund/dispute events revoke the entitlement.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { paymentEvents, type EntitlementTier } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { requireCaseAccess, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { grantEntitlement, revokeEntitlement, paymentsEnabled } from "@/entitlements/service";
import { PRICING } from "./pricing";
import type { PaymentProvider } from "./provider";
import { BRAND } from "@/brand/config";

let provider: PaymentProvider | null = null;

export async function getPaymentProvider(): Promise<PaymentProvider> {
    if (provider) return provider;
    const name = (process.env.PAYMENT_PROVIDER ?? (process.env.STRIPE_SECRET_KEY ? "stripe" : "mock")).toLowerCase();
    if (name === "stripe") {
        const { StripePaymentProvider } = await import("./providers/stripe");
        provider = new StripePaymentProvider();
    } else {
        if (process.env.NODE_ENV === "production" && paymentsEnabled()) throw new Error("PAYMENTS_ENABLED=1 in production requires PAYMENT_PROVIDER=stripe.");
        const { MockPaymentProvider } = await import("./providers/mock");
        provider = new MockPaymentProvider();
    }
    return provider;
}

export function setPaymentProviderForTests(p: PaymentProvider | null): void {
    provider = p;
}

export async function startCheckout(actor: Actor, caseId: string, tier: EntitlementTier, opts: { customerEmail?: string | null; origin: string }): Promise<{ url: string; sessionId: string }> {
    await requireCaseAccess(actor, caseId);
    if (!paymentsEnabled()) throw new ValidationError("Payments are not enabled on this deployment; all features are available.");
    const cfg = PRICING.tiers[tier];
    if (!cfg) throw new ValidationError("Unknown product.");
    const p = await getPaymentProvider();
    const session = await p.createCheckout({
        userId: actor.userId,
        caseId,
        tier,
        amountMinor: cfg.amountMinor,
        currency: cfg.currency,
        productName: `${BRAND.name} ${cfg.name}`,
        customerEmail: opts.customerEmail ?? null,
        successUrl: `${opts.origin}/app/cases/${caseId}/upgrade/success`,
        cancelUrl: `${opts.origin}/app/cases/${caseId}/upgrade`,
    });
    await recordAudit({ userId: actor.userId, caseId, action: "payment.checkout_started", details: { tier, provider: p.name } });
    return { url: session.url, sessionId: session.id };
}

export type WebhookOutcome = "granted" | "revoked" | "duplicate" | "ignored";

export async function handleWebhook(rawBody: string, signature: string | null): Promise<{ outcome: WebhookOutcome; eventId: string }> {
    const p = await getPaymentProvider();
    const event = await p.verifyWebhook(rawBody, signature); // throws on bad signature
    const db = await getDb();

    const existing = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(and(eq(paymentEvents.provider, p.name), eq(paymentEvents.providerEventId, event.providerEventId))).limit(1);
    if (existing.length > 0) return { outcome: "duplicate", eventId: event.providerEventId };

    const rowId = newId();
    await db.insert(paymentEvents).values({ id: rowId, provider: p.name, providerEventId: event.providerEventId, type: event.type, payload: event as unknown as Record<string, unknown> });

    let outcome: WebhookOutcome = "ignored";
    if (event.type === "checkout.completed") {
        await grantEntitlement({ userId: event.userId, caseId: event.caseId, tier: event.tier, source: p.name, paymentRef: event.paymentRef });
        outcome = "granted";
    } else if (event.type === "refund") {
        const n = await revokeEntitlement({ paymentRef: event.paymentRef, reason: "refunded" });
        outcome = n > 0 ? "revoked" : "ignored";
    }
    await db.update(paymentEvents).set({ processedAt: new Date(), outcome }).where(eq(paymentEvents.id, rowId));
    return { outcome, eventId: event.providerEventId };
}
