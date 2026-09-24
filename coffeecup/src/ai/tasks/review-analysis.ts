/**
 * Task: review_analysis_v1 — the error-control reviewer.
 *
 * Successor to the Tribunal Harness Drafter/Critic/Judge loop. It does not
 * argue; it answers ten yes/no control questions about a draft claim
 * analysis and lists concrete findings. Deterministic checks run first (see
 * src/legal/claims/review.ts); the model review is a second opinion whose
 * findings can only DOWNGRADE conclusions, never upgrade them.
 */

import { z } from "zod";
import type { LLMProvider } from "../provider";

export const REVIEW_QUESTIONS = [
    "supported_by_confirmed_facts",
    "contrary_facts_included",
    "legal_rules_sourced",
    "correct_temporal_version",
    "allegation_not_treated_as_evidence",
    "inference_not_presented_as_fact",
    "missing_facts_identified",
    "claim_available_in_jurisdiction",
    "deadline_deterministic",
    "output_within_evidence",
] as const;
export type ReviewQuestion = (typeof REVIEW_QUESTIONS)[number];

export const ReviewFinding = z.object({
    conclusionId: z.string().nullable().catch(null),
    question: z.enum(REVIEW_QUESTIONS),
    passed: z.boolean(),
    note: z.string().max(600),
});

export const ReviewOutput = z.object({
    passed: z.boolean(),
    findings: z.array(ReviewFinding).catch([]),
    checks: z.record(z.string(), z.boolean()).catch({}),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

export const REVIEW_SYSTEM = `You are an error-control reviewer for a draft analysis of a possible Employment Tribunal claim. You are NOT an advocate for either side and you must not produce adversarial argument for its own sake.

For the draft supplied, answer each control question and report a finding wherever the answer is "no":
1. supported_by_confirmed_facts — Is every material conclusion supported by CONFIRMED facts (by id)?
2. contrary_facts_included — Have contrary facts been omitted?
3. legal_rules_sourced — Is every legal rule referenced tied to a registered source key?
4. correct_temporal_version — Is the version of the law correct for the event dates given?
5. allegation_not_treated_as_evidence — Has an employer allegation or a disputed fact been treated as proof?
6. inference_not_presented_as_fact — Has an inference been presented as a fact?
7. missing_facts_identified — Have the missing facts been identified?
8. claim_available_in_jurisdiction — Is the claim available in the stated jurisdiction?
9. deadline_deterministic — Does the time-limit information come from the deterministic engine (not from the draft)?
10. output_within_evidence — Does any conclusion exceed the evidence?

Be concrete: name the conclusion id and the fact ids involved. Do not invent facts.`;

export const REVIEW_SCHEMA_DESCRIPTION = `{
  "passed": boolean,
  "findings": [{ "conclusionId": string | null, "question": one of ${REVIEW_QUESTIONS.map((q) => `"${q}"`).join(" | ")}, "passed": boolean, "note": string }],
  "checks": { <question>: boolean, ... }
}`;

export async function runReview(provider: LLMProvider, input: Record<string, unknown>) {
    return provider.structuredGenerate({
        task: "review_analysis_v1",
        capability: "critique",
        system: REVIEW_SYSTEM,
        input: JSON.stringify(input),
        schema: ReviewOutput,
        schemaDescription: REVIEW_SCHEMA_DESCRIPTION,
        maxOutputTokens: 4000,
        temperature: 0.1,
    });
}
