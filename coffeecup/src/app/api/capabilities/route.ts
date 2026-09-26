import { NextResponse } from "next/server";
import { publicCapabilities } from "@/flags";
import { paymentsEnabled } from "@/entitlements/service";
import { PRICING } from "@/payments/pricing";
import { BRAND } from "@/brand/config";

/** Client-safe view of what this deployment offers. No secrets. */
export function GET() {
    return NextResponse.json({ brand: { name: BRAND.name, strapline: BRAND.strapline }, capabilities: publicCapabilities(), payments: { enabled: paymentsEnabled(), pricing: PRICING } });
}
