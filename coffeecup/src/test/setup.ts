import { beforeEach, afterEach } from "vitest";

/**
 * Global Vitest isolation.
 *
 * 1. Snapshot process.env before each test and restore it afterwards, so a test
 *    that mutates the environment cannot leak into the next one.
 * 2. Strip ambient variables that would silently change behaviour under test:
 *    - provider API keys (would turn the mock provider into live network calls);
 *    - DATABASE_URL (tests must always run on the in-process PGlite database);
 *    - feature flags (each test sets the flags it needs explicitly);
 *    - the ERA 2025 commencement override (legal-safety-critical).
 */
let envSnapshot: NodeJS.ProcessEnv;

const STRIPPED = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_COMPATIBLE_API_KEY",
    "LLM_PROVIDER",
    "DATABASE_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PAYMENT_PROVIDER",
    "ERA_2025_TIME_LIMIT_COMMENCEMENT",
    "ENABLE_PERSONALISED_CLAIM_IDENTIFICATION",
    "ENABLE_PERSONALISED_ET1_DRAFTING",
    "ENABLE_CASELAW_LLM_ANALYSIS",
    "ENABLE_EXTERNAL_CASE_REFERRAL",
    "ENABLE_PAID_CLAIM_FEATURES",
];

beforeEach(() => {
    envSnapshot = { ...process.env };
    for (const key of STRIPPED) delete process.env[key];
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
});

afterEach(() => {
    for (const key of Object.keys(process.env)) {
        if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
});
