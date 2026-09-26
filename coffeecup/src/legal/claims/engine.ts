/**
 * Claim engine.
 *
 * Input: structured case state (entry route, issues, employment, confirmed
 * facts, deadlines, Acas status, jurisdiction). Output: ClaimCandidates with
 * element-by-element status.
 *
 * Pipeline
 *   1. deterministic triggers     → which claim definitions are candidates
 *   2. deterministic element checks (status, dismissal, qualifying service,
 *      commencement/availability, jurisdiction)
 *   3. structured model analysis of the remaining elements from confirmed facts
 *   4. deterministic review + model review (can only downgrade)
 *   5. assembly with deterministic time-limit info and source citations
 *
 * No likelihood-of-success scores are produced anywhere.
 */

import type { ClaimElementStatus, EntryRoute, Jurisdiction } from "@/db/schema";
import { CLAIM_DEFINITIONS, type ClaimDefinition, type ClaimElementDefinition } from "./definitions";
import { qualifyingPeriod } from "@/legal/deadlines/qualifying-period";
import { citeSource } from "@/legal/sources/registry";
import { deterministicReview, type DraftElement, type FactLite } from "./review";
import type { LLMProvider } from "@/ai/provider";
import { runAnalyseClaim } from "@/ai/tasks/analyse-claim";
import { runReview, type ReviewOutput } from "@/ai/tasks/review-analysis";
import { calculateTimeLimit } from "@/legal/deadlines/engine";
import { formatCommencementLabel } from "@/legal/era-2025";
import { ruleById } from "@/legal/rules/time-limits";

export interface EngineFact extends FactLite {
    statement: string;
    key: string | null;
    value: string | null;
}

export interface EngineInput {
    jurisdiction: Jurisdiction;
    entryRoute: EntryRoute;
    issueCategories: string[];
    employmentStatus: string | null;
    employmentStart: string | null;
    employmentEnd: string | null;
    stillEmployed: boolean | null;
    facts: EngineFact[];
    acas: { status: "not_started" | "in_progress" | "issued" | "not_required"; dayA: string | null; dayB: string | null };
    today?: string;
}

export interface EngineElement {
    elementKey: string;
    label: string;
    status: ClaimElementStatus;
    reasoning: string;
    supportingFactIds: string[];
    contraryFactIds: string[];
    missingInformation: string[];
    sourceKeys: string[];
    deterministic: boolean;
}

export interface EngineCandidate {
    claimType: string;
    label: string;
    triggeredBy: string[];
    elements: EngineElement[];
    supportingFactIds: string[];
    contraryFactIds: string[];
    missingFacts: string[];
    timeLimit: { calculatedDate: string | null; summary: string; ruleId: string } | null;
    acasStatus: string;
    sources: Array<{ key: string; title: string; reference: string; url?: string; version: string }>;
    uncertainties: string[];
    alternatives: string[];
    reviewerResult: { deterministicFindings: Array<{ conclusionId: string; question: string; note: string }>; model: ReviewOutput | null; modelError: string | null };
    available: boolean;
    availabilityNote: string | null;
}

// ---------------------------------------------------------------------------
// 1. Triggers
// ---------------------------------------------------------------------------

export function triggerCandidates(input: EngineInput): Array<{ def: ClaimDefinition; triggeredBy: string[] }> {
    const dismissed = !!input.employmentEnd || input.stillEmployed === false || input.facts.some((f) => f.status === "confirmed" && (f.key === "dismissal_date" || f.key === "effective_date_of_termination"));
    const tags = new Set<string>([input.entryRoute, ...input.issueCategories]);
    if (dismissed) tags.add("dismissal");
    const out: Array<{ def: ClaimDefinition; triggeredBy: string[] }> = [];
    for (const def of CLAIM_DEFINITIONS) {
        const hits = def.triggers.filter((t) => tags.has(t));
        if (hits.length === 0) continue;
        if (def.requiresDismissal && !dismissed) continue;
        out.push({ def, triggeredBy: hits.map((h) => `matched: ${h.replace(/_/g, " ")}`) });
    }
    return out;
}

