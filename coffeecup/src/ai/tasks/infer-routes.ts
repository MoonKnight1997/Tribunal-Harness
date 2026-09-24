/**
 * Task: infer_routes_v1 — cheap classification of a plain-English problem
 * description into candidate entry routes, with clarifying questions. The
 * user chooses; nothing is decided by the model.
 */

import { z } from "zod";
import { ENTRY_ROUTES } from "@/db/schema";
import type { LLMProvider } from "../provider";

export const InferRoutesOutput = z.object({
    routes: z.array(z.object({ route: z.enum(ENTRY_ROUTES), reason: z.string().max(300) })).max(6),
    summary: z.string().max(600),
    clarifyingQuestions: z.array(z.string().max(300)).max(5).catch([]),
});
export type InferRoutesOutput = z.infer<typeof InferRoutesOutput>;

const SYSTEM = `A UK worker has described a problem at work in their own words. Suggest which of the fixed entry routes fit, in plain English, and up to five short clarifying questions that would help organise the problem. Do not diagnose legal claims, assess merits, or give advice. Never invent details.`;

const SCHEMA = `{ "routes": [{ "route": one of ${ENTRY_ROUTES.map((r) => `"${r}"`).join(" | ")}, "reason": string }], "summary": string (one or two neutral sentences restating the problem), "clarifyingQuestions": string[] }`;

export async function runInferRoutes(provider: LLMProvider, description: string) {
    return provider.structuredGenerate({
        task: "infer_routes_v1",
        capability: "classification",
        system: SYSTEM,
        input: JSON.stringify({ description: description.slice(0, 8000) }),
        schema: InferRoutesOutput,
        schemaDescription: SCHEMA,
        maxOutputTokens: 1200,
        temperature: 0.1,
    });
}
