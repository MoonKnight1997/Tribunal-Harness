/**
 * Stripe adapter. One-off Checkout Session per case entitlement; webhook
 * signature verified with the official SDK; refunds revoke the entitlement.
 *
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 */

import type Stripe from "stripe";
import type { CheckoutRequest, CheckoutSession, PaymentEvent, PaymentProvider } from "../provider";
import type { EntitlementTier } from "@/db/schema";

export class StripePaymentProvider implements PaymentProvider {
    readonly name = "stripe";
    private client: Stripe | null = null;
    private readonly secretKey: string;
    private readonly webhookSecret: string;

    constructor(opts?: { secretKey?: string; webhookSecret?: string; client?: Stripe }) {
        this.secretKey = opts?.secretKey ?? process.env.STRIPE_SECRET_KEY ?? "";
        this.webhookSecret = opts?.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? "";
        if (opts?.client) this.client = opts.client;
        if (!this.secretKey && !opts?.client) throw new Error("STRIPE_SECRET_KEY is not set.");
    }

    private async stripe(): Promise<Stripe> {
        if (this.client) return this.client;
        const { default: StripeCtor } = await import("stripe");
        this.client = new StripeCtor(this.secretKey);
        return this.client;
    }

    async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
        const stripe = await this.stripe();
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            success_url: req.successUrl,
            cancel_url: req.cancelUrl,
            customer_email: req.customerEmail ?? undefined,
            line_items: [{ quantity: 1, price_data: { currency: req.currency, unit_amount: req.amountMinor, product_data: { name: req.productName } } }],
            metadata: { userId: req.userId, caseId: req.caseId, tier: req.tier },
            client_reference_id: `${req.userId}:${req.caseId}:${req.tier}`,
        });
        if (!session.url) throw new Error("Stripe did not return a checkout URL.");
        return { id: session.id, url: session.url };
    }

    async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent> {
        if (!this.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
        if (!signatureHeader) throw new Error("Missing Stripe-Signature header.");
        const stripe = await this.stripe();
        const event = stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
        if (event.type === "checkout.session.completed") {
            const s = event.data.object as Stripe.Checkout.Session;
            const meta = s.metadata ?? {};
            const tier = meta.tier as EntitlementTier;
            if (!meta.userId || !meta.caseId || (tier !== "case_pass" && tier !== "claim_pack")) throw new Error("Checkout session is missing entitlement metadata.");
            if (s.payment_status !== "paid") return { type: "ignored", providerEventId: event.id, rawType: `${event.type}:${s.payment_status}` };
            return { type: "checkout.completed", providerEventId: event.id, sessionId: s.id, userId: meta.userId, caseId: meta.caseId, tier, paymentRef: s.id };
        }
        if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
            const charge = event.data.object as Stripe.Charge | Stripe.Dispute;
            const paymentIntent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
            // Resolve the checkout session for this payment intent so the entitlement can be found by paymentRef.
            let sessionId: string | null = null;
            if (paymentIntent) {
                const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 1 });
                sessionId = sessions.data[0]?.id ?? null;
            }
            if (!sessionId) return { type: "ignored", providerEventId: event.id, rawType: `${event.type}:no-session` };
            return { type: "refund", providerEventId: event.id, paymentRef: sessionId };
        }
        return { type: "ignored", providerEventId: event.id, rawType: event.type };
    }
}
