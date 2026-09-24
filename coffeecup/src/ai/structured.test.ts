import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { createProvider, extractJsonObject } from "./structured";
import { MockBackend } from "./providers/mock";
import { configuredProviderName, resolveModelFor } from "./routing";
import { ProviderError } from "@/lib/errors";

const provider = createProvider(new MockBackend(), () => "mock-model");

beforeEach(() => MockBackend.clearScripts());

describe("structured output guard", () => {
    it("parses fenced JSON", () => {
        expect(extractJsonObject("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
        expect(extractJsonObject("Sure! {\"a\":1} hope that helps")).toBe('{"a":1}');
        expect(() => extractJsonObject("no json here")).toThrow();
    });

    it("validates with Zod and retries once on malformed output", async () => {
        MockBackend.scriptResponse("t", "this is not json");
        MockBackend.scriptResponse("t", '{"value": 42}');
        const res = await provider.structuredGenerate({ task: "t", capability: "extraction", system: "s", input: "i", schema: z.object({ value: z.number() }), schemaDescription: "{value:number}" });
        expect(res.data.value).toBe(42);
        expect(res.retried).toBe(true);
    });

    it("rejects output that fails validation twice, never returning partial data", async () => {
        MockBackend.scriptResponse("t", '{"value": "not a number"}');
        MockBackend.scriptResponse("t", '{"wrong": true}');
        await expect(
            provider.structuredGenerate({ task: "t", capability: "extraction", system: "s", input: "i", schema: z.object({ value: z.number() }), schemaDescription: "" }),
        ).rejects.toBeInstanceOf(ProviderError);
    });

    it("wraps backend failures as ProviderError", async () => {
        MockBackend.scriptResponse("t", new Error("network down"));
        await expect(provider.textGenerate({ task: "t", capability: "drafting", system: "s", input: "i" })).rejects.toBeInstanceOf(ProviderError);
    });
});

describe("routing", () => {
    it("defaults to the mock provider when nothing is configured", () => {
        expect(configuredProviderName({})).toBe("mock");
        expect(configuredProviderName({ ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
        expect(configuredProviderName({ LLM_PROVIDER: "openai_compatible" })).toBe("openai_compatible");
    });

    it("routes capabilities to tiers and honours overrides", () => {
        expect(resolveModelFor("classification", "anthropic", {})).toBe("claude-haiku-4-5-20251001");
        expect(resolveModelFor("analysis", "anthropic", {})).toBe("claude-opus-5-5");
        expect(resolveModelFor("drafting", "anthropic", { LLM_MODEL_MID: "custom-mid" })).toBe("custom-mid");
        expect(resolveModelFor("drafting", "anthropic", { LLM_MODEL_DRAFTING: "custom-draft", LLM_MODEL_MID: "custom-mid" })).toBe("custom-draft");
        expect(resolveModelFor("extraction", "mock", {})).toBe("mock-cheap");
    });
});
