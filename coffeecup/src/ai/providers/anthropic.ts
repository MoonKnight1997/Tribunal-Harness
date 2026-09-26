/**
 * Anthropic Messages API backend (plain fetch; no SDK dependency).
 * Reads ANTHROPIC_API_KEY. Optional ANTHROPIC_BASE_URL for proxies.
 */

import type { CompletionParams, CompletionResult, ModelBackend } from "../provider";

interface MessagesResponse {
    model: string;
    stop_reason: string;
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicBackend implements ModelBackend {
    readonly name = "anthropic";
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly timeoutMs: number;

    constructor(opts?: { apiKey?: string; baseUrl?: string; timeoutMs?: number }) {
        this.apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
        this.baseUrl = (opts?.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");
        this.timeoutMs = opts?.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 120_000);
        if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    }

    async complete(params: CompletionParams): Promise<CompletionResult> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}/v1/messages`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": this.apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                    model: params.model,
                    max_tokens: params.maxOutputTokens,
                    temperature: params.temperature,
                    system: params.system,
                    messages: [{ role: "user", content: params.input }],
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => "");
                throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
            }
            const data = (await res.json()) as MessagesResponse;
            if (data.stop_reason === "max_tokens") {
                throw new Error("Response truncated at max_tokens; discarded rather than presented as complete.");
            }
            const text = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
            return { text, model: data.model, usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } };
        } finally {
            clearTimeout(timer);
        }
    }
}
