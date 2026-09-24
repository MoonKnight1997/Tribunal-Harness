/**
 * Workplace process state machines.
 *
 * Each process type has an ordered list of states and the transitions the
 * user may make. Transitions are explicit so the record always shows where
 * the process is, and the UI can offer only sensible next steps.
 */

import type { ProcessType, AppealGroundCategory } from "@/db/enums";

export interface StateDef {
    id: string;
    label: string;
    plain: string;
    /** States reachable from this one. */
    next: string[];
    terminal?: boolean;
}

export const GRIEVANCE_STATES: StateDef[] = [
    { id: "considering", label: "Considering a grievance", plain: "You are deciding whether to raise a grievance.", next: ["informal_action", "preparing_grievance", "closed"] },
    { id: "informal_action", label: "Trying informally first", plain: "You are raising the issue informally with your manager.", next: ["preparing_grievance", "closed", "escalated"] },
    { id: "preparing_grievance", label: "Preparing the grievance", plain: "You are gathering the issues, events and documents and drafting the grievance.", next: ["grievance_submitted", "closed"] },
    { id: "grievance_submitted", label: "Grievance submitted", plain: "You have sent the grievance to your employer.", next: ["meeting_pending", "outcome_received"] },
    { id: "meeting_pending", label: "Meeting pending", plain: "A grievance meeting has been arranged or is awaited.", next: ["meeting_completed", "outcome_received"] },
    { id: "meeting_completed", label: "Meeting completed", plain: "The grievance meeting has taken place.", next: ["outcome_pending"] },
    { id: "outcome_pending", label: "Waiting for the outcome", plain: "You are waiting for the employer's written outcome.", next: ["outcome_received"] },
    { id: "outcome_received", label: "Outcome received", plain: "You have the employer's decision.", next: ["appeal_considered", "closed", "escalated"] },
    { id: "appeal_considered", label: "Considering an appeal", plain: "You are deciding whether to appeal the outcome.", next: ["appeal_submitted", "closed", "escalated"] },
    { id: "appeal_submitted", label: "Appeal submitted", plain: "You have appealed the grievance outcome.", next: ["appeal_outcome"] },
    { id: "appeal_outcome", label: "Appeal outcome received", plain: "The appeal has been decided.", next: ["closed", "escalated"] },
    { id: "closed", label: "Closed", plain: "The grievance process has ended.", next: [], terminal: true },
    { id: "escalated", label: "Escalated", plain: "You are taking the matter further (for example to Acas).", next: [], terminal: true },
];

export const DISCIPLINARY_STATES: StateDef[] = [
    { id: "investigation", label: "Investigation", plain: "Your employer is investigating.", next: ["allegations", "closed"] },
    { id: "allegations", label: "Allegations set out", plain: "You have been told what is alleged.", next: ["evidence_disclosure", "hearing_invitation"] },
    { id: "evidence_disclosure", label: "Evidence disclosed", plain: "You have received the employer's evidence.", next: ["hearing_invitation"] },
    { id: "hearing_invitation", label: "Invited to a hearing", plain: "You have been invited to a disciplinary hearing.", next: ["preparation"] },
    { id: "preparation", label: "Preparing for the hearing", plain: "You are preparing your responses and questions.", next: ["hearing"] },
    { id: "hearing", label: "Hearing", plain: "The hearing is taking place or has just taken place.", next: ["outcome"] },
    { id: "outcome", label: "Outcome received", plain: "You have the employer's decision.", next: ["appeal", "closed", "escalated"] },
    { id: "appeal", label: "Appeal", plain: "You are appealing the disciplinary outcome.", next: ["closed", "escalated"] },
    { id: "closed", label: "Closed", plain: "The disciplinary process has ended.", next: [], terminal: true },
    { id: "escalated", label: "Escalated", plain: "You are taking the matter further.", next: [], terminal: true },
];

