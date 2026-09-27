/**
 * Intake — "Get help with a problem at work".
 *
 * Determines jurisdiction, situation, employment relationship, key dates,
 * procedural stage and urgency without asking the user to name a legal cause
 * of action. Route inference is a suggestion the user confirms.
 *
 * Anonymous triage (`triage`) needs no account and stores nothing. Creating
 * a case requires an authenticated user.
 */

import { z } from "zod";
import { ENTRY_ROUTES, JURISDICTIONS, EMPLOYMENT_STATUSES, type EntryRoute } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/dates";
import { getProvider } from "@/ai/routing";
import { runInferRoutes } from "@/ai/tasks/infer-routes";
import { calculateTimeLimit } from "@/legal/deadlines/engine";
import { createCase, updateEmployment } from "@/cases/service";
import { setStructuredFact, addFact } from "@/facts/service";
import { addIssue } from "@/issues/service";
import { startProcess, updateProcessData, validateAcasDates } from "@/processes/service";
import { computeCaseDeadlines } from "@/legal/deadlines/case-deadlines";
import type { ClaimFamily } from "@/legal/rules/time-limits";
import type { AcasBasis } from "@/db/schema";
import { resourcesFor } from "@/resources/directory";
import type { Actor } from "@/cases/access";
import { ENTRY_ROUTE_LABELS } from "@/cases/stages";

const isoDate = z.string().refine(isIsoDate, "Expected YYYY-MM-DD");

export const IntakeInput = z.object({
    jurisdiction: z.enum(JURISDICTIONS).default("england_wales"),
    entryRoute: z.enum(ENTRY_ROUTES).default("not_sure"),
    description: z.string().trim().max(20_000).default(""),
    stillEmployed: z.boolean().nullable().optional(),
    employmentStatus: z.enum(EMPLOYMENT_STATUSES).nullable().optional(),
    employerName: z.string().trim().max(200).nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    endDateApproximate: z.boolean().optional(),
    lastActDate: isoDate.nullable().optional(),
    lastActApproximate: z.boolean().optional(),
    acasNotified: z.boolean().optional(),
    acasNotificationDate: isoDate.nullable().optional(),
    /** The date on the certificate (issue date). Not Day B by itself: see ERA 1996 s207B(2). */
    acasCertificateDate: isoDate.nullable().optional(),
    /** The date the worker received the certificate (Day B), if known. */
    acasCertificateReceivedDate: isoDate.nullable().optional(),
    acasCertificateDeliveryMethod: z.enum(["email", "post", "unknown"]).nullable().optional(),
    acasCertificateNumber: z.string().trim().max(60).nullable().optional(),
    currentProceduralStage: z.string().trim().max(200).nullable().optional(),
    desiredOutcome: z.string().trim().max(2000).nullable().optional(),
});
export type IntakeInputType = z.input<typeof IntakeInput>;

export interface TriageResult {
    suggestedRoutes: Array<{ route: EntryRoute; label: string; reason: string }>;
    summary: string;
    clarifyingQuestions: string[];
    urgency: { level: "none" | "watch" | "urgent" | "expired" | "pending_acas"; message: string; deadline: string | null; family: ClaimFamily; missing: string[] };
    resources: Array<{ name: string; url: string; category: string }>;
    jurisdictionNote: string | null;
}

/**
 * The claim family implied by the route the worker chose. Discrimination,
 * whistleblowing and pay routes keep their own family and trigger even when
 * the worker was dismissed: a dismissal is never treated as the discriminatory
 * act, and the end date is never substituted for the missing trigger.
 */
export function triageFamily(entryRoute: EntryRoute, dismissed: boolean): ClaimFamily {
    if (entryRoute === "discrimination" || entryRoute === "disability_adjustments") return "discrimination";
    if (entryRoute === "whistleblowing") return "whistleblowing_detriment";
    if (entryRoute === "pay") return "unlawful_deductions";
    if (dismissed || entryRoute === "dismissal" || entryRoute === "redundancy") return "unfair_dismissal";
    return "general";
}

/** Acas dates given at intake, resolved to Day A / Day B with the basis (same conservative rule as the Acas workspace). */
function triageAcas(input: z.output<typeof IntakeInput>): { dayA: string | null; dayB: string | null; dayBBasis: AcasBasis["dayBBasis"] } {
    const dayA = input.acasNotificationDate ?? null;
    if (input.acasCertificateReceivedDate) return { dayA, dayB: input.acasCertificateReceivedDate, dayBBasis: "received" };
    if (input.acasCertificateDate) return { dayA, dayB: input.acasCertificateDate, dayBBasis: input.acasCertificateDeliveryMethod === "email" ? "deemed_received" : "issue_date_assumed" };
    return { dayA, dayB: null, dayBBasis: dayA ? "pending" : "none" };
}