// ---------------------------------------------------------------------------
// 2. Deterministic element checks
// ---------------------------------------------------------------------------

function factIdsFor(input: EngineInput, keys: string[]): string[] {
    return input.facts.filter((f) => f.status === "confirmed" && f.key && keys.includes(f.key)).map((f) => f.id);
}

function evaluateDeterministic(def: ClaimDefinition, el: ClaimElementDefinition, input: EngineInput): EngineElement | null {
    const base = { elementKey: el.key, label: el.label, sourceKeys: el.sourceKeys, deterministic: true, contraryFactIds: [] as string[] };
    switch (el.deterministic) {
        case "employment_status": {
            const status = input.employmentStatus;
            const needEmployee = el.key === "employee_status";
            if (!status || status === "unsure") {
                return { ...base, status: "information_missing", reasoning: "Your employment status is not recorded or is unsure.", supportingFactIds: [], missingInformation: ["Whether you were an employee, a worker or self-employed (check your contract)."] };
            }
            if (needEmployee) {
                if (status === "employee") return { ...base, status: "supported", reasoning: "You recorded that you were an employee.", supportingFactIds: factIdsFor(input, ["employment_status"]), missingInformation: [] };
                if (status === "agency") return { ...base, status: "information_missing", reasoning: "Agency arrangements can be complex; who your employer was needs checking.", supportingFactIds: [], missingInformation: ["Who employed you: the agency or the end client."] };
                return { ...base, status: "unsupported_on_current_information", reasoning: `You recorded your status as ${status.replace("_", "-")}, and this claim is available to employees only.`, supportingFactIds: [], missingInformation: ["If you think you may in reality have been an employee, note why (control, personal service, mutual obligations)."] };
            }
            if (status === "employee" || status === "worker" || status === "agency") return { ...base, status: "supported", reasoning: `You recorded that you were a${status === "employee" ? "n employee" : status === "worker" ? " worker" : "n agency worker"}.`, supportingFactIds: [], missingInformation: [] };
            return { ...base, status: "unsupported_on_current_information", reasoning: "You recorded that you were self-employed; worker status would need to be established.", supportingFactIds: [], missingInformation: ["Evidence of worker status (personal service, not a genuine business-to-client relationship)."] };
        }
        case "dismissal_recorded": {
            const ids = factIdsFor(input, ["dismissal_date", "effective_date_of_termination"]);
            if (ids.length > 0 || input.employmentEnd) return { ...base, status: "supported", reasoning: `Your employment ended on ${input.facts.find((f) => ids.includes(f.id))?.value ?? input.employmentEnd}.`, supportingFactIds: ids, missingInformation: [] };
            if (input.stillEmployed === false) return { ...base, status: "potentially_supported", reasoning: "You recorded that you are no longer employed, but the end date is not recorded.", supportingFactIds: [], missingInformation: ["The date your employment ended (effective date of termination)."] };
            return { ...base, status: "information_missing", reasoning: "No dismissal is recorded.", supportingFactIds: [], missingInformation: ["Whether and when your employment ended."] };
        }
        case "qualifying_service": {
            const edt = input.facts.find((f) => f.status === "confirmed" && (f.key === "effective_date_of_termination" || f.key === "dismissal_date"))?.value ?? input.employmentEnd;
            const start = input.facts.find((f) => f.status === "confirmed" && f.key === "employment_start")?.value ?? input.employmentStart;
            if (!edt || !start) {
                return { ...base, status: "information_missing", reasoning: "Your start date or end date is not recorded, so continuous service cannot be worked out.", supportingFactIds: [], missingInformation: [!start ? "Employment start date." : "", !edt ? "Effective date of termination." : ""].filter(Boolean) };
            }
            try {
                const q = qualifyingPeriod(start, edt);
                const ids = factIdsFor(input, ["employment_start", "dismissal_date", "effective_date_of_termination"]);
                if (q.hasQualifyingService) return { ...base, status: "supported", reasoning: `${q.actualMonths} complete months of service against a ${q.requiredMonths}-month requirement (${q.regime === "post" ? "ERA 2025 regime" : "pre-ERA 2025 regime"}).`, supportingFactIds: ids, missingInformation: [] };
                return { ...base, status: "unsupported_on_current_information", reasoning: `${q.actualMonths} complete months of service against a ${q.requiredMonths}-month requirement. Automatically unfair reasons (for example whistleblowing, pregnancy, asserting a statutory right) need no qualifying service.`, supportingFactIds: ids, missingInformation: ["Whether the reason for dismissal could be an automatically unfair one."] };
            } catch (err) {
                return { ...base, status: "information_missing", reasoning: err instanceof Error ? err.message : "Dates could not be compared.", supportingFactIds: [], missingInformation: ["Valid start and end dates."] };
            }
        }
        default:
            return null;
    }
}

