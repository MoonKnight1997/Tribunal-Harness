/**
 * Case sub-resource router.
 *
 * One handler dispatches every case-scoped endpoint so the tenancy guard,
 * error mapping and authentication are applied uniformly. Every service call
 * receives the authenticated actor; the services enforce ownership.
 *
 *   GET    /api/cases/:id                      case
 *   PATCH  /api/cases/:id                      update case
 *   DELETE /api/cases/:id                      soft delete
 *   GET    /api/cases/:id/dashboard
 *   GET|PATCH /employment
 *   GET|POST /people, PATCH|DELETE /people/:pid
 *   GET|POST /events, PATCH|DELETE /events/:eid, POST /events/:eid/confirm|reject, POST /events/merge
 *   GET|POST /facts, POST /facts/:fid/confirm|reject|correct, PUT /facts/structured/:key
 *   GET|POST /documents (multipart), GET|PATCH|DELETE /documents/:did, GET /documents/:did/download, POST /documents/:did/reprocess
 *   GET|POST /issues, PATCH|DELETE /issues/:iid
 *   GET|POST /processes, GET|PATCH /processes/:pid, POST /processes/:pid/transition
 *   GET|POST /processes/:pid/allegations, PATCH|DELETE /allegations/:aid
 *   GET|POST /processes/:pid/grounds, PATCH|DELETE /grounds/:gid
 *   GET|POST /deadlines   (POST recomputes)
 *   GET|POST /tasks, PATCH|DELETE /tasks/:tid
 *   GET|POST /artifacts, GET|PATCH|DELETE /artifacts/:aid
 *   GET|POST /claims, GET /claims/:cid/elements
 *   GET|POST /et1
 *   GET /export?format=json|markdown
 *   POST /summary/propose, POST /summary/confirm
 *   POST /checkout
 *   POST /purge
 *
 * Bodies the services validate themselves (events, facts, people, issues,
 * processes, allegations, grounds, artifacts PATCH, case) are passed through
 * unchanged. Bodies the services take as plain arguments are parsed here with
 * the Zod schemas below, so a malformed body is a 400 `validation` response
 * and never reaches a service (or becomes a 500).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson, json, requestOrigin } from "@/lib/http";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { requireUser } from "@/auth/current-user";
import * as cases from "@/cases/service";
import { buildDashboard, proposeSituationSummary, confirmSituationSummary } from "@/cases/dashboard";
import * as timeline from "@/timeline/service";
import * as facts from "@/facts/service";
import * as documents from "@/documents/service";
import * as issues from "@/issues/service";
import * as processes from "@/processes/service";
import * as tasks from "@/tasks/service";
import * as artifacts from "@/artifacts/service";
import * as claims from "@/claims/service";
import { buildEt1ReadinessPack, saveEt1PackArtifact } from "@/et1/service";
import { buildCasePack, renderCasePackMarkdown } from "@/exports/service";
import { listDeadlines, computeCaseDeadlines } from "@/legal/deadlines/case-deadlines";
import { startCheckout } from "@/payments/service";
import { purgeCaseNow } from "@/cases/retention";
import { track } from "@/analytics/service";
import { isFlagEnabled } from "@/flags";
import { STRUCTURED_FACT_KEYS, type StructuredFactKey } from "@/facts/service";
import { ARTIFACT_TYPES, ENTITLEMENT_TIERS, type ProcessType } from "@/db/schema";
import type { Actor } from "@/cases/access";
import { isIsoDate } from "@/lib/dates";

type Params = { params: Promise<{ caseId: string; path?: string[] }> };

// ── route-level body schemas ────────────────────────────────────────────
const nonEmptyId = z.string().trim().min(1).max(200);
const MergeBody = z.object({ keepId: nonEmptyId, mergeIds: z.array(nonEmptyId).min(1).max(100) });
const TransitionBody = z.object({ to: z.string().trim().min(1).max(100), note: z.string().trim().max(2000).nullable().optional() });
const TaskPatchBody = z.object({ done: z.boolean().optional() });
const SummaryConfirmBody = z.object({ summary: z.string().max(5000) });
const CheckoutBody = z.object({ tier: z.enum(ENTITLEMENT_TIERS) });
const StructuredFactBody = z.object({
    value: z.string().refine(isIsoDate, "Expected a date in YYYY-MM-DD format").nullable().optional(),
    statement: z.string().trim().max(4000).optional(),
});
const ArtifactCreateBody = z.object({
    type: z.enum(ARTIFACT_TYPES),
    processId: nonEmptyId.nullable().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});

function parseBody<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.output<T> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the request.", parsed.error.flatten());
    return parsed.data;
}

async function dispatch(request: NextRequest, ctx: Params): Promise<NextResponse | Response> {
    const { user, actor } = await requireUser();
    const { caseId, path = [] } = await ctx.params;
    const method = request.method.toUpperCase();
    const [seg0, seg1, seg2] = path;
    const body = () => readJson<Record<string, unknown>>(request);

    // ── case ────────────────────────────────────────────────────────────
    if (path.length === 0) {
        if (method === "GET") return json({ case: await cases.getCase(actor, caseId) });
        if (method === "PATCH") return json({ case: await cases.updateCase(actor, caseId, await body()) });
        if (method === "DELETE") {
            await cases.deleteCase(actor, caseId);
            return json({ ok: true });
        }
    }
    if (seg0 === "dashboard" && method === "GET") return json(await buildDashboard(actor, caseId));
    if (seg0 === "purge" && method === "POST") {
        await purgeCaseNow(actor.userId, caseId);
        return json({ ok: true });
    }

    // ── employment / people ─────────────────────────────────────────────
    if (seg0 === "employment") {
        if (method === "GET") return json({ employment: await cases.getEmployment(actor, caseId) });
        if (method === "PATCH") return json({ employment: await cases.updateEmployment(actor, caseId, await body()) });
    }
    if (seg0 === "people") {
        if (!seg1 && method === "GET") return json({ people: await cases.listPersons(actor, caseId) });
        if (!seg1 && method === "POST") return json({ person: await cases.addPerson(actor, caseId, await body() as never) }, { status: 201 });
        if (seg1 && method === "PATCH") return json({ person: await cases.updatePerson(actor, caseId, seg1, await body() as never) });
        if (seg1 && method === "DELETE") {
            await cases.removePerson(actor, caseId, seg1);
            return json({ ok: true });
        }
    }

    // ── timeline ────────────────────────────────────────────────────────
    if (seg0 === "events") {
        if (!seg1 && method === "GET") {
            const status = request.nextUrl.searchParams.get("status") as "proposed" | "confirmed" | "rejected" | null;
            return json({ events: await timeline.listEvents(actor, caseId, status ? { status } : undefined) });
        }
        if (!seg1 && method === "POST") return json({ event: await timeline.addEvent(actor, caseId, await body() as never) }, { status: 201 });
        if (seg1 === "merge" && method === "POST") {
            const b = parseBody(MergeBody, await body());
            return json({ event: await timeline.mergeEvents(actor, caseId, b.keepId, b.mergeIds) });
        }
        if (seg1 && seg2 === "confirm" && method === "POST") return json({ event: await timeline.confirmEvent(actor, caseId, seg1) });
        if (seg1 && seg2 === "reject" && method === "POST") {
            await timeline.rejectEvent(actor, caseId, seg1);
            return json({ ok: true });
        }
        if (seg1 && !seg2 && method === "PATCH") return json({ event: await timeline.updateEvent(actor, caseId, seg1, await body() as never) });
        if (seg1 && !seg2 && method === "DELETE") {
            await timeline.deleteEvent(actor, caseId, seg1);
            return json({ ok: true });
        }
    }

    // ── facts ───────────────────────────────────────────────────────────
    if (seg0 === "facts") {
        if (!seg1 && method === "GET") {
            const status = request.nextUrl.searchParams.get("status");
            return json({ facts: await facts.listFacts(actor, caseId, status ? { status } : undefined) });
        }
        if (!seg1 && method === "POST") return json({ fact: await facts.addFact(actor, caseId, await body() as never) }, { status: 201 });
        if (seg1 === "structured" && seg2 && method === "PUT") {
            if (!(STRUCTURED_FACT_KEYS as readonly string[]).includes(seg2)) throw new ValidationError("Unknown structured fact key.");
            const b = parseBody(StructuredFactBody, await body());
            return json({ fact: await facts.setStructuredFact(actor, caseId, seg2 as StructuredFactKey, b.value ?? null, b.statement) });
        }
        if (seg1 && seg2 === "confirm" && method === "POST") return json({ fact: await facts.confirmFact(actor, caseId, seg1) });
        if (seg1 && seg2 === "reject" && method === "POST") {
            await facts.rejectFact(actor, caseId, seg1);
            return json({ ok: true });
        }
        if (seg1 && seg2 === "correct" && method === "POST") return json({ fact: await facts.correctFact(actor, caseId, seg1, await body() as never) });
    }

    // ── documents ───────────────────────────────────────────────────────
    if (seg0 === "documents") {
        if (!seg1 && method === "GET") return json({ documents: await documents.listDocuments(actor, caseId) });
        if (!seg1 && method === "POST") {
            const form = await request.formData();
            const file = form.get("file");
            if (!(file instanceof File)) throw new ValidationError("Send the file as multipart form field 'file'.");
            const description = form.get("description");
            const processId = form.get("processId");
            const bytes = Buffer.from(await file.arrayBuffer());
            const result = await documents.uploadDocument(actor, caseId, { filename: file.name, mimeType: file.type, body: bytes, userDescription: typeof description === "string" ? description : null, processId: typeof processId === "string" ? processId : null });
            await track("document_uploaded", actor.userId, { docType: result.document.docType });
            return json(result, { status: 201 });
        }
        if (seg1 && seg2 === "download" && method === "GET") {
            const { document, body: bytes } = await documents.getDocumentBytes(actor, caseId, seg1);
            return new Response(new Uint8Array(bytes), {
                headers: {
                    "content-type": document.mimeType,
                    "content-disposition": `attachment; filename="${document.filename.replace(/["\r\n]/g, "")}"`,
                    "cache-control": "private, no-store",
                    "x-content-type-options": "nosniff",
                },
            });
        }
        if (seg1 && seg2 === "reprocess" && method === "POST") return json({ jobId: await documents.reprocessDocument(actor, caseId, seg1) });
        if (seg1 && !seg2 && method === "GET") return json({ document: await documents.getDocument(actor, caseId, seg1), links: await documents.listDocumentLinks(actor, caseId, seg1) });
        if (seg1 && !seg2 && method === "PATCH") return json({ document: await documents.updateDocument(actor, caseId, seg1, await body() as never) });
        if (seg1 && !seg2 && method === "DELETE") {
            await documents.deleteDocument(actor, caseId, seg1);
            return json({ ok: true });
        }
    }

    // ── issues ──────────────────────────────────────────────────────────
    if (seg0 === "issues") {
        if (!seg1 && method === "GET") return json({ issues: await issues.listIssues(actor, caseId) });
        if (!seg1 && method === "POST") return json({ issue: await issues.addIssue(actor, caseId, await body() as never) }, { status: 201 });
        if (seg1 && method === "PATCH") return json({ issue: await issues.updateIssue(actor, caseId, seg1, await body() as never) });
        if (seg1 && method === "DELETE") {
            await issues.deleteIssue(actor, caseId, seg1);
            return json({ ok: true });
        }
    }

    // ── processes ───────────────────────────────────────────────────────
    if (seg0 === "processes") {
        if (!seg1 && method === "GET") {
            const type = request.nextUrl.searchParams.get("type") as ProcessType | null;
            return json({ processes: await processes.listProcesses(actor, caseId, type ?? undefined) });
        }
        if (!seg1 && method === "POST") {
            const p = await processes.startProcess(actor, caseId, await body() as never);
            if (p.type === "acas_early_conciliation") await track("acas_workspace_reached", actor.userId, { stage: "acas" });
            return json({ process: p }, { status: 201 });
        }
        if (seg1 && !seg2 && method === "GET") return json({ process: await processes.getProcess(actor, caseId, seg1), transitions: await processes.listTransitions(actor, caseId, seg1) });
        if (seg1 && !seg2 && method === "PATCH") return json({ process: await processes.updateProcessData(actor, caseId, seg1, await body()) });
        if (seg1 && seg2 === "transition" && method === "POST") {
            const b = parseBody(TransitionBody, await body());
            return json({ process: await processes.transitionProcess(actor, caseId, seg1, b.to, b.note ?? undefined) });
        }
        if (seg1 && seg2 === "allegations" && method === "GET") return json({ allegations: await processes.listAllegations(actor, caseId, seg1) });
        if (seg1 && seg2 === "allegations" && method === "POST") return json({ allegation: await processes.addAllegation(actor, caseId, seg1, await body() as never) }, { status: 201 });
        if (seg1 && seg2 === "grounds" && method === "GET") return json({ grounds: await processes.listAppealGrounds(actor, caseId, seg1) });
        if (seg1 && seg2 === "grounds" && method === "POST") return json({ ground: await processes.addAppealGround(actor, caseId, seg1, await body() as never) }, { status: 201 });
    }
    if (seg0 === "allegations" && seg1) {
        if (method === "PATCH") return json({ allegation: await processes.updateAllegation(actor, caseId, seg1, await body() as never) });
        if (method === "DELETE") {
            await processes.deleteAllegation(actor, caseId, seg1);
            return json({ ok: true });
        }
    }
    if (seg0 === "grounds" && seg1) {
        if (method === "PATCH") return json({ ground: await processes.updateAppealGround(actor, caseId, seg1, await body() as never) });
        if (method === "DELETE") {
            await processes.deleteAppealGround(actor, caseId, seg1);
            return json({ ok: true });
        }
    }

    // ── deadlines / tasks ───────────────────────────────────────────────
    if (seg0 === "deadlines") {
        if (method === "GET") return json({ deadlines: await listDeadlines(actor, caseId) });
        if (method === "POST") return json({ deadlines: await computeCaseDeadlines(actor, caseId) });
    }
    if (seg0 === "tasks") {
        if (!seg1 && method === "GET") return json({ tasks: await tasks.listTasks(actor, caseId) });
        if (!seg1 && method === "POST") return json({ task: await tasks.addTask(actor, caseId, await body() as never) }, { status: 201 });
        if (seg1 && method === "PATCH") {
            const b = parseBody(TaskPatchBody, await body());
            return json({ task: await tasks.completeTask(actor, caseId, seg1, b.done ?? true) });
        }
        if (seg1 && method === "DELETE") {
            await tasks.deleteTask(actor, caseId, seg1);
            return json({ ok: true });
        }
    }

    // ── artifacts ───────────────────────────────────────────────────────
    if (seg0 === "artifacts") {
        if (!seg1 && method === "GET") return json({ artifacts: await artifacts.listArtifacts(actor, caseId) });
        if (!seg1 && method === "POST") {
            const b = parseBody(ArtifactCreateBody, await body());
            const a = await artifacts.generateArtifact(actor, caseId, b.type, { processId: b.processId ?? null, extra: b.extra });
            const evt = b.type === "grievance_letter" ? "grievance_produced" : b.type === "disciplinary_response" ? "disciplinary_prep_produced" : b.type.endsWith("_appeal") ? "appeal_produced" : null;
            if (evt) await track(evt, actor.userId, { artifactType: b.type });
            return json({ artifact: a }, { status: 201 });
        }
        if (seg1 && method === "GET") return json({ artifact: await artifacts.getArtifact(actor, caseId, seg1) });
        if (seg1 && method === "PATCH") return json({ artifact: await artifacts.editArtifact(actor, caseId, seg1, await body() as never) });
        if (seg1 && method === "DELETE") {
            await artifacts.deleteArtifact(actor, caseId, seg1);
            return json({ ok: true });
        }
    }

    // ── claims (server-side flag) ───────────────────────────────────────
    if (seg0 === "claims") {
        if (!isFlagEnabled("ENABLE_PERSONALISED_CLAIM_IDENTIFICATION")) throw new NotFoundError();
        if (!seg1 && method === "GET") return json({ candidates: await claims.listClaimCandidates(actor, caseId) });
        if (!seg1 && method === "POST") {
            const result = await claims.identifyClaims(actor, caseId);
            await track("claims_identified", actor.userId, { count: result.length });
            return json({ candidates: result });
        }
        if (seg1 && seg2 === "elements" && method === "GET") return json({ elements: await claims.listClaimElements(actor, caseId, seg1) });
    }

    // ── ET1 / export ────────────────────────────────────────────────────
    if (seg0 === "et1") {
        const pack = await buildEt1ReadinessPack(actor, caseId, { userEmail: user.email, userName: user.displayName });
        if (method === "GET") return json({ pack });
        if (method === "POST") {
            const artifact = await saveEt1PackArtifact(actor, caseId, pack);
            await track("et1_pack_created", actor.userId, { stage: "et1" });
            return json({ pack, artifact }, { status: 201 });
        }
    }
    if (seg0 === "export" && method === "GET") {
        const pack = await buildCasePack(actor, caseId);
        await track("case_exported", actor.userId, { stage: pack.case.stage });
        const format = request.nextUrl.searchParams.get("format") ?? "json";
        if (format === "markdown" || format === "md") {
            return new Response(renderCasePackMarkdown(pack), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="case-pack-${caseId.slice(0, 8)}.md"`, "cache-control": "private, no-store" } });
        }
        return new Response(JSON.stringify(pack, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="case-pack-${caseId.slice(0, 8)}.json"`, "cache-control": "private, no-store" } });
    }

    // ── summary ─────────────────────────────────────────────────────────
    if (seg0 === "summary" && seg1 === "propose" && method === "POST") return json(await proposeSituationSummary(actor, caseId));
    if (seg0 === "summary" && seg1 === "confirm" && method === "POST") {
        const b = parseBody(SummaryConfirmBody, await body());
        await confirmSituationSummary(actor, caseId, b.summary);
        return json({ ok: true });
    }

    // ── checkout ────────────────────────────────────────────────────────
    if (seg0 === "checkout" && method === "POST") {
        const b = parseBody(CheckoutBody, await body());
        const res = await startCheckout(actor, caseId, b.tier, { customerEmail: user.email, origin: requestOrigin(request) });
        return json(res);
    }

    throw new AppError("Not found.", 404, "not_found");
}

export const GET = handle(dispatch);
export const POST = handle(dispatch);
export const PATCH = handle(dispatch);
export const PUT = handle(dispatch);
export const DELETE = handle(dispatch);

export type { Actor };
