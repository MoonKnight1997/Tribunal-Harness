/**
 * Task: analyse_claim_v1
 *
 * Given a claim definition (its elements) and ONLY the confirmed facts of a
 * case, report the current factual status of each element. The model is a
 * structuring aid: it may only reference facts by id, must list contrary
 * facts and missing information, and must not score, predict or advise.
 */

import { z } from "zod";
import { CLAIM_ELEMENT_STATUSES } from "@/db/schema";
import type { LLMProvider } from "../provider";

export const ElementAssessment = z.object({
    elementKey: z.string(),
    status: z.enum(CLAIM_ELEMENT_STATUSES),
    reasoning: z.string().min(1).max(2000),
    supportingFactIds: z.array(z.string()).catch([]),
    contraryFactIds: z.array(z.string()).catch([]),
    missingInformation: z.array(z.string().max(400)).catch([]),
});

export const AnalyseClaimOutput = z.object({
    elements: z.array(ElementAssessment),
    contraryFactIds: z.array(z.string()).catch([]),
    missingFacts: z.array(z.string().max(400)).catch([]),
    uncertainties: z.array(z.string().max(400)).catch([]),
    alternatives: z.array(z.string().max(80)).catch([]),
});
export type AnalyseClaimOutput = z.infer<typeof AnalyseClaimOutput>;

export const ANALYSE_CLAIM_SYSTEM = `You help organise the FACTUAL basis of a possible Employment Tribunal claim for a UK worker. You are not a lawyer for the worker and you do not decide the case.

INPUT: a claim type with its legal elements, and a list of CONFIRMED facts (each with an id). Nothing else exists. Facts marked disputed or with employer-allegation provenance are not proof.

FOR EACH ELEMENT report a status:
- "supported": one or more confirmed, undisputed facts directly establish it.
- "potentially_supported": confirmed facts point towards it but more is needed.
- "disputed": the confirmed facts include a dispute or an employer allegation on the point.
- "unsupported_on_current_information": confirmed facts point against it.
- "information_missing": no confirmed fact addresses it.
- "not_applicable": the element does not arise on these facts.

RULES
- Cite facts ONLY by the ids provided. Never invent facts or ids.
- List contrary facts as carefully as supporting ones.
- Do NOT give a likelihood of success, a percentage, or words like strong, weak, winner, hopeless.
- Do NOT state legal rules beyond the element descriptions provided, and never cite case law.
- Write reasoning in plain English, two sentences at most.`;

export const ANALYSE_CLAIM_SCHEMA_DESCRIPTION = `{
  "elements": [{ "elementKey": string (from the input), "status": ${CLAIM_ELEMENT_STATUSES.map((s) => `"${s}"`).join(" | ")}, "reasoning": string, "supportingFactIds": string[], "contraryFactIds": string[], "missingInformation": string[] }],
  "contraryFactIds": string[],
  "missingFacts": string[],
  "uncertainties": string[],
  "alternatives": string[] (other claim type ids that may fit the same facts better)
}`;

export async function runAnalyseClaim(provider: LLMProvider, input: { claimType: string; label: string; elements: Array<{ key: string; label: string; plain: string }>; facts: Array<{ id: string; statement: string; provenance: string; disputed: boolean; key: string | null; value: string | null }>; jurisdiction: string }) {
    return provider.structuredGenerate({
        task: "analyse_claim_v1",
        capability: "analysis",
        system: ANALYSE_CLAIM_SYSTEM,
        input: JSON.stringify(input),
        schema: AnalyseClaimOutput,
        schemaDescription: ANALYSE_CLAIM_SCHEMA_DESCRIPTION,
        maxOutputTokens: 6000,
        temperature: 0.1,
    });
}