function availability(def: ClaimDefinition, input: EngineInput): { available: boolean; note: string | null } {
    if (input.jurisdiction === "northern_ireland") {
        return { available: false, note: "Northern Ireland has separate employment legislation and tribunals; this tool does not yet cover it. Seek advice from the Labour Relations Agency or a local adviser." };
    }
    if (def.availableFrom === null) return { available: true, note: null };
    const eventDate = input.employmentEnd ?? input.facts.find((f) => f.status === "confirmed" && f.key === "date_of_last_act")?.value ?? null;
    if (def.availableFromTbc && def.availableFrom === null) return { available: false, note: "This right is not yet in force; the commencement date is to be confirmed by Statutory Instrument." };
    if (!eventDate) return { available: true, note: `This right applies only to events on or after ${formatCommencementLabel(def.availableFrom, def.availableFromTbc)}. The relevant date is not yet recorded.` };
    if (eventDate < def.availableFrom) return { available: false, note: `This right applies only to events on or after ${formatCommencementLabel(def.availableFrom, def.availableFromTbc)}; the recorded date (${eventDate}) is earlier.` };
    return { available: true, note: def.availableFromTbc ? "Exact commencement date to be confirmed by Statutory Instrument." : null };
}

// ---------------------------------------------------------------------------
// 3–5. Analysis, review, assembly
// ---------------------------------------------------------------------------

