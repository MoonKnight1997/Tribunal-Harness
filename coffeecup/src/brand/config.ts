/**
 * Central brand configuration.
 *
 * The public product name is NOT decided yet. "coffeecup" is the internal
 * working codename. Everything user-facing reads from this object so the
 * public name, domain and contact addresses can be changed here without a
 * refactor. Never hard-code the brand name in components, prompts, emails,
 * exports or documentation pages — import BRAND instead.
 *
 * Values can be overridden per deployment with NEXT_PUBLIC_BRAND_* variables
 * (safe to expose: they contain no secrets).
 */

export interface BrandConfig {
    /** Internal codename. Stable; used in logs, job names and internal docs. */
    codename: "coffeecup";
    /** Public product name shown to users. */
    name: string;
    /** Short strapline used under the name and in metadata. */
    strapline: string;
    /** Legal entity that operates the service, for terms/privacy pages. */
    operator: string;
    /** Canonical public origin, e.g. https://example.co.uk */
    origin: string;
    /** Support address shown in-product. */
    supportEmail: string;
    /** Data-protection contact shown in the privacy notice. */
    privacyEmail: string;
    /** Jurisdiction label shown on public content and case pages. */
    defaultJurisdictionLabel: string;
}

function env(name: string, fallback: string): string {
    const value = process.env[name];
    return value && value.trim() !== "" ? value : fallback;
}

export const BRAND: BrandConfig = {
    codename: "coffeecup",
    name: env("NEXT_PUBLIC_BRAND_NAME", "coffeecup"),
    strapline: env(
        "NEXT_PUBLIC_BRAND_STRAPLINE",
        "Help with a problem at work, one step at a time.",
    ),
    operator: env("NEXT_PUBLIC_BRAND_OPERATOR", "the coffeecup project"),
    origin: env("NEXT_PUBLIC_BRAND_ORIGIN", "http://localhost:3000"),
    supportEmail: env("NEXT_PUBLIC_BRAND_SUPPORT_EMAIL", "support@example.invalid"),
    privacyEmail: env("NEXT_PUBLIC_BRAND_PRIVACY_EMAIL", "privacy@example.invalid"),
    defaultJurisdictionLabel: "England and Wales",
};

/**
 * The persistent legal-information disclaimer. Every page that shows legal
 * information or generated wording must render this (Legal Services Act 2007
 * boundary: information, not advice).
 */
export const LEGAL_INFORMATION_DISCLAIMER =
    `${BRAND.name} provides legal information and organisational tools, not legal advice. ` +
    `Nothing here has been reviewed by a solicitor, barrister, Acas, HMCTS or a judge. ` +
    `If you need advice about your own situation, see the Help section for free and regulated sources.`;
