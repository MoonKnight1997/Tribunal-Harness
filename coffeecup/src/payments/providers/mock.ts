/**
 * Mock payment provider for development and tests. "Webhooks" are JSON bodies
 * signed with an HMAC using MOCK_PAYMENT_SECRET so the verification path is
 * exercised end to end.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutRequest, CheckoutSession, PaymentEvent, PaymentProvider } from "../provider";
import type { EntitlementTier } from "@/db/schema";

export class MockPaymentProvider implements PaymentProvider {
    readonly name = "mock";
    constructor(private readonly secret = process.env.MOCK_PAYMENT_SECRET ?? "mock-secret") {}

    async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
        const id = `mock_cs_${req.caseId.slice(0, 8)}_${req.tier}_${Date.now()}`;
        const url = `${req.successUrl}${req.successUrl.includes("?") ? "&" : "?"}mock_session=${encodeURIComponent(id)}`;
        return { id, url };
    }

    sign(body: string): string {
        return createHmac("sha256", this.secret).update(body).digest("hex");
    }

    /** Build a signed mock webhook body for a completed checkout. */
    buildCompletedWebhook(input: { sessionId: string; userId: string; caseId: string; tier: EntitlementTier; eventId?: string }): { body: string; signature: string } {
        const body = JSON.stringify({ id: input.eventId ?? `evt_${input.sessionId}`, type: "checkout.completed", sessionId: input.sessionId, userId: input.userId, caseId: input.caseId, tier: input.tier });
        return { body, signature: this.sign(body) };
    }

    buildRefundWebhook(input: { sessionId: string; eventId?: string }): { body: string; signature: string } {
        const body = JSON.stringify({ id: input.eventId ?? `evt_refund_${input.sessionId}`, type: "refund", sessionId: input.sessionId });
        return { body, signature: this.sign(body) };
    }

    async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent> {
        if (!signatureHeader) throw new Error("Missing signature.");
        const expected = this.sign(rawBody);
        const a = Buffer.from(expected);
        const b = Buffer.from(signatureHeader);
        if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid webhook signature.");
        const parsed = JSON.parse(rawBody) as { id: string; type: string; sessionId?: string; userId?: string; caseId?: string; tier?: EntitlementTier };
        if (parsed.type === "checkout.completed" && parsed.sessionId && parsed.userId && parsed.caseId && parsed.tier) {
            return { type: "checkout.completed", providerEventId: parsed.id, sessionId: parsed.sessionId, userId: parsed.userId, caseId: parsed.caseId, tier: parsed.tier, paymentRef: parsed.sessionId };
        }
        if (parsed.type === "refund" && parsed.sessionId) return { type: "refund", providerEventId: parsed.id, paymentRef: parsed.sessionId };
        return { type: "ignored", providerEventId: parsed.id, rawType: parsed.type };
    }
}
