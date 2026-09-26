/**
 * Home dashboard model: "What should I pay attention to now?"
 */

import { requireCaseAccess, type Actor } from "@/cases/access";
import { getEmployment } from "@/cases/service";
import { stageInfo, type NavSection } from "@/cases/stages";
import { listConfirmedEvents, listProposedEvents } from "@/timeline/service";
import { listConfirmedFacts, listFacts } from "@/facts/service";
import { listDocuments } from "@/documents/service";
import { listProcesses } from "@/processes/service";
import { listDeadlines } from "@/legal/deadlines/case-deadlines";
import { listTasks } from "@/tasks/service";
import { listArtifacts } from "@/artifacts/service";
import { listIssues } from "@/issues/service";
import { stateDef } from "@/processes/machines";
import { getProvider } from "@/ai/routing";
import { runSummariseCase } from "@/ai/tasks/summarise-case";
import { getDb } from "@/db/client";
import { cases } from "@/db/schema";
import { eq } from "drizzle-orm";
import { todayISO } from "@/lib/dates";
import { publicCapabilities } from "@/flags";
import { hasEntitlement, paymentsEnabled } from "@/entitlements/service";

export interface Dashboard {
    case: { id: string; title: string; stage: string; stageLabel: string; stagePlain: string; jurisdiction: string; status: string; summaryStale: boolean };
    situation: { summary: string | null; stillUnclear: string[] };
    important: Array<{ label: string; date: string | null; status: string; daysAway: number | null; headline: string }>;
    nextSteps: Array<{ id: string; title: string; kind: string; dueDate: string | null; systemKey: string | null }>;
    recentActivity: Array<{ kind: "document" | "event" | "artifact"; title: string; at: string; status?: string }>;
    missingInformation: string[];
    reviewQueue: { proposedEvents: number; proposedFacts: number };
    processes: Array<{ id: string; type: string; state: string; stateLabel: string; statePlain: string; nextStates: string[] }>;
    counts: { events: number; facts: number; documents: number; artifacts: number; issues: number };
    nav: NavSection[];
    capabilities: ReturnType<typeof publicCapabilities>;
    entitlements: { paymentsEnabled: boolean; casePass: boolean; claimPack: boolean };
}

export async function buildDashboard(actor: Actor, caseId: string): Promise<Dashboard> {
    const c = await requireCaseAccess(actor, caseId);
    const employment = await getEmployment(actor, caseId);
    const [events, proposedEvents, facts, allFacts, docs, processes, deadlines, tasks, artifacts, issues] = await Promise.all([
        listConfirmedEvents(caseId),
        listProposedEvents(actor, caseId),
        listConfirmedFacts(caseId),
        listFacts(actor, caseId, { status: "proposed" }),
        listDocuments(actor, caseId),
        listProcesses(actor, caseId),
        listDeadlines(actor, caseId),
        listTasks(actor, caseId),
        listArtifacts(actor, caseId),
        listIssues(actor, caseId),
    ]);
    const today = todayISO();
    const missing = new Set<string>();
    if (!employment.employerName) missing.add("Employer name.");
    if (!employment.employmentStatus || employment.employmentStatus === "unsure") missing.add("Whether you are an employee, a worker or self-employed.");
    if (!employment.startDate) missing.add("Employment start date.");
    if (employment.stillEmployed === false && !employment.endDate) missing.add("The date your employment ended.");
    for (const d of deadlines) for (const m of d.explanation.missingInformation) missing.add(m);
    if (events.length === 0) missing.add("At least one confirmed event on the timeline.");
    if (issues.length === 0) missing.add("What the problem is about and what outcome you want.");

    const important = deadlines
        .map((d) => {
            const daysAway = d.calculatedDate ? Math.round((Date.parse(`${d.calculatedDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
            const headline = !d.calculatedDate
                ? `${d.label}: needs a date before it can be worked out.`
                : d.status === "expired"
                    ? `${d.label}: appears to have passed on ${d.calculatedDate}.`
                    : `${d.label}: ${d.calculatedDate}${daysAway !== null ? ` (${daysAway} days)` : ""}.`;
            return { label: d.label, date: d.calculatedDate, status: d.status, daysAway, headline };
        })
        .sort((a, b) => (a.date ?? "9999") < (b.date ?? "9999") ? -1 : 1);

    const recent = [
        ...docs.slice(0, 5).map((d) => ({ kind: "document" as const, title: d.filename, at: d.uploadedAt.toISOString(), status: d.extractionStatus })),
        ...events.slice(-5).map((e) => ({ kind: "event" as const, title: `${e.date}: ${e.title}`, at: e.updatedAt.toISOString() })),
        ...artifacts.slice(0, 5).map((a) => ({ kind: "artifact" as const, title: `${a.title} v${a.version}`, at: a.updatedAt.toISOString(), status: a.stale ? "out of date" : a.status })),
    ]
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 8);

    const stage = stageInfo(c.stage);
    return {
        case: { id: c.id, title: c.title, stage: c.stage, stageLabel: stage.label, stagePlain: stage.plain, jurisdiction: c.jurisdiction, status: c.status, summaryStale: c.summaryStale },
        situation: { summary: c.situationSummary, stillUnclear: [...missing].slice(0, 6) },
        important,
        nextSteps: tasks.filter((t) => t.status === "open").slice(0, 6).map((t) => ({ id: t.id, title: t.title, kind: t.kind, dueDate: t.dueDate, systemKey: t.systemKey })),
        recentActivity: recent,
        missingInformation: [...missing],
        reviewQueue: { proposedEvents: proposedEvents.length, proposedFacts: allFacts.length },
        processes: processes.filter((p) => !p.closedAt).map((p) => {
            const def = stateDef(p.type, p.state);
            return { id: p.id, type: p.type, state: p.state, stateLabel: def?.label ?? p.state, statePlain: def?.plain ?? "", nextStates: def?.next ?? [] };
        }),
        counts: { events: events.length, facts: facts.length, documents: docs.length, artifacts: artifacts.length, issues: issues.length },
        nav: stage.nav,
        capabilities: publicCapabilities(),
        entitlements: { paymentsEnabled: paymentsEnabled(), casePass: await hasEntitlement(actor, caseId, "case_pass"), claimPack: await hasEntitlement(actor, caseId, "claim_pack") },
    };
}

/** Regenerate the "what is happening" summary from confirmed material; the user then confirms/edits it. */
export async function proposeSituationSummary(actor: Actor, caseId: string): Promise<{ summary: string; stillUnclear: string[] }> {
    await requireCaseAccess(actor, caseId);
    const employment = await getEmployment(actor, caseId);
    const events = await listConfirmedEvents(caseId);
    const facts = await listConfirmedFacts(caseId);
    const provider = await getProvider();
    const res = await runSummariseCase(provider, {
        employer: employment.employerName,
        jobTitle: employment.jobTitle,
        stillEmployed: employment.stillEmployed,
        events: events.map((e) => ({ date: e.date, title: e.title, description: e.description })),
        facts: facts.map((f) => ({ statement: f.statement, disputed: f.disputed })),
    });
    return { summary: res.data.whatIsHappening || res.data.summary, stillUnclear: res.data.stillUnclear };
}

export async function confirmSituationSummary(actor: Actor, caseId: string, summary: string): Promise<void> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    await db.update(cases).set({ situationSummary: summary.slice(0, 5000), summaryStale: false, updatedAt: new Date() }).where(eq(cases.id, caseId));
}