export async function analyseCandidate(provider: LLMProvider, def: ClaimDefinition, triggeredBy: string[], input: EngineInput): Promise<EngineCandidate> {
    const avail = availability(def, input);
    const confirmedFacts = input.facts.filter((f) => f.status === "confirmed");
    const elements: EngineElement[] = [];
    const remaining: ClaimElementDefinition[] = [];
    for (const el of def.elements) {
        const det = evaluateDeterministic(def, el, input);
        if (det) elements.push(det);
        else remaining.push(el);
    }

    let modelUncertainties: string[] = [];
    let modelAlternatives: string[] = [];
    let modelMissing: string[] = [];
    let modelError: string | null = null;

    if (!avail.available) {
        for (const el of remaining) elements.push({ elementKey: el.key, label: el.label, status: "not_applicable", reasoning: avail.note ?? "Not available.", supportingFactIds: [], contraryFactIds: [], missingInformation: [], sourceKeys: el.sourceKeys, deterministic: true });
    } else if (remaining.length > 0) {
        try {
            const res = await runAnalyseClaim(provider, {
                claimType: def.id,
                label: def.label,
                elements: remaining.map((e) => ({ key: e.key, label: e.label, plain: e.plain })),
                facts: confirmedFacts.map((f) => ({ id: f.id, statement: f.statement, provenance: f.provenance, disputed: f.disputed, key: f.key, value: f.value })),
                jurisdiction: input.jurisdiction,
            });
            const byKey = new Map(res.data.elements.map((e) => [e.elementKey, e]));
            for (const el of remaining) {
                const a = byKey.get(el.key);
                elements.push({
                    elementKey: el.key,
                    label: el.label,
                    status: a?.status ?? "information_missing",
                    reasoning: a?.reasoning ?? `No confirmed fact currently addresses "${el.label}".`,
                    supportingFactIds: a?.supportingFactIds ?? [],
                    contraryFactIds: a?.contraryFactIds ?? [],
                    missingInformation: a?.missingInformation?.length ? a.missingInformation : a ? [] : [`Information about: ${el.label}`],
                    sourceKeys: el.sourceKeys,
                    deterministic: false,
                });
            }
            modelUncertainties = res.data.uncertainties;
            modelAlternatives = res.data.alternatives.filter((a) => CLAIM_DEFINITIONS.some((d) => d.id === a) && a !== def.id);
            modelMissing = res.data.missingFacts;
        } catch (err) {
            modelError = err instanceof Error ? err.message : String(err);
            for (const el of remaining) elements.push({ elementKey: el.key, label: el.label, status: "information_missing", reasoning: "This element could not be analysed automatically. You can still record the relevant facts.", supportingFactIds: [], contraryFactIds: [], missingInformation: [`Information about: ${el.label}`], sourceKeys: el.sourceKeys, deterministic: false });
        }
    }

    // Deterministic review (may only downgrade).
    const draft: DraftElement[] = elements.map((e) => ({ elementKey: e.elementKey, status: e.status, reasoning: e.reasoning, supportingFactIds: e.supportingFactIds, contraryFactIds: e.contraryFactIds, missingInformation: e.missingInformation, sourceKeys: e.sourceKeys, deterministic: e.deterministic }));
    const reviewed = deterministicReview(draft, input.facts);
    const finalElements: EngineElement[] = elements.map((e) => {
        const r = reviewed.elements.find((x) => x.elementKey === e.elementKey)!;
        return { ...e, status: r.status, reasoning: r.reasoning, supportingFactIds: r.supportingFactIds, contraryFactIds: r.contraryFactIds, sourceKeys: r.sourceKeys };
    });

    // Model review (second opinion; also only downgrades).
    let modelReview: ReviewOutput | null = null;
    let reviewError: string | null = null;
    if (avail.available) {
        try {
            const res = await runReview(provider, {
                claimType: def.id,
                jurisdiction: input.jurisdiction,
                conclusions: finalElements.map((e) => ({ id: e.elementKey, status: e.status, reasoning: e.reasoning, supportingFactIds: e.supportingFactIds, contraryFactIds: e.contraryFactIds, sourceKeys: e.sourceKeys })),
                confirmedFactIds: confirmedFacts.filter((f) => !f.disputed && f.provenance !== "EMPLOYER_ALLEGATION").map((f) => f.id),
                disputedFactIds: confirmedFacts.filter((f) => f.disputed || f.provenance === "EMPLOYER_ALLEGATION").map((f) => f.id),
                eventDates: { employmentEnd: input.employmentEnd, lastAct: input.facts.find((f) => f.key === "date_of_last_act")?.value ?? null },
            });
            modelReview = res.data;
            for (const finding of res.data.findings) {
                if (finding.passed || !finding.conclusionId) continue;
                const el = finalElements.find((e) => e.elementKey === finding.conclusionId);
                if (!el) continue;
                if ((el.status === "supported" || el.status === "potentially_supported") && (finding.question === "supported_by_confirmed_facts" || finding.question === "allegation_not_treated_as_evidence" || finding.question === "inference_not_presented_as_fact" || finding.question === "output_within_evidence")) {
                    el.status = finding.question === "allegation_not_treated_as_evidence" ? "disputed" : "information_missing";
                    el.reasoning = `${el.reasoning} [Reviewer: ${finding.note}]`;
                    if (el.missingInformation.length === 0) el.missingInformation.push("Confirmed facts that directly establish this element.");
                }
            }
        } catch (err) {
            reviewError = err instanceof Error ? err.message : String(err);
        }
    }

    // Deterministic time limit.
    const trigger =
        def.family === "unfair_dismissal" || def.family === "breach_of_contract"
            ? input.employmentEnd ?? input.facts.find((f) => f.status === "confirmed" && (f.key === "effective_date_of_termination" || f.key === "dismissal_date"))?.value ?? null
            : def.family === "unlawful_deductions"
                ? input.facts.find((f) => f.status === "confirmed" && f.key === "date_of_deduction")?.value ?? input.facts.find((f) => f.status === "confirmed" && f.key === "date_of_last_act")?.value ?? null
                : input.facts.find((f) => f.status === "confirmed" && f.key === "date_of_last_act")?.value ?? input.employmentEnd;
    const tl = calculateTimeLimit({ jurisdiction: input.jurisdiction, family: def.family, triggerDate: trigger, acasDayA: input.acas.dayA, acasDayB: input.acas.dayB, today: input.today });
    const timeLimit = { calculatedDate: tl.calculatedDate, summary: tl.calculatedDate ? `${tl.label}: ${tl.calculatedDate} (${tl.status}). ${tl.explanation.acasEffect ?? ""}`.trim() : tl.explanation.warnings[0] ?? "Time limit not yet calculable.", ruleId: tl.ruleId };

    const acasStatus = input.acas.status === "issued" ? "certificate_issued" : input.acas.status === "in_progress" ? "in_progress" : input.acas.status === "not_required" ? "not_required" : "not_started";

    const supporting = [...new Set(finalElements.flatMap((e) => e.supportingFactIds))];
    const contrary = [...new Set(finalElements.flatMap((e) => e.contraryFactIds))];
    const missing = [...new Set([...finalElements.flatMap((e) => e.missingInformation), ...modelMissing])];
    const uncertainties = [
        ...(avail.note ? [avail.note] : []),
        ...modelUncertainties,
        "This shows which elements the recorded facts currently address. It is not a prediction of the outcome.",
        ...(modelError ? ["Automatic analysis of some elements was unavailable; those elements are shown as information missing."] : []),
        ...(reviewError ? ["The second-opinion review was unavailable; only the deterministic checks ran."] : []),
        ...(tl.explanation.warnings.length ? tl.explanation.warnings.slice(0, 2) : []),
    ];
    // Cite the claim's own sources, each element's sources, and the time-limit rule actually applied.
    const sourceKeys = [...new Set([...def.sourceKeys, ...finalElements.flatMap((e) => e.sourceKeys), ...(ruleById(tl.ruleId)?.sourceKeys ?? [])])];

    return {
        claimType: def.id,
        label: def.label,
        triggeredBy,
        elements: finalElements,
        supportingFactIds: supporting,
        contraryFactIds: contrary,
        missingFacts: missing,
        timeLimit,
        acasStatus,
        sources: sourceKeys.map((k) => citeSource(k)),
        uncertainties,
        alternatives: [...new Set([...def.alternatives.filter((a) => CLAIM_DEFINITIONS.some((d) => d.id === a)), ...modelAlternatives])],
        reviewerResult: { deterministicFindings: reviewed.findings, model: modelReview, modelError: modelError ?? reviewError },
        available: avail.available,
        availabilityNote: avail.note,
    };
}

export async function runClaimEngine(provider: LLMProvider, input: EngineInput): Promise<EngineCandidate[]> {
    const candidates = triggerCandidates(input);
    const out: EngineCandidate[] = [];
    for (const { def, triggeredBy } of candidates) {
        out.push(await analyseCandidate(provider, def, triggeredBy, input));
    }
    return out;
}
