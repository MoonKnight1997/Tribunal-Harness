/**
 * Payment provider abstraction.
 *
 * The commercial object is a Case entitlement (Case Pass / Claim Pack), not
 * a subscription and not per-message credit. The provider only creates a
 * checkout and verifies/decodes webhooks; entitlements are granted by the
 * payments service after verification, never from the client.
 */

import type { EntitlementTier } from "@/db/schema";

export interface CheckoutRequest {
    userId: string;
    caseId: string;
    tier: EntitlementTier;
    amountMinor: number;
    currency: "gbp";
    productName: string;
    customerEmail?: string | null;
    successUrl: string;
    cancelUrl: string;
}

export interface CheckoutSession {
    /** Provider's id for the session; stored as entitlement.paymentRef. */
    id: string;
    /** Where to send the user to pay. */
    url: string;
}

export type PaymentEvent =
    | { type: "checkout.completed"; providerEventId: string; sessionId: string; userId: string; caseId: string; tier: EntitlementTier; paymentRef: string }
    | { type: "refund"; providerEventId: string; paymentRef: string }
    | { type: "ignored"; providerEventId: string; rawType: string };

export interface PaymentProvider {
    readonly name: string;
    createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
    /** Verify the signature and decode the event. Throws on invalid signature. */
    verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent>;
}
