import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleWebhook } from "@/payments/service";
import { track } from "@/analytics/service";

/**
 * Payment provider webhook. The raw body is verified against the provider's
 * signature before anything is trusted. Invalid signatures get 400; duplicate
 * events are acknowledged (200) so the provider stops retrying.
 */
export async function POST(request: NextRequest) {
    const raw = await request.text();
    const signature = request.headers.get("stripe-signature") ?? request.headers.get("x-mock-signature");
    try {
        const result = await handleWebhook(raw, signature);
        if (result.outcome === "granted") await track("paid_conversion", null, { provider: "webhook" });
        return NextResponse.json({ received: true, outcome: result.outcome });
    } catch (err) {
        console.warn("[payments] webhook rejected:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Webhook rejected." }, { status: 400 });
    }
}