/** Anonymous, stateless triage. Never persists anything. */
export async function triage(raw: IntakeInputType): Promise<TriageResult> {
    const parsed = IntakeInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the details you entered.", parsed.error.flatten());
    const input = parsed.data;

    let suggested: TriageResult["suggestedRoutes"] = [];
    let summary = "";
    let questions: string[] = [];
    if (input.description.trim().length >= 20) {
        try {
            const provider = await getProvider();
            const res = await runInferRoutes(provider, input.description);
            suggested = res.data.routes.map((r) => ({ route: r.route, label: ENTRY_ROUTE_LABELS[r.route], reason: r.reason }));
            summary = res.data.summary;
            questions = res.data.clarifyingQuestions;
        } catch {
            suggested = [];
        }
    }
    if (input.entryRoute !== "not_sure" && !suggested.some((s) => s.route === input.entryRoute)) {
        suggested.unshift({ route: input.entryRoute, label: ENTRY_ROUTE_LABELS[input.entryRoute], reason: "You chose this route." });
    }
    if (suggested.length === 0) suggested.push({ route: "problem_at_work", label: ENTRY_ROUTE_LABELS.problem_at_work, reason: "We will work out the details together." });

    validateAcasDates({ notificationDate: input.acasNotificationDate, certificateIssueDate: input.acasCertificateDate, certificateReceivedDate: input.acasCertificateReceivedDate });

    // Urgency from the deterministic engine, using the family the route
    // implies and that family's own trigger. No substitution: a discrimination
    // route with only an end date is "missing the date of the last act".
    const dismissed = input.stillEmployed === false || !!input.endDate;
    const family = triageFamily(input.entryRoute, dismissed);
    const usesEdt = family === "unfair_dismissal" || family === "general";
    const trigger = usesEdt ? (input.endDate ?? (family === "general" ? input.lastActDate ?? null : null)) : input.lastActDate ?? null;
    const triggerIsEnd = usesEdt && !!input.endDate;
    const precision = trigger ? ((triggerIsEnd ? input.endDateApproximate : input.lastActApproximate) ? "approximate" : "exact") : undefined;
    const tl = calculateTimeLimit({
        jurisdiction: input.jurisdiction,
        family,
        triggerDate: trigger,
        triggerPrecision: precision,
        triggerSource: trigger ? "intake" : undefined,
        acas: triageAcas(input),
    });
    const approx = precision === "approximate" ? " The date you gave is approximate, so the real deadline may be earlier." : "";
    const payNote = family === "unlawful_deductions" && trigger ? " We have treated the most recent date you gave as the payday of the deduction; correct this on My case if it is not." : "";
    let urgency: TriageResult["urgency"];
    const missing = tl.explanation.missingInformation;
    if (tl.status === "uncertain") {
        urgency = {
            level: "none",
            message: trigger
                ? `We could not calculate a tribunal time limit from these details. ${tl.explanation.warnings[0] ?? ""}`.trim()
                : `Tribunal claims have short time limits (usually three months less one day from the event). To see yours we need: ${missing[0] ?? "the key date"}`,
            deadline: null,
            family,
            missing,
        };
    } else if (tl.status === "pending_acas") {
        urgency = {
            level: "pending_acas",
            message: `Your time limit is paused for Acas conciliation (since ${tl.explanation.acas?.dayA}). Without Acas it would have expired on ${tl.explanation.unadjusted?.date}; the extended deadline will be no earlier than that, but cannot be worked out until you have the certificate date (Day B).${approx}`,
            deadline: null,
            family,
            missing,
        };
    } else if (tl.status === "expired") {
        urgency = { level: "expired", message: `The usual tribunal time limit for this kind of problem appears to have passed (${tl.calculatedDate}). Late claims are sometimes accepted. Get advice quickly.${approx}${payNote}`, deadline: tl.calculatedDate, family, missing };
    } else if ((tl.daysRemaining ?? 999) <= 21) {
        urgency = { level: "urgent", message: `If you may want to bring a tribunal claim, the usual time limit is ${tl.calculatedDate} (${tl.daysRemaining} days away). Contact Acas Early Conciliation now if you have not already.${approx}${payNote}`, deadline: tl.calculatedDate, family, missing };
    } else {
        urgency = { level: "watch", message: `If you may want to bring a tribunal claim, the usual time limit is ${tl.calculatedDate}. Starting Acas Early Conciliation pauses this clock.${approx}${payNote}`, deadline: tl.calculatedDate, family, missing };
    }

    const resources = resourcesFor({ jurisdiction: input.jurisdiction, tags: [input.entryRoute, ...suggested.map((s) => s.route)], categories: ["official", "free_general_advice"] }).slice(0, 4).map((r) => ({ name: r.name, url: r.url, category: r.category }));

    return {
        suggestedRoutes: suggested,
        summary,
        clarifyingQuestions: questions,
        urgency,
        resources,
        jurisdictionNote: input.jurisdiction === "northern_ireland" ? "Northern Ireland has its own employment law and tribunals. This tool covers England, Wales and Scotland; the Labour Relations Agency can help." : null,
    };
}

