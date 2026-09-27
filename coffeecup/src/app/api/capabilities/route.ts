import { NextResponse } from "next/server";
import { publicCapabilities } from "@/flags";
import { paymentsEnabled } from "@/entitlements/service";
import { offeredPricing } from "@/payments/pricing";
import { BRAND } from "@/brand/config";

/**
 * Client-safe view of what this deployment offers. No secrets. Pricing is the
 * FLAG-FILTERED offer (`offeredPricing`), so the Claim Pack and any
 * claim-related feature appear only when the corresponding flag is on.
 */
export function GET() {
    return NextResponse.json({ brand: { name: BRAND.name, strapline: BRAND.strapline }, capabilities: publicCapabilities(), payments: { enabled: paymentsEnabled(), pricing: offeredPricing() } });
}
