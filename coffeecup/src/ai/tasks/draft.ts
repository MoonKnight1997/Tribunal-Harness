/**
 * Drafting tasks: turn CONFIRMED case material into an editable document.
 *
 * The prompt is deliberately strict: the model may only use the facts and
 * events supplied; where something is uncertain it must say so in the draft
 * rather than fill the gap. The output is Markdown for the user to edit.
 */

import type { ArtifactType } from "@/db/schema";
import type { LLMProvider } from "../provider";

const COMMON_RULES = `You write plain-English documents for a UK worker dealing with a problem at work. The reader is not a lawyer and may be under stress.

HARD RULES
- Use ONLY the confirmed facts, events, documents and answers in the input. Never add facts, names, dates, quotations or events that are not there.
- Where the input marks something as uncertain, disputed or missing, say so in square brackets, e.g. "[confirm the date]". Do not guess.
- Do not give legal advice, predict outcomes, quote case law, or state the law beyond what the input includes.
- Do not use the words "strong", "weak", "winner" or percentages about the case.
- British English, calm and courteous. Short paragraphs. Markdown headings.
- End with a one-line note that the document was generated from the case record and should be checked before use.`;

const TYPE_GUIDANCE: Record<ArtifactType, string> = {
    grievance_letter: "Write a formal grievance letter to the employer: the issues (numbered), what happened in date order, the effect on the worker, what resolution is asked for, and a request for a meeting with the right to be accompanied.",
    grievance_appeal: "Write a grievance appeal letter: reference the outcome, set out each selected ground of appeal with the supporting facts, and state the outcome sought.",
    disciplinary_response: "Write hearing preparation: for each allegation, the employer's allegation, the worker's response using confirmed facts, evidence to point to, information still needed, and questions to ask at the hearing.",
    disciplinary_appeal: "Write a disciplinary appeal letter: reference the decision, set out each selected ground with supporting facts, and state what outcome is sought.",
    chronology: "Write a neutral, dated chronology from the confirmed events only.",
    case_summary: "Write a short neutral summary: what has happened, where things are now, and what remains unclear.",
    acas_preparation: "Write an Acas Early Conciliation preparation note: parties, a concise chronology, the key issues, steps already taken, money issues, desired resolution, documents, and questions to clarify.",
    meeting_preparation: "Write meeting preparation notes: purpose of the meeting, points to make (from confirmed facts), questions to ask, documents to bring, and reminders (right to be accompanied, take notes).",
    potential_claims_summary: "Write a neutral summary of the possible-claim analysis supplied, keeping every uncertainty and missing fact explicit.",
    et1_readiness_pack: "Write the ET1 readiness pack from the structured sections supplied, marking every missing item clearly.",
    case_pack: "Write the case pack from the sections supplied.",
};

export async function runDraft(provider: LLMProvider, type: ArtifactType, payload: Record<string, unknown>): Promise<{ text: string; model: string; provider: string }> {
    const res = await provider.textGenerate({
        task: `draft_${type}_v1`,
        capability: "drafting",
        system: `${COMMON_RULES}\n\nDOCUMENT TYPE\n${TYPE_GUIDANCE[type]}`,
        input: JSON.stringify(payload),
        maxOutputTokens: 4000,
        temperature: 0.3,
    });
    return { text: res.text, model: res.model, provider: res.provider };
}