/** Authenticated: turn intake answers into a persistent case with structured facts. */
export async function createCaseFromIntake(actor: Actor, raw: IntakeInputType): Promise<{ caseId: string }> {
    const parsed = IntakeInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the details you entered.", parsed.error.flatten());
    const input = parsed.data;
    validateAcasDates({ notificationDate: input.acasNotificationDate, certificateIssueDate: input.acasCertificateDate, certificateReceivedDate: input.acasCertificateReceivedDate });
    const route: EntryRoute = input.entryRoute;
    const c = await createCase(actor, {
        entryRoute: route,
        jurisdiction: input.jurisdiction,
        intake: {
            situationDescription: input.description || undefined,
            stillEmployed: input.stillEmployed ?? undefined,
            currentProceduralStage: input.currentProceduralStage ?? undefined,
            keyDates: { ...(input.endDate ? { endDate: input.endDate } : {}), ...(input.lastActDate ? { lastActDate: input.lastActDate } : {}) },
        },
    });
    const endPrecision = input.endDateApproximate ? "approximate" : "exact";
    const lastActPrecision = input.lastActApproximate ? "approximate" : "exact";
    await updateEmployment(actor, c.id, {
        employerName: input.employerName ?? null,
        employmentStatus: input.employmentStatus ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        endDatePrecision: endPrecision,
        stillEmployed: input.stillEmployed ?? null,
    });
    if (input.startDate) await setStructuredFact(actor, c.id, "employment_start", input.startDate, `I started work on ${input.startDate}.`);
    // Precision is carried as data, not just prose, so the engine can warn about it.
    if (input.endDate) await setStructuredFact(actor, c.id, "dismissal_date", input.endDate, `My employment ended on ${input.endDate}${input.endDateApproximate ? " (approximate)" : ""}.`, endPrecision);
    if (input.lastActDate) await setStructuredFact(actor, c.id, "date_of_last_act", input.lastActDate, `The most recent thing I am concerned about happened on ${input.lastActDate}${input.lastActApproximate ? " (approximate)" : ""}.`, lastActPrecision);
    if (input.description.trim()) await addFact(actor, c.id, { statement: input.description.trim().slice(0, 4000), status: "confirmed", provenance: "USER_ALLEGATION" });
    if (input.desiredOutcome || route !== "not_sure") {
        await addIssue(actor, c.id, { title: ENTRY_ROUTE_LABELS[route], category: route === "not_sure" ? "other" : route, description: null, desiredResolution: input.desiredOutcome ?? null });
    }
    if (input.acasNotified || input.acasNotificationDate || input.acasCertificateDate) {
        const acas = await startProcess(actor, c.id, { type: "acas_early_conciliation", startedOn: input.acasNotificationDate ?? undefined, initialState: input.acasCertificateDate ? "certificate_issued" : input.acasNotificationDate ? "notified" : "preparing" });
        await updateProcessData(actor, c.id, acas.id, {
            ...(input.acasNotificationDate ? { notificationDate: input.acasNotificationDate } : {}),
            ...(input.acasCertificateDate ? { certificateIssueDate: input.acasCertificateDate, certificateStatus: "issued" } : {}),
            ...(input.acasCertificateReceivedDate ? { certificateReceivedDate: input.acasCertificateReceivedDate } : {}),
            ...(input.acasCertificateDeliveryMethod ? { certificateDeliveryMethod: input.acasCertificateDeliveryMethod } : {}),
            ...(input.acasCertificateNumber ? { certificateNumber: input.acasCertificateNumber } : {}),
        });
    }
    await computeCaseDeadlines(actor, c.id);
    return { caseId: c.id };
}
