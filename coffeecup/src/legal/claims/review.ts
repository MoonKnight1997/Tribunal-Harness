/**
 * Deterministic review checks. These run before (and independently of) the
 * model reviewer and can only downgrade element statuses.
 */

import type { ClaimElementStatus } from "@/db/schema";
import { hasSource } from "@/legal/sources/registry";
import type { ReviewQuestion } from "@/ai/tasks/review-analysis";

export interface DraftElement {
    elementKey: string;
    status: ClaimElementStatus;
    reasoning: string;
    supportingFactIds: string[];
    contraryFactIds: string[];
    missingInformation: string[];
    sourceKeys: string[];
    /** Evaluated by code from structured case data (employment record, dates), not by the model. */
    deterministic?: boolean;
}

export interface FactLite {
    id: string;
    status: string;
    provenance: string;
    disputed: boolean;
}

export interface DeterministicFinding {
    conclusionId: string;
    question: ReviewQuestion;
    note: string;
}

const FORBIDDEN_WORDS = /\b(strong|weak|winner|hopeless|likely to win|likely to lose|\d{1,3}\s?%|per ?cent)\b/i;

export function deterministicReview(elements: DraftElement[], facts: FactLite[]): { elements: DraftElement[]; findings: DeterministicFinding[] } {
    const byId = new Map(facts.map((f) => [f.id, f]));
    const findings: DeterministicFinding[] = [];
    const out = elements.map((el) => {
        let status = el.status;
        const supporting = el.supportingFactIds.filter((id) => byId.has(id));
        const unknownIds = el.supportingFactIds.filter((id) => !byId.has(id));
        if (unknownIds.length > 0) {
            findings.push({ conclusionId: el.elementKey, question: "supported_by_confirmed_facts", note: `Cited fact id(s) do not exist or are not confirmed: ${unknownIds.join(", ")}. Removed.` });
        }
        const unconfirmed = supporting.filter((id) => byId.get(id)!.status !== "confirmed");
        if (unconfirmed.length > 0) {
            findings.push({ conclusionId: el.elementKey, question: "supported_by_confirmed_facts", note: `Relies on unconfirmed fact(s): ${unconfirmed.join(", ")}.` });
        }
        const allegationsAsProof = supporting.filter((id) => byId.get(id)!.provenance === "EMPLOYER_ALLEGATION" || byId.get(id)!.disputed);
        if (allegationsAsProof.length > 0 && (status === "supported" || status === "potentially_supported")) {
            findings.push({ conclusionId: el.elementKey, question: "allegation_not_treated_as_evidence", note: `Fact(s) ${allegationsAsProof.join(", ")} are disputed or are employer allegations and cannot make the element supported. Marked disputed.` });
            status = "disputed";
        }
        const cleanSupporting = supporting.filter((id) => byId.get(id)!.status === "confirmed");
        // A model conclusion needs a confirmed fact behind it. Deterministic
        // elements are computed from structured case data (employment record),
        // which is itself user-entered, so they are exempt from this rule.
        if (status === "supported" && cleanSupporting.length === 0 && !el.deterministic) {
            findings.push({ conclusionId: el.elementKey, question: "supported_by_confirmed_facts", note: "Marked supported with no confirmed supporting fact. Downgraded to information missing." });
            status = "information_missing";
        }
        if (FORBIDDEN_WORDS.test(el.reasoning)) {
            findings.push({ conclusionId: el.elementKey, question: "output_within_evidence", note: "Reasoning contained a likelihood or strength judgement; removed." });
        }
        const missingSources = el.sourceKeys.filter((k) => !hasSource(k));
        if (missingSources.length > 0) {
            findings.push({ conclusionId: el.elementKey, question: "legal_rules_sourced", note: `Unregistered source key(s): ${missingSources.join(", ")}.` });
        }
        if (status === "information_missing" && el.missingInformation.length === 0) {
            findings.push({ conclusionId: el.elementKey, question: "missing_facts_identified", note: "Element is missing information but no missing item was named." });
        }
        return {
            ...el,
            status,
            reasoning: FORBIDDEN_WORDS.test(el.reasoning) ? el.reasoning.replace(FORBIDDEN_WORDS, "[assessment removed]") : el.reasoning,
            supportingFactIds: cleanSupporting,
            contraryFactIds: el.contraryFactIds.filter((id) => byId.has(id)),
            sourceKeys: el.sourceKeys.filter((k) => hasSource(k)),
        };
    });
    return { elements: out, findings };
}