export const APPEAL_STATES: StateDef[] = [
    { id: "grounds", label: "Identifying grounds", plain: "You are working out the grounds for your appeal.", next: ["drafting"] },
    { id: "drafting", label: "Drafting the appeal", plain: "You are preparing the appeal document.", next: ["submitted"] },
    { id: "submitted", label: "Appeal submitted", plain: "You have sent the appeal.", next: ["hearing", "outcome"] },
    { id: "hearing", label: "Appeal hearing", plain: "An appeal hearing has been arranged or has taken place.", next: ["outcome"] },
    { id: "outcome", label: "Appeal outcome", plain: "The appeal has been decided.", next: ["closed", "escalated"] },
    { id: "closed", label: "Closed", plain: "The appeal has ended.", next: [], terminal: true },
    { id: "escalated", label: "Escalated", plain: "You are taking the matter further.", next: [], terminal: true },
];

export const ACAS_STATES: StateDef[] = [
    { id: "preparing", label: "Preparing to contact Acas", plain: "You are getting your information ready.", next: ["notified"] },
    { id: "notified", label: "Acas notified", plain: "You have submitted the early conciliation form (Day A).", next: ["conciliating", "certificate_issued"] },
    { id: "conciliating", label: "Conciliation in progress", plain: "Acas is talking to both sides.", next: ["settled", "certificate_issued"] },
    { id: "certificate_issued", label: "Certificate issued", plain: "Acas has issued the early conciliation certificate (Day B).", next: ["closed", "escalated"] },
    { id: "settled", label: "Settled", plain: "The dispute was settled through Acas.", next: ["closed"], terminal: true },
    { id: "closed", label: "Closed", plain: "The Acas stage has ended.", next: [], terminal: true },
    { id: "escalated", label: "Moving to a tribunal claim", plain: "You are preparing an Employment Tribunal claim.", next: [], terminal: true },
];

export const INFORMAL_STATES: StateDef[] = [
    { id: "raised", label: "Raised informally", plain: "You have spoken to your manager or HR informally.", next: ["resolved", "escalated"] },
    { id: "resolved", label: "Resolved", plain: "The issue was resolved informally.", next: [], terminal: true },
    { id: "escalated", label: "Escalated", plain: "You are moving to a formal process.", next: [], terminal: true },
];

export function statesFor(type: ProcessType): StateDef[] {
    switch (type) {
        case "grievance":
            return GRIEVANCE_STATES;
        case "disciplinary":
            return DISCIPLINARY_STATES;
        case "grievance_appeal":
        case "disciplinary_appeal":
            return APPEAL_STATES;
        case "acas_early_conciliation":
            return ACAS_STATES;
        case "informal":
            return INFORMAL_STATES;
    }
}

export function initialState(type: ProcessType): string {
    return statesFor(type)[0].id;
}

export function canTransition(type: ProcessType, from: string, to: string): boolean {
    const def = statesFor(type).find((s) => s.id === from);
    return !!def && def.next.includes(to);
}

export function stateDef(type: ProcessType, id: string): StateDef | undefined {
    return statesFor(type).find((s) => s.id === id);
}

export const APPEAL_GROUND_LABELS: Record<AppealGroundCategory, { label: string; plain: string }> = {
    factual_findings_disputed: { label: "I disagree with the findings of fact", plain: "The decision-maker got the facts wrong." },
    missing_evidence: { label: "Evidence was missing", plain: "Relevant evidence was not obtained or considered." },
    evidence_misunderstood: { label: "Evidence was misunderstood", plain: "Evidence was considered but interpreted wrongly." },
    procedural_issue: { label: "The process was not followed properly", plain: "Steps were missed, rushed or unfair (for example no chance to respond)." },
    inconsistency: { label: "Inconsistent treatment", plain: "Others in a similar position were treated differently." },
    new_evidence: { label: "New evidence is available", plain: "Something relevant has come to light since the decision." },
    remedy_outcome_dispute: { label: "The outcome or sanction is too severe", plain: "Even on the employer's findings, the response was disproportionate." },
};
