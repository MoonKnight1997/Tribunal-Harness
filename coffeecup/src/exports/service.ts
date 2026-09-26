/**
 * Case pack export — a structured, portable snapshot of the case for the
 * worker to keep, take to an adviser, or use to complete official forms.
 * Available as JSON (machine-readable) and Markdown (human-readable).
 * Nothing is sent to any third party.
 */

import { requireCaseAccess, type Actor } from "@/cases/access";
import { getEmployment, listPersons } from "@/cases/service";
import { listConfirmedEvents } from "@/timeline/service";
import { listConfirmedFacts, listFacts } from "@/facts/service";
import { listDocuments } from "@/documents/service";
import { listIssues } from "@/issues/service";
import { listProcesses, listAllegations, listAppealGrounds } from "@/processes/service";
import { listDeadlines } from "@/legal/deadlines/case-deadlines";
import { listArtifacts } from "@/artifacts/service";
import { listTasks } from "@/tasks/service";
import { requireEntitlement } from "@/entitlements/service";
import { recordAudit } from "@/cases/audit";
import { stageInfo } from "@/cases/stages";
import { formatLongDate } from "@/lib/dates";
import { BRAND, LEGAL_INFORMATION_DISCLAIMER } from "@/brand/config";
import { renderChronology } from "@/artifacts/service";

export async function buildCasePack(actor: Actor, caseId: string) {
    const c = await requireCaseAccess(actor, caseId);
    await requireEntitlement(actor, caseId, "case_pass");
    const [employment, people, events, confirmedFacts, allFacts, docs, issues, processes, deadlines, artifacts, tasks] = await Promise.all([
        getEmployment(actor, caseId),
        listPersons(actor, caseId),
        listConfirmedEvents(caseId),
        listConfirmedFacts(caseId),
        listFacts(actor, caseId),
        listDocuments(actor, caseId),
        listIssues(actor, caseId),
        listProcesses(actor, caseId),
        listDeadlines(actor, caseId),
        listArtifacts(actor, caseId),
        listTasks(actor, caseId),
    ]);
    const processDetails = [];
    for (const p of processes) {
        processDetails.push({
            ...p,
            allegations: p.type === "disciplinary" ? await listAllegations(actor, caseId, p.id) : [],
            appealGrounds: p.type.endsWith("_appeal") ? await listAppealGrounds(actor, caseId, p.id) : [],
        });
    }
    await recordAudit({ userId: actor.userId, caseId, action: "case.exported", details: { events: events.length, facts: confirmedFacts.length, documents: docs.length } });
    return {
        exportedAt: new Date().toISOString(),
        product: { name: BRAND.name, codename: BRAND.codename },
        case: { id: c.id, title: c.title, jurisdiction: c.jurisdiction, stage: c.stage, status: c.status, entryRoute: c.entryRoute, situationSummary: c.situationSummary, createdAt: c.createdAt, intake: c.intake },
        employment,
        people,
        issues,
        events,
        facts: { confirmed: confirmedFacts, all: allFacts },
        documents: docs.map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, sha256: d.sha256, docType: d.docType, docDate: d.docDate, author: d.author, recipients: d.recipients, extractionStatus: d.extractionStatus, userDescription: d.userDescription })),
        processes: processDetails,
        deadlines,
        artifacts: artifacts.map((a) => ({ id: a.id, type: a.type, title: a.title, version: a.version, status: a.status, stale: a.stale, content: a.content, updatedAt: a.updatedAt })),
        tasks,
        disclaimer: LEGAL_INFORMATION_DISCLAIMER,
    };
}

export type CasePack = Awaited<ReturnType<typeof buildCasePack>>;

