import type { CaseStage, EntryRoute } from "@/db/schema";

/**
 * The case stage model. It describes where the worker is in their workplace
 * problem, from first understanding through internal processes, Acas and (only
 * when relevant) the tribunal. A journey may end at any stage: resolution
 * after a grievance is a success, not an abandoned litigation funnel.
 */

export interface StageInfo {
    id: CaseStage;
    label: string;
    plain: string;
    /** Which navigation sections are relevant at this stage. */
    nav: NavSection[];
}

export type NavSection = "home" | "case" | "timeline" | "documents" | "process" | "acas" | "claims" | "tasks" | "exports" | "help";

export const STAGES: StageInfo[] = [
    { id: "understanding", label: "Understanding the problem", plain: "You are working out what has happened and what matters.", nav: ["home", "case", "timeline", "documents", "tasks", "help"] },
    { id: "informal_resolution", label: "Trying to resolve it informally", plain: "You are raising the problem informally with your manager or HR.", nav: ["home", "case", "timeline", "documents", "process", "tasks", "exports", "help"] },
    { id: "grievance", label: "Grievance", plain: "You are preparing, or have raised, a formal grievance.", nav: ["home", "case", "timeline", "documents", "process", "tasks", "exports", "help"] },
    { id: "disciplinary", label: "Disciplinary process", plain: "Your employer has started an investigation or disciplinary process.", nav: ["home", "case", "timeline", "documents", "process", "tasks", "exports", "help"] },
    { id: "internal_appeal", label: "Internal appeal", plain: "You are appealing a grievance or disciplinary outcome.", nav: ["home", "case", "timeline", "documents", "process", "tasks", "exports", "help"] },
    { id: "acas_early_conciliation", label: "Acas Early Conciliation", plain: "You have contacted, or are about to contact, Acas.", nav: ["home", "case", "timeline", "documents", "process", "acas", "tasks", "exports", "help"] },
    { id: "considering_tribunal", label: "Considering a tribunal claim", plain: "You are deciding whether to bring an Employment Tribunal claim.", nav: ["home", "case", "timeline", "documents", "process", "acas", "claims", "tasks", "exports", "help"] },
    { id: "et1_preparation", label: "Preparing an ET1", plain: "You are gathering the information needed to complete the ET1 claim form.", nav: ["home", "case", "timeline", "documents", "process", "acas", "claims", "tasks", "exports", "help"] },
    { id: "et1_submitted", label: "Claim submitted", plain: "Your claim has been sent to the tribunal.", nav: ["home", "case", "timeline", "documents", "acas", "claims", "tasks", "exports", "help"] },
    { id: "resolved", label: "Resolved", plain: "The problem has been resolved or settled.", nav: ["home", "case", "timeline", "documents", "exports", "help"] },
    { id: "closed", label: "Closed", plain: "You have closed this case.", nav: ["home", "case", "timeline", "documents", "exports", "help"] },
];

export function stageInfo(stage: CaseStage): StageInfo {
    return STAGES.find((s) => s.id === stage) ?? STAGES[0];
}

/** Initial stage implied by the entry route the worker chose. */
export function stageForEntryRoute(route: EntryRoute): CaseStage {
    switch (route) {
        case "grievance":
            return "grievance";
        case "disciplinary":
            return "disciplinary";
        case "appeal":
            return "internal_appeal";
        case "acas_early_conciliation":
        case "acas_certificate_received":
            return "acas_early_conciliation";
        case "considering_tribunal":
            return "considering_tribunal";
        case "et1_preparation":
            return "et1_preparation";
        default:
            return "understanding";
    }
}

export const ENTRY_ROUTE_LABELS: Record<EntryRoute, string> = {
    not_sure: "I'm not sure",
    problem_at_work: "A problem at work",
    grievance: "Raising a grievance",
    disciplinary: "A disciplinary or investigation",
    appeal: "Appealing a decision at work",
    dismissal: "I have been dismissed",
    redundancy: "Redundancy",
    discrimination: "Discrimination or unfair treatment",
    disability_adjustments: "Disability or adjustments",
    whistleblowing: "Raising wrongdoing (whistleblowing)",
    pay: "Wages, holiday or pay",
    contract_change: "Changes to my contract",
    acas_early_conciliation: "Acas Early Conciliation",
    acas_certificate_received: "I have an Acas certificate",
    considering_tribunal: "Considering an Employment Tribunal",
    et1_preparation: "Preparing an ET1 form",
};
