/**
 * Deterministic mock backend.
 *
 * Serves every task the product defines without any network call, deriving
 * its output from the input it is given (regex date extraction, keyword
 * classification, template drafting). It exists so the whole pipeline can be
 * exercised hermetically in tests and local development, and so no feature
 * can silently depend on a proprietary model.
 *
 * Hermeticity: any citation it emits comes from the curated verified
 * authorities list, so citation validation stays offline.
 *
 * Test hooks: `MockBackend.scriptResponse(task, text)` forces the next
 * response for a task (used to simulate malformed output, hallucinated
 * citations and provider failures).
 */

import type { CompletionParams, CompletionResult, ModelBackend } from "../provider";
import { synthesise } from "./mock-synthesisers";

const scripted = new Map<string, Array<string | Error>>();

export class MockBackend implements ModelBackend {
    readonly name = "mock";

    static scriptResponse(task: string, response: string | Error): void {
        const queue = scripted.get(task) ?? [];
        queue.push(response);
        scripted.set(task, queue);
    }

    static clearScripts(): void {
        scripted.clear();
    }

    async complete(params: CompletionParams): Promise<CompletionResult> {
        const queue = scripted.get(params.task);
        if (queue && queue.length > 0) {
            const next = queue.shift()!;
            if (next instanceof Error) throw next;
            return { text: next, model: params.model, usage: { inputTokens: estimate(params.input), outputTokens: estimate(next) } };
        }
        const text = synthesise(params.task, params.input);
        return { text, model: params.model, usage: { inputTokens: estimate(params.input), outputTokens: estimate(text) } };
    }
}

function estimate(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
}