export function renderCasePackMarkdown(pack: CasePack): string {
    const L: string[] = [];
    L.push(`# Case pack: ${pack.case.title}`, "", `_Exported ${pack.exportedAt.slice(0, 10)} from ${pack.product.name}. Jurisdiction: ${pack.case.jurisdiction.replace("_", " and ")}. Stage: ${stageInfo(pack.case.stage).label}._`, "");
    if (pack.case.situationSummary) L.push("## What is happening", "", pack.case.situationSummary, "");
    L.push("## Employment", "", `- Employer: ${pack.employment.employerName ?? "[not recorded]"}`, `- Job title: ${pack.employment.jobTitle ?? "[not recorded]"}`, `- Status: ${pack.employment.employmentStatus ?? "[not recorded]"}`, `- Start: ${formatLongDate(pack.employment.startDate)}`, `- End: ${pack.employment.stillEmployed ? "still employed" : formatLongDate(pack.employment.endDate)}`, "");
    if (pack.people.length) L.push("## People", "", ...pack.people.map((p) => `- ${p.name} (${p.role}${p.organisation ? `, ${p.organisation}` : ""})`), "");
    if (pack.issues.length) L.push("## Issues", "", ...pack.issues.map((i) => `- **${i.title}** (${i.category})${i.description ? `: ${i.description}` : ""}${i.desiredResolution ? ` — wanted: ${i.desiredResolution}` : ""}`), "");
    L.push("## Important dates", "");
    for (const d of pack.deadlines) {
        L.push(`- **${d.label}**: ${d.calculatedDate ?? "not yet calculable"} (${d.status})`);
        L.push(`  - Trigger: ${d.explanation.triggerDescription}${d.explanation.triggerDate ? ` — ${d.explanation.triggerDate}` : ""}`);
        for (const a of d.explanation.assumptions) L.push(`  - Assumes: ${a}`);
        if (d.explanation.acasEffect) L.push(`  - Acas: ${d.explanation.acasEffect}`);
        L.push(`  - Source: ${d.explanation.source.title} (${d.explanation.source.reference}, version ${d.explanation.source.version})`);
        for (const w of d.explanation.warnings) L.push(`  - Warning: ${w}`);
        for (const m of d.explanation.missingInformation) L.push(`  - Missing: ${m}`);
    }
    L.push("");
    L.push(renderChronology(pack.events, pack.documents.map((d) => ({ id: d.id, filename: d.filename }))).replace(/^# Chronology/, "## Chronology"), "");
    L.push("## Confirmed facts", "", ...(pack.facts.confirmed.length ? pack.facts.confirmed.map((f) => `- ${f.statement} _(${f.provenance.toLowerCase().replace(/_/g, " ")}${f.disputed ? ", disputed" : ""})_`) : ["_None confirmed yet._"]), "");
    if (pack.processes.length) {
        L.push("## Workplace processes", "");
        for (const p of pack.processes) {
            L.push(`### ${p.type.replace(/_/g, " ")} — ${p.state.replace(/_/g, " ")}`, "");
            if (p.acasCodeVersion) L.push(`_Acas Code applied: ${p.acasCodeVersion}_`, "");
            const data = p.data as Record<string, unknown>;
            for (const [k, v] of Object.entries(data)) if (typeof v === "string" && v) L.push(`- ${k}: ${v}`);
            for (const a of p.allegations) L.push(`- Allegation: ${a.employerAllegation}`, `  - Response: ${a.workerResponse ?? "[not yet recorded]"}`);
            for (const g of p.appealGrounds) L.push(`- Ground (${g.category.replace(/_/g, " ")}): ${g.summary}`);
            L.push("");
        }
    }
    L.push("## Documents", "", ...(pack.documents.length ? pack.documents.map((d) => `- ${d.filename} — ${d.docType.replace(/_/g, " ")}${d.docDate ? `, ${formatLongDate(d.docDate)}` : ""} (sha256 ${d.sha256.slice(0, 12)}…)`) : ["_No documents uploaded._"]), "");
    if (pack.tasks.some((t) => t.status === "open")) L.push("## Open tasks", "", ...pack.tasks.filter((t) => t.status === "open").map((t) => `- [ ] ${t.title}${t.dueDate ? ` (by ${t.dueDate})` : ""}`), "");
    if (pack.artifacts.length) {
        L.push("## Generated documents", "");
        for (const a of pack.artifacts) L.push(`### ${a.title} (v${a.version}${a.stale ? ", out of date" : ""})`, "", a.content, "");
    }
    L.push(`_${pack.disclaimer}_`);
    return L.join("\n");
}
