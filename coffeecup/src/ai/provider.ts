/**
 * Model-provider abstraction.
 *
 * Business logic depends only on `LLMProvider`. Adapters (anthropic,
 * openai-compatible, mock) implement `ModelBackend`, a thin "complete text"
 * contract; `createProvider` wraps a backend with capability routing and the
 * structured-output guard (JSON parse + Zod validation + one retry).
 *
 * No user-facing feature may assume a specific proprietary model exists: the
 * mock backend must be able to serve every task deterministically.
 */

import type { z } from "zod";

/** What kind of work the call does. Routing picks a model tier per capability. */
export type Capability = "extraction" | "classification" | "structuring" | "analysis" | "critique" | "drafting";

export interface CompletionParams {
    /** Stable task id (e.g. "extract_document_v1") — used by the mock backend and for audit. */
    task: string;
    model: string;
    system: string;
    input: string;
    maxOutputTokens: number;
    temperature: number;
    /** Hint that the response must be a single JSON object. */
    jsonMode: boolean;
}

export interface CompletionResult {
    text: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
}

export interface ModelBackend {
    readonly name: string;
    complete(params: CompletionParams): Promise<CompletionResult>;
}

export interface StructuredRequest<T> {
    task: string;
    capability: Capability;
    system: string;
    input: string;
    /** Output-typed schema; the input type is left open so schemas with .catch()/.transform() infer T correctly. */
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    /** Human-readable description of the expected JSON, appended to the system prompt. */
    schemaDescription: string;
    maxOutputTokens?: number;
    temperature?: number;
}

export interface StructuredResult<T> {
    data: T;
    model: string;
    provider: string;
    usage: { inputTokens: number; outputTokens: number };
    /** True when the first response failed validation and a retry succeeded. */
    retried: boolean;
}

export interface TextRequest {
    task: string;
    capability: Capability;
    system: string;
    input: string;
    maxOutputTokens?: number;
    temperature?: number;
}

export interface TextResult {
    text: string;
    model: string;
    provider: string;
    usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
    readonly name: string;
    structuredGenerate<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
    textGenerate(request: TextRequest): Promise<TextResult>;
}
