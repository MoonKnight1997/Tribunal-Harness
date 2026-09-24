/**
 * Regulatory feature flags — SERVER-SIDE controls.
 *
 * These are read from the process environment on the server only. They are
 * enforced in services and route handlers (see `requireFlag`), not merely in
 * the UI: a disabled feature has no reachable endpoint.
 *
 * Defaults are the conservative position (off) for everything that produces
 * personalised legal output or moves case data outside the system.
 */

export const FLAG_NAMES = [
    "ENABLE_PERSONALISED_CLAIM_IDENTIFICATION",
    "ENABLE_PERSONALISED_ET1_DRAFTING",
    "ENABLE_CASELAW_LLM_ANALYSIS",
    "ENABLE_EXTERNAL_CASE_REFERRAL",
    "ENABLE_PAID_CLAIM_FEATURES",
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

const DEFAULTS: Record<FlagName, boolean> = {
    ENABLE_PERSONALISED_CLAIM_IDENTIFICATION: false,
    ENABLE_PERSONALISED_ET1_DRAFTING: false,
    ENABLE_CASELAW_LLM_ANALYSIS: false,
    ENABLE_EXTERNAL_CASE_REFERRAL: false,
    ENABLE_PAID_CLAIM_FEATURES: false,
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function isFlagEnabled(name: FlagName, env: Record<string, string | undefined> = process.env): boolean {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return DEFAULTS[name];
    const v = raw.trim().toLowerCase();
    if (TRUE_VALUES.has(v)) return true;
    if (FALSE_VALUES.has(v)) return false;
    // Unrecognised values fail closed and are logged once at startup.
    console.warn(`[flags] Unrecognised value for ${name}="${raw}"; treating as disabled.`);
    return false;
}

export function allFlags(env: Record<string, string | undefined> = process.env): Record<FlagName, boolean> {
    const out = {} as Record<FlagName, boolean>;
    for (const name of FLAG_NAMES) out[name] = isFlagEnabled(name, env);
    return out;
}

/** Client-safe view: which capabilities the UI may offer. Never includes secrets. */
export function publicCapabilities(env: Record<string, string | undefined> = process.env) {
    const f = allFlags(env);
    return {
        claimIdentification: f.ENABLE_PERSONALISED_CLAIM_IDENTIFICATION,
        et1Drafting: f.ENABLE_PERSONALISED_ET1_DRAFTING,
        caseLawAnalysis: f.ENABLE_CASELAW_LLM_ANALYSIS,
        externalReferral: f.ENABLE_EXTERNAL_CASE_REFERRAL,
        paidClaimFeatures: f.ENABLE_PAID_CLAIM_FEATURES,
    };
}
