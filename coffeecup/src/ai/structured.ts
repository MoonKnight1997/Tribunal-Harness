/**
 * Structured-output guard.
 *
 * Wraps a ModelBackend so that every structured call:
 *   1. asks for a single JSON object;
 *   2. strips code fences and parses;
 *   3. validates against the Zod schema;
 *   4. retries ONCE with the validation errors appended;
 *   5. throws ProviderError (never returns partial/unchecked data).
 */

import { ProviderError } from "@/lib/errors";
import type { Capability, LLMProvider, ModelBackend, StructuredRequest, StructuredResult, TextRequest, TextResult } from "./provider";

export type ModelResolver = (capability: Capability) => string;

export function extractJsonObject(text: string): string {
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) throw new SyntaxError("No JSON object found in model output.");
    return t.slice(start, end + 1);
}

const JSON_INSTRUCTION =
    "\n\nOUTPUT FORMAT: Respond with a single JSON object and nothing else — no prose, no markdown fences. The object must match this description exactly:\n";

export function createProvider(backend: ModelBackend, resolveModel: ModelResolver): LLMProvider {
    return {
        name: backend.name,
        async structuredGenerate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
            const model = resolveModel(req.capability);
            const system = req.system + JSON_INSTRUCTION + req.schemaDescription;
            const base = {
                task: req.task,
                model,
                system,
                maxOutputTokens: req.maxOutputTokens ?? 4000,
                temperature: req.temperature ?? 0.2,
                jsonMode: true,
            };
            let usage = { inputTokens: 0, outputTokens: 0 };
            let lastProblem = "";
            for (let attempt = 0; attempt < 2; attempt++) {
                const input = attempt === 0 ? req.input : `${req.input}\n\nYour previous response was not valid. Problems: ${lastProblem}\nReturn ONLY a corrected JSON object.`;
                let result;
                try {
                    result = await backend.complete({ ...base, input });
                } catch (err) {
                    throw new ProviderError(`The ${backend.name} provider failed for task ${req.task}.`, { cause: err instanceof Error ? err.message : String(err) });
                }
                usage = { inputTokens: usage.inputTokens + result.usage.inputTokens, outputTokens: usage.outputTokens + result.usage.outputTokens };
                let parsed: unknown;
                try {
                    parsed = JSON.parse(extractJsonObject(result.text));
                } catch (err) {
                    lastProblem = `not valid JSON (${err instanceof Error ? err.message : "parse error"})`;
                    continue;
                }
                const validated = req.schema.safeParse(parsed);
                if (validated.success) {
                    return { data: validated.data, model: result.model, provider: backend.name, usage, retried: attempt > 0 };
                }
                lastProblem = validated.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
            }
            throw new ProviderError(`The model returned malformed output for task ${req.task} twice; the result was discarded.`, { problem: lastProblem });
        },
        async textGenerate(req: TextRequest): Promise<TextResult> {
            const model = resolveModel(req.capability);
            try {
                const result = await backend.complete({
                    task: req.task,
                    model,
                    system: req.system,
                    input: req.input,
                    maxOutputTokens: req.maxOutputTokens ?? 3000,
                    temperature: req.temperature ?? 0.3,
                    jsonMode: false,
                });
                return { text: result.text, model: result.model, provider: backend.name, usage: result.usage };
            } catch (err) {
                if (err instanceof ProviderError) throw err;
                throw new ProviderError(`The ${backend.name} provider failed for task ${req.task}.`, { cause: err instanceof Error ? err.message : String(err) });
            }
        },
    };
}
