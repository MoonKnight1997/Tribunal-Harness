/**
 * ET1 readiness pack — downstream of the persistent case.
 *
 * Assembles the structured sections a worker needs before completing the
 * official ET1 form: claimant and respondent details, employment
 * information, Acas certificate, potential claim categories (only where the
 * claim feature is enabled), chronology, concise factual particulars from
 * confirmed facts, remedy information, and an explicit list of everything
 * still missing. It never submits anything and never claims professional
 * approval. Filing is routed to the official GOV.UK service.
 */

import type { AcasProcessData } from "@/db/schema";
import { requireCaseAccess, type Actor } from "@/cases/access";
import { getEmployment, listPersons } from "@/cases/service";
import { listConfirmedEvents } from "@/timeline/service";
import { listConfirmedFacts } from "@/facts/service";
import { listDocuments } from "@/documents/service";
import { listIssues } from "@/issues/service";
import { getAcasProcess } from "@/processes/service";
import { listDeadlines } from "@/legal/deadlines/case-deadlines";
import { listClaimCandidates, listClaimElements } from "@/claims/service";
import { isFlagEnabled } from "@/flags";
import { requireEntitlement } from "@/entitlements/service";
import { getSource } from "@/legal/sources/registry";
import { formatLongDate } from "@/lib/dates";
import { BRAND, LEGAL_INFORMATION_DISCLAIMER } from "@/brand/config";
import { generateArtifact, type ArtifactRow } from "@/artifacts/service";
import { getDb } from "@/db/client";
import { artifacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { recordAudit } from "@/cases/audit";

export interface Et1Section<T> {
    title: string;
    data: T;
    missing: string[];
}

export interface Et1ReadinessPack {
    generatedAt: string;
    caseId: string;
    jurisdiction: string;
    claimant: Et1Section<{ name: string | null; email: string | null }>;
    respondent: Et1Section<{ employerName: string | null; legalEntity: string | null; address: string | null }>;
    employment: Et1Section<{ jobTitle: string | null; status: string | null; startDate: string | null; endDate: string | null; stillEmployed: boolean | null; pay: string | null; hours: string | null; workplace: string | null }>;
    acas: Et1Section<{ reference: string | null; certificateNumber: string | null; notificationDate: string | null; certificateIssueDate: string | null; status: string }>;
    claimCategories: Et1Section<Array<{ claimType: string; label: string; elementsSupported: number; elementsTotal: number; missingFacts: string[]; stale: boolean }>>;
    timeLimits: Et1Section<Array<{ label: string; date: string | null; status: string; sourceReference: string; warnings: string[] }>>;
    chronology: Et1Section<Array<{ date: string; title: string; description: string | null; approximate: boolean; disputed: boolean }>>;
    particulars: Et1Section<string[]>;
    remedy: Et1Section<{ desiredResolution: string[]; moneyIssues: string | null }>;
    documents: Et1Section<Array<{ filename: string; type: string; date: string | null }>>;
    unresolvedQuestions: string[];
    missingRequired: string[];
    provenance: { factIds: string[]; eventIds: string[]; documentIds: string[]; claimCandidateIds: string[] };
    filing: { officialRoute: { title: string; url: string }; note: string };
    disclaimer: string;
}

export async function buildEt1ReadinessPack(actor: Actor, caseId: string, opts?: { userEmail?: string | null; userName?: string | null }): Promise<Et1ReadinessPack> {
    const c = await requireCaseAccess(actor, caseId);
    await requireEntitlement(actor, caseId, "claim_pack");
    const employment = await getEmployment(actor, caseId);
    const people = await listPersons(actor, caseId);
    const events = await listConfirmedEvents(caseId);
    const facts = await listConfirmedFacts(caseId);
    const docs = await listDocuments(actor, caseId);
    const issues = await listIssues(actor, caseId);
    const acasProc = await getAcasProcess(caseId);
    const acas = (acasProc?.data ?? {}) as AcasProcessData;
    const deadlines = await listDeadlines(actor, caseId);

    const missingRequired: string[] = [];
    const unresolved: string[] = [];

    const claimant = { name: opts?.userName ?? null, email: opts?.userEmail ?? null };
    const claimantMissing = [!claimant.name ? "Your full name (add it to your account)." : "", "Your postal address and date of birth (asked for on the ET1; not stored here)."].filter(Boolean);

    const respondent = { employerName: employment.employerName, legalEntity: employment.respondentLegalEntity, address: employment.respondentAddress };
    const respondentMissing = [!respondent.employerName ? "Employer name." : "", !respondent.legalEntity ? "The employer's legal name (check your contract or payslip; Companies House can help)." : "", !respondent.address ? "The employer's address." : ""].filter(Boolean);
    missingRequired.push(...respondentMissing);

    const emp = { jobTitle: employment.jobTitle, status: employment.employmentStatus, startDate: employment.startDate, endDate: employment.endDate, stillEmployed: employment.stillEmployed, pay: employment.payAmount ? `${employment.payAmount} per ${employment.payPeriod ?? "period"}` : null, hours: employment.hoursPerWeek, workplace: employment.workplace };
    const empMissing = [!emp.jobTitle ? "Job title." : "", !emp.startDate ? "Employment start date." : "", emp.stillEmployed === false && !emp.endDate ? "Employment end date." : "", !emp.pay ? "Pay before tax." : "", !emp.hours ? "Hours per week." : ""].filter(Boolean);
    missingRequired.push(...empMissing.filter((m) => /start date|end date/.test(m)));

    const acasData = { reference: acas.reference ?? null, certificateNumber: acas.certificateNumber ?? null, notificationDate: acas.notificationDate ?? null, certificateIssueDate: acas.certificateIssueDate ?? null, status: acas.certificateStatus ?? (acas.notificationDate ? "in_progress" : "not_started") };
    const acasMissing: string[] = [];
    if (acasData.status !== "issued" && acasData.status !== "not_required") acasMissing.push("An Acas Early Conciliation certificate is normally required before the ET1 can be accepted.");
    if (acasData.status === "issued" && !acasData.certificateNumber) acasMissing.push("The certificate number (it is on the certificate Acas sent you).");
    missingRequired.push(...acasMissing);

    const claimCategories: Et1ReadinessPack["claimCategories"]["data"] = [];
    const claimMissing: string[] = [];
    const claimCandidateIds: string[] = [];
    if (isFlagEnabled("ENABLE_PERSONALISED_CLAIM_IDENTIFICATION")) {
        const candidates = await listClaimCandidates(actor, caseId);
        for (const cand of candidates) {
            const els = await listClaimElements(actor, caseId, cand.id);
            claimCandidateIds.push(cand.id);
            claimCategories.push({ claimType: cand.claimType, label: cand.label, elementsSupported: els.filter((e) => e.status === "supported").length, elementsTotal: els.length, missingFacts: cand.missingFacts, stale: cand.stale });
            if (cand.stale) unresolved.push(`The analysis for "${cand.label}" is out of date since the case record changed. Re-run it before relying on it.`);
        }
        if (candidates.length === 0) claimMissing.push("No possible-claim analysis has been run yet.");
    } else {
        claimMissing.push("Personalised claim identification is not enabled. The ET1 asks you to tick the type(s) of claim; use the Help section and free advice services to decide.");
    }

    const timeLimits = deadlines
        .filter((d) => d.kind.startsWith("et_time_limit"))
        .map((d) => ({ label: d.label, date: d.calculatedDate, status: d.status, sourceReference: d.explanation.source.reference, warnings: d.explanation.warnings }));
    const tlMissing = deadlines.filter((d) => d.status === "uncertain" && d.kind.startsWith("et_time_limit")).flatMap((d) => d.explanation.missingInformation);
    if (deadlines.some((d) => d.status === "expired" && d.kind.startsWith("et_time_limit"))) unresolved.push("At least one time limit appears to have passed. Seek advice urgently about whether a late claim could be accepted.");

    const chronology = events.map((e) => ({ date: e.date, title: e.title, description: e.description, approximate: e.dateApproximate, disputed: e.disputed }));
    const chronologyMissing = events.length === 0 ? ["No confirmed events. Confirm or add events on the Timeline."] : [];

    const particulars = facts.filter((f) => !f.disputed && f.provenance !== "EMPLOYER_ALLEGATION").map((f) => f.statement);
    const disputed = facts.filter((f) => f.disputed);
    for (const d of disputed) unresolved.push(`Disputed: ${d.statement}`);
    const particularsMissing = particulars.length === 0 ? ["No confirmed facts to build the particulars from."] : [];

    const remedy = { desiredResolution: issues.map((i) => i.desiredResolution).filter((x): x is string => !!x), moneyIssues: acas.preparation?.moneyIssues ?? null };
    const remedyMissing = remedy.desiredResolution.length === 0 ? ["What you want the tribunal to award (for example compensation, reinstatement, a recommendation)."] : [];

    const documentsData = docs.map((d) => ({ filename: d.filename, type: d.docType, date: d.docDate }));

    const govuk = getSource("govuk_et1");

    return {
        generatedAt: new Date().toISOString(),
        caseId,
        jurisdiction: c.jurisdiction,
        claimant: { title: "Claimant details", data: claimant, missing: claimantMissing },
        respondent: { title: "Respondent details", data: respondent, missing: respondentMissing },
        employment: { title: "Employment information", data: emp, missing: empMissing },
        acas: { title: "Acas Early Conciliation", data: acasData, missing: acasMissing },
        claimCategories: { title: "Potential claim categories", data: claimCategories, missing: claimMissing },
        timeLimits: { title: "Time limits", data: timeLimits, missing: tlMissing },
        chronology: { title: "Material chronology", data: chronology, missing: chronologyMissing },
        particulars: { title: "Proposed factual particulars (confirmed facts)", data: particulars, missing: particularsMissing },
        remedy: { title: "Remedy and loss", data: remedy, missing: remedyMissing },
        documents: { title: "Documents", data: documentsData, missing: [] },
        unresolvedQuestions: unresolved,
        missingRequired: [...new Set(missingRequired)],
        provenance: { factIds: facts.map((f) => f.id), eventIds: events.map((e) => e.id), documentIds: docs.map((d) => d.id), claimCandidateIds },
        filing: { officialRoute: { title: govuk.title, url: govuk.url }, note: `${BRAND.name} does not submit claims. Complete the official ET1 form yourself through the GOV.UK service, or with help from an adviser. People involved: ${people.map((p) => `${p.name} (${p.role})`).join(", ") || "none recorded"}.` },
        disclaimer: LEGAL_INFORMATION_DISCLAIMER,
    };
}

/** Render the pack as Markdown for editing/export. */
export function renderEt1Pack(pack: Et1ReadinessPack): string {
    const L: string[] = [`# ET1 readiness pack`, "", `_Generated ${pack.generatedAt.slice(0, 10)}. Jurisdiction: ${pack.jurisdiction.replace("_", " and ")}._`, ""];
    const section = (title: string, lines: string[], missing: string[]) => {
        L.push(`## ${title}`, "");
        if (lines.length) L.push(...lines);
        else L.push("_Nothing recorded yet._");
        if (missing.length) {
            L.push("", "**Still needed:**");
            for (const m of missing) L.push(`- [ ] ${m}`);
        }
        L.push("");
    };
    section(pack.claimant.title, [`- Name: ${pack.claimant.data.name ?? "[add]"}`, `- Email: ${pack.claimant.data.email ?? "[add]"}`], pack.claimant.missing);
    section(pack.respondent.title, [`- Employer: ${pack.respondent.data.employerName ?? "[add]"}`, `- Legal entity: ${pack.respondent.data.legalEntity ?? "[add]"}`, `- Address: ${pack.respondent.data.address ?? "[add]"}`], pack.respondent.missing);
    section(pack.employment.title, [`- Job title: ${pack.employment.data.jobTitle ?? "[add]"}`, `- Status: ${pack.employment.data.status ?? "[add]"}`, `- Start: ${formatLongDate(pack.employment.data.startDate)}`, `- End: ${pack.employment.data.stillEmployed ? "still employed" : formatLongDate(pack.employment.data.endDate)}`, `- Pay: ${pack.employment.data.pay ?? "[add]"}`, `- Hours per week: ${pack.employment.data.hours ?? "[add]"}`], pack.employment.missing);
    section(pack.acas.title, [`- Status: ${pack.acas.data.status.replace(/_/g, " ")}`, `- Reference: ${pack.acas.data.reference ?? "[add]"}`, `- Certificate number: ${pack.acas.data.certificateNumber ?? "[add]"}`, `- Day A (notification): ${formatLongDate(pack.acas.data.notificationDate)}`, `- Day B (certificate): ${formatLongDate(pack.acas.data.certificateIssueDate)}`], pack.acas.missing);
    section(pack.claimCategories.title, pack.claimCategories.data.map((c) => `- ${c.label}: ${c.elementsSupported} of ${c.elementsTotal} elements currently supported${c.stale ? " (out of date)" : ""}${c.missingFacts.length ? `; still needed: ${c.missingFacts.slice(0, 3).join("; ")}` : ""}`), pack.claimCategories.missing);
    section(pack.timeLimits.title, pack.timeLimits.data.map((t) => `- ${t.label}: ${t.date ?? "not yet calculable"} (${t.status}; ${t.sourceReference})${t.warnings.length ? ` — ${t.warnings[0]}` : ""}`), pack.timeLimits.missing);
    section(pack.chronology.title, pack.chronology.data.map((e) => `- ${formatLongDate(e.date)}${e.approximate ? " (approx.)" : ""}: ${e.title}${e.disputed ? " (disputed)" : ""}`), pack.chronology.missing);
    section(pack.particulars.title, pack.particulars.data.map((p, i) => `${i + 1}. ${p}`), pack.particulars.missing);
    section(pack.remedy.title, [...pack.remedy.data.desiredResolution.map((r) => `- ${r}`), ...(pack.remedy.data.moneyIssues ? [`- Money: ${pack.remedy.data.moneyIssues}`] : [])], pack.remedy.missing);
    section(pack.documents.title, pack.documents.data.map((d) => `- ${d.filename} (${d.type.replace(/_/g, " ")}${d.date ? `, ${formatLongDate(d.date)}` : ""})`), []);
    if (pack.unresolvedQuestions.length) {
        L.push("## Unresolved questions", "");
        for (const q of pack.unresolvedQuestions) L.push(`- ${q}`);
        L.push("");
    }
    L.push("## Missing required information", "");
    if (pack.missingRequired.length) for (const m of pack.missingRequired) L.push(`- [ ] ${m}`);
    else L.push("_Nothing required is missing from what this tool tracks._");
    L.push("", "## Where to file", "", `Official route: [${pack.filing.officialRoute.title}](${pack.filing.officialRoute.url})`, "", pack.filing.note, "", `_${pack.disclaimer}_`);
    return L.join("\n");
}

/** Persist the rendered pack as an editable artifact (versioned). */
export async function saveEt1PackArtifact(actor: Actor, caseId: string, pack: Et1ReadinessPack): Promise<ArtifactRow> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const existing = await db.select().from(artifacts).where(eq(artifacts.caseId, caseId));
    const version = existing.filter((a) => a.type === "et1_readiness_pack").reduce((m, a) => Math.max(m, a.version), 0) + 1;
    const id = newId();
    await db.insert(artifacts).values({
        id,
        caseId,
        type: "et1_readiness_pack",
        title: "ET1 readiness pack",
        content: renderEt1Pack(pack),
        version,
        status: "draft",
        basis: { factIds: pack.provenance.factIds, eventIds: pack.provenance.eventIds, documentIds: pack.provenance.documentIds, inputsHash: pack.generatedAt },
        generatedBy: "system",
    });
    await recordAudit({ userId: actor.userId, caseId, action: "artifact.generated", targetType: "artifact", targetId: id, details: { type: "et1_readiness_pack", version } });
    return (await db.select().from(artifacts).where(eq(artifacts.id, id)))[0];
}

// Re-exported for callers that want the drafting path (flag-gated ET1 wording).
export { generateArtifact };
