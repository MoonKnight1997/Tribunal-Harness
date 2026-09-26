/**
 * Model routing — least expensive competent model per capability.
 *
 *   cheap  : classification, extraction (metadata, dates, document type)
 *   mid    : structuring, drafting (chronology synthesis, letters, summaries)
 *   high   : analysis, critique (possible-claim analysis, contradiction review)
 *
 * Configure with environment variables (see .env.example):
 *   LLM_PROVIDER = mock | anthropic | openai_compatible
 *   LLM_MODEL_CHEAP / LLM_MODEL_MID / LLM_MODEL_HIGH
 *   LLM_MODEL_<CAPABILITY> overrides a single capability.
 *
 * The provider is a process-wide singleton created lazily. Tests call
 * `setProviderForTests` to inject a mock.
 */

import type { Capability, LLMProvider, ModelBackend } from "./provider";
import { createProvider } from "./structured";

export type Tier = "cheap" | "mid" | "high";

export const CAPABILITY_TIER: Record<Capability, Tier> = {
    classification: "cheap",
    extraction: "cheap",
    structuring: "mid",
    drafting: "mid",
    analysis: "high",
    critique: "high",
};

const ANTHROPIC_DEFAULTS: Record<Tier, string> = {
    cheap: "claude-haiku-4-5-20251001",
    mid: "claude-sonnet-5",
    high: "claude-opus-5-5",
};

const OPENAI_COMPATIBLE_DEFAULTS: Record<Tier, string> = {
    cheap: "gpt-4o-mini",
    mid: "gpt-4o",
    high: "gpt-4o",
};

export type ProviderName = "mock" | "anthropic" | "openai_compatible";

export function configuredProviderName(env: Record<string, string | undefined> = process.env): ProviderName {
    const raw = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
    if (raw === "anthropic" || raw === "openai_compatible" || raw === "mock") return raw;
    if (env.ANTHROPIC_API_KEY) return "anthropic";
    if (env.OPENAI_COMPATIBLE_API_KEY || env.OPENAI_API_KEY) return "openai_compatible";
    return "mock";
}

export function resolveModelFor(capability: Capability, provider: ProviderName, env: Record<string, string | undefined> = process.env): string {
    const specific = env[`LLM_MODEL_${capability.toUpperCase()}`];
    if (specific && specific.trim()) return specific.trim();
    const tier = CAPABILITY_TIER[capability];
    const tierEnv = env[`LLM_MODEL_${tier.toUpperCase()}`];
    if (tierEnv && tierEnv.trim()) return tierEnv.trim();
    if (provider === "anthropic") return ANTHROPIC_DEFAULTS[tier];
    if (provider === "openai_compatible") return OPENAI_COMPATIBLE_DEFAULTS[tier];
    return `mock-${tier}`;
}

interface Holder {
    provider: LLMProvider | null;
    override: LLMProvider | null;
}
const g = globalThis as unknown as { __coffeecupLlm?: Holder };
const holder: Holder = g.__coffeecupLlm ?? { provider: null, override: null };
g.__coffeecupLlm = holder;

async function buildBackend(name: ProviderName): Promise<ModelBackend> {
    if (name === "anthropic") {
        const { AnthropicBackend } = await import("./providers/anthropic");
        return new AnthropicBackend();
    }
    if (name === "openai_compatible") {
        const { OpenAICompatibleBackend } = await import("./providers/openai-compatible");
        return new OpenAICompatibleBackend();
    }
    const { MockBackend } = await import("./providers/mock");
    return new MockBackend();
}

export async function getProvider(): Promise<LLMProvider> {
    if (holder.override) return holder.override;
    if (holder.provider) return holder.provider;
    const name = configuredProviderName();
    if (name === "mock" && process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_LLM_IN_PRODUCTION !== "1") {
        throw new Error("No LLM provider is configured. The mock provider produces simulated output and is refused in production unless ALLOW_MOCK_LLM_IN_PRODUCTION=1.");
    }
    const backend = await buildBackend(name);
    holder.provider = createProvider(backend, (cap) => resolveModelFor(cap, name));
    return holder.provider;
}

/** Tests: inject a provider (or null to reset). */
export function setProviderForTests(provider: LLMProvider | null): void {
    holder.override = provider;
    holder.provider = null;
}

export function isLlmConfigured(env: Record<string, string | undefined> = process.env): boolean {
    return configuredProviderName(env) !== "mock" || env.NODE_ENV !== "production" || env.ALLOW_MOCK_LLM_IN_PRODUCTION === "1";
}
