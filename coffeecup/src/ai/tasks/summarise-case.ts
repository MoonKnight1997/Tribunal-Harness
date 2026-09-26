/**
 * Task: summarise_case_v1 — a neutral "what is happening" summary built from
 * confirmed material only, plus what is still unclear. The user confirms or
 * edits the summary before it is shown as the case description.
 */

import { z } from "zod";
import type { LLMProvider } from "../provider";

export const SummariseCaseOutput = z.object({
    summary: z.string().max(1500),
    whatIsHappening: z.string().max(1500),
    stillUnclear: z.array(z.string().max(300)).max(8).catch([]),
});

const SYSTEM = `Write a calm, plain-English summary of a UK worker's workplace problem using ONLY the confirmed events, facts and employment details supplied. Do not add anything, do not assess merits, do not mention claims or the law. List what is still unclear as short questions.`;

const SCHEMA = `{ "summary": string (2-4 sentences), "whatIsHappening": string (same content, present tense, for the dashboard), "stillUnclear": string[] }`;

export async function runSummariseCase(provider: LLMProvider, input: Record<string, unknown>) {
    return provider.structuredGenerate({ task: "summarise_case_v1", capability: "structuring", system: SYSTEM, input: JSON.stringify(input), schema: SummariseCaseOutput, schemaDescription: SCHEMA, maxOutputTokens: 1200, temperature: 0.2 });
}
