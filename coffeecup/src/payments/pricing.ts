/**
 * Pricing configuration. Prices are test prices for an initial experiment and
 * are configurable by environment; they are never hard-coded in the UI.
 * There is no per-message charge and no token/credit exposure to consumers.
 */

import type { EntitlementTier } from "@/db/schema";
import { isFlagEnabled } from "@/flags";

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

/**
 * What may actually be offered on this deployment, given the regulatory
 * flags. The Claim Pack is listed only when paid claim features may be sold,
 * and each tier lists only the features that are switched on, so nothing is
 * promised that the artifact policy (src/artifacts/policy.ts) would refuse.
 */
export interface OfferedTier extends TierConfig {
    /** Features in this tier that exist but are switched off on this deployment. */
    notYetEnabled: string[];
}

export interface OfferedPricing {
    free: { name: string; includes: string[] };
    tiers: OfferedTier[];
}

export function offeredPricing(env: Record<string, string | undefined> = process.env): OfferedPricing {
    const claims = isFlagEnabled("ENABLE_PERSONALISED_CLAIM_IDENTIFICATION", env);
    const et1Drafting = isFlagEnabled("ENABLE_PERSONALISED_ET1_DRAFTING", env);
    const paidClaims = isFlagEnabled("ENABLE_PAID_CLAIM_FEATURES", env);

    const casePass: OfferedTier = { ...PRICING.tiers.case_pass, includes: [...PRICING.tiers.case_pass.includes], notYetEnabled: [] };

    const tiers: OfferedTier[] = [casePass];
    if (paidClaims) {
        const includes = ["Everything in Case Pass", "ET1 readiness pack (assembled from your record)", "Final case handoff export"];
        const notYetEnabled: string[] = [];
        (claims ? includes : notYetEnabled).push("Possible-claim analysis");
        (claims ? includes : notYetEnabled).push("Claim and evidence maps");
        (et1Drafting ? includes : notYetEnabled).push("Drafted ET1 wording to edit");
        tiers.push({ ...PRICING.tiers.claim_pack, includes, notYetEnabled });
    }
    return { free: { name: PRICING.free.name, includes: [...PRICING.free.includes] }, tiers };
}

export function formatPrice(amountMinor: number): string {
    return `£${(amountMinor / 100).toFixed(2)}`;
}
