/**
 * Pricing configuration. Prices are test prices for an initial experiment and
 * are configurable by environment; they are never hard-coded in the UI.
 * There is no per-message charge and no token/credit exposure to consumers.
 */

import type { EntitlementTier } from "@/db/schema";

export interface TierConfig {
    id: EntitlementTier;
    name: string;
    /** Minor units (pence). */
    amountMinor: number;
    currency: "gbp";
    description: string;
    includes: string[];
}

function pence(envName: string, fallback: number): number {
    const raw = process.env[envName];
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export const PRICING = {
    free: {
        name: "Free",
        includes: ["Initial triage of your problem", "Jurisdiction and urgent deadline warnings", "A limited timeline", "Official and free support routes"],
    },
    tiers: {
        case_pass: {
            id: "case_pass",
            name: "Case Pass",
            amountMinor: pence("PRICE_CASE_PASS_PENCE", 699),
            currency: "gbp",
            description: "Everything you need to organise and progress a workplace problem.",
            includes: ["Persistent case workspace", "Documents and extraction", "Full chronology", "Grievance, disciplinary and appeal workflows", "Acas workspace", "Standard exports"],
        },
        claim_pack: {
            id: "claim_pack",
            name: "Claim Pack",
            amountMinor: pence("PRICE_CLAIM_PACK_PENCE", 999),
            currency: "gbp",
            description: "For when a tribunal claim is on the table.",
            includes: ["Everything in Case Pass", "Possible-claim analysis (where enabled)", "Claim and evidence maps", "ET1 readiness pack", "Final case handoff export"],
        },
    } satisfies Record<EntitlementTier, TierConfig>,
} as const;

export function formatPrice(amountMinor: number): string {
    return `£${(amountMinor / 100).toFixed(2)}`;
}
