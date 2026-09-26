/**
 * OpenAI-compatible chat-completions backend (OpenAI, Azure OpenAI, Mistral,
 * Ollama, vLLM …). Plain fetch; no SDK.
 *
 *   OPENAI_COMPATIBLE_BASE_URL  default https://api.openai.com/v1
 *   OPENAI_COMPATIBLE_API_KEY   (falls back to OPENAI_API_KEY)
 */

import type { CompletionParams, CompletionResult, ModelBackend } from "../provider";

interface ChatResponse {
    model: string;
    choices: Array<{ message: { content: string | null }; finish_reason: string }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
}

export class OpenAICompatibleBackend implements ModelBackend {
    readonly name = "openai_compatible";
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly timeoutMs: number;

    constructor(opts?: { apiKey?: string; baseUrl?: string; timeoutMs?: number }) {
        this.apiKey = opts?.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
        this.baseUrl = (opts?.baseUrl ?? process.env.OPENAI_COMPATIBLE_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
        this.timeoutMs = opts?.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 120_000);
    }

    async complete(params: CompletionParams): Promise<CompletionResult> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers: Record<string, string> = { "content-type": "application/json" };
            if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
            const body: Record<string, unknown> = {
                model: params.model,
                max_tokens: params.maxOutputTokens,
                temperature: params.temperature,
                messages: [
                    { role: "system", content: params.system },
                    { role: "user", content: params.input },
                ],
            };
            if (params.jsonMode) body.response_format = { type: "json_object" };
            const res = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
            if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw new Error(`Chat completions API ${res.status}: ${text.slice(0, 300)}`);
            }
            const data = (await res.json()) as ChatResponse;
            const choice = data.choices?.[0];
            if (!choice) throw new Error("Chat completions API returned no choices.");
            if (choice.finish_reason === "length") throw new Error("Response truncated; discarded rather than presented as complete.");
            return {
                text: choice.message.content ?? "",
                model: data.model,
                usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
            };
        } finally {
            clearTimeout(timer);
        }
    }
}
