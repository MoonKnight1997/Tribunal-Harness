/**
 * Generated artifacts — letters, chronologies, summaries, preparation notes.
 *
 * Case facts and generated wording are different things. An artifact records
 * the basis it was generated from (fact/event/document ids and a hash of
 * their content) and a `generation` snapshot (task, prompt version, provider,
 * model, hash of the exact payload sent, rule and source versions). Editing
 * the wording never changes facts; changing facts marks the artifact stale so
 * the user can regenerate it.
 *
 * Policy (which types need which flags/tier, and which the model may draft at
 * all) lives in ./policy.ts and is enforced here before anything is counted,
 * drafted or written. Caller-supplied input is validated against a strict
 * allow-list and passed to the model ONLY under `supplementary`; it can never
 * overwrite the authoritative record.
 *
 * Chronology is built deterministically from confirmed events. Letters and
 * preparation notes use the drafting task; the mock provider produces a
 * faithful template so tests are hermetic. Every model draft is run through
 * the deterministic checks in ./checks.ts and the resulting flags are stored
 * for the reader; nothing is appended to or removed from the draft.
 */

import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { artifacts, type ArtifactBasis, type ArtifactGeneration, type ArtifactReviewFlag, type ArtifactType, type GrievanceProcessData } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { requireCaseAccess, touchCase, type Actor } from "@/cases/access";
import { recordAudit } from "@/cases/audit";
import { getEmployment, listPersons } from "@/cases/service";
import { listConfirmedEvents } from "@/timeline/service";
import { listConfirmedFacts } from "@/facts/service";
import { listDocuments } from "@/documents/service";
import { listIssues } from "@/issues/service";
import { getProcess, listAllegations, listAppealGrounds } from "@/processes/service";
import { listDeadlines } from "@/legal/deadlines/case-deadlines";
import { getProvider } from "@/ai/routing";
import { runDraft, draftTaskId, DRAFT_PROMPT_VERSION } from "@/ai/tasks/draft";
import { checkAndCountUsage } from "@/entitlements/fair-use";
import { formatLongDate, todayISO } from "@/lib/dates";
import { getSource } from "@/legal/sources/registry";
import { BRAND, LEGAL_INFORMATION_DISCLAIMER } from "@/brand/config";
import { assertArtifactAllowed } from "./policy";
import { checkDraft } from "./checks";

export type ArtifactRow = typeof artifacts.$inferSelect;

const TITLES: Record<ArtifactType, string> = {
    grievance_letter: "Grievance letter",
    grievance_appeal: "Grievance appeal",
    disciplinary_response: "Disciplinary hearing preparation",
    disciplinary_appeal: "Disciplinary appeal",
    chronology: "Chronology",
    case_summary: "Case summary",
    acas_preparation: "Acas Early Conciliation preparation",
    meeting_preparation: "Meeting preparation",
    potential_claims_summary: "Possible claims summary",
    et1_readiness_pack: "ET1 readiness pack",
    case_pack: "Case pack",
};

/** Legal sources a drafted type cites (registry keys), recorded as provenance. */
const CITED_SOURCES: Partial<Record<ArtifactType, string[]>> = {
    acas_preparation: ["acas_early_conciliation_guidance"],
    grievance_letter: ["acas_code_2015"],
    grievance_appeal: ["acas_code_2015"],
    disciplinary_response: ["acas_code_2015"],
    disciplinary_appeal: ["acas_code_2015"],
};

// ── caller-supplied (non-authoritative) input ────────────────────────────────

const shortList = (max: number, len: number) => z.array(z.string().trim().max(len)).max(max);

/**
 * The ONLY shape a caller may add to a drafting request. Anything else —
 * in particular `facts`, `events`, `people`, `employer` — is rejected, so the
 * authoritative record cannot be rewritten from outside.
 */
export const SupplementaryInput = z
    .object({
        preparation: z
            .object({
                keyIssues: shortList(20, 300),
                stepsTaken: shortList(20, 300),
                moneyIssues: z.string().trim().max(2000),
                desiredResolution: z.string().trim().max(2000),
                questionsToClarify: shortList(20, 300),
            })
            .strict()
            .partial()
            .optional(),
        instructions: z.string().trim().max(1000).optional(),
    })
    .strict();

export type SupplementaryInput = z.infer<typeof SupplementaryInput>;

export interface GenerateArtifactOptions {
    processId?: string | null;
    supplementary?: unknown;
    /** Legacy name used by the Acas page; validated exactly like `supplementary`. */
    extra?: unknown;
}

function parseSupplementary(opts?: GenerateArtifactOptions): SupplementaryInput | null {
    const raw = opts?.supplementary ?? opts?.extra;
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("Additional notes must be an object.");
    const parsed = SupplementaryInput.safeParse(raw);
    if (!parsed.success) {
        const keys = parsed.error.issues.map((i) => i.path.join(".") || "(root)");
        throw new ValidationError("Additional notes contain fields that are not allowed.", { fields: [...new Set(keys)], issues: parsed.error.issues.map((i) => i.message) });
    }
    if (Object.keys(parsed.data).length === 0) return null;
    return parsed.data;
}

function supplementaryKeys(supp: SupplementaryInput | null): string[] {
    if (!supp) return [];
    const keys: string[] = [];
    for (const [k, v] of Object.entries(supp)) {
        keys.push(k);
        if (k === "preparation" && v && typeof v === "object") for (const sub of Object.keys(v)) keys.push(`preparation.${sub}`);
    }
    return keys;
}

// ── hashing ──────────────────────────────────────────────────────────────────

function hashInputs(parts: unknown[]): string {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/** sha256 of the exact string sent to the model (or of a deterministic pack). */
export function hashPayload(serialised: string): string {
    return createHash("sha256").update(serialised).digest("hex");
}

// ── basis ────────────────────────────────────────────────────────────────────

async function gatherBasis(actor: Actor, caseId: string, processId?: string | null, supplementary: SupplementaryInput | null = null) {
    const events = await listConfirmedEvents(caseId);
    const facts = await listConfirmedFacts(caseId);
    const docs = await listDocuments(actor, caseId);
    const employment = await getEmployment(actor, caseId);
    const people = await listPersons(actor, caseId);
    const issues = await listIssues(actor, caseId);
    const basis: ArtifactBasis = {
        factIds: facts.map((f) => f.id),
        eventIds: events.map((e) => e.id),
        documentIds: docs.map((d) => d.id),
        processId: processId ?? undefined,
        inputsHash: hashInputs([
            events.map((e) => [e.id, e.date, e.title, e.description]),
            facts.map((f) => [f.id, f.statement, f.value]),
            docs.map((d) => [d.id, d.docType, d.docDate]),
            employment,
            issues.map((i) => [i.id, i.title, i.description, i.desiredResolution]),
            ...(supplementary ? [supplementary] : []),
        ]),
    };
    return { events, facts, docs, employment, people, issues, basis };
}

export function renderChronology(events: Array<{ date: string; dateEnd: string | null; dateApproximate: boolean; title: string; description: string | null; category: string; disputed: boolean; sourceDocumentIds: string[] }>, docs: Array<{ id: string; filename: string }>): string {
    const lines = ["# Chronology", "", "_Confirmed events only, in date order. Approximate dates are marked._", ""];
    if (events.length === 0) lines.push("_No events have been confirmed yet._");
    const docName = new Map(docs.map((d) => [d.id, d.filename]));
    for (const e of events) {
        const when = `${formatLongDate(e.date)}${e.dateEnd ? ` to ${formatLongDate(e.dateEnd)}` : ""}${e.dateApproximate ? " (approximate)" : ""}`;
        lines.push(`## ${when} — ${e.title}${e.disputed ? " (disputed)" : ""}`);
        if (e.description && e.description !== e.title) lines.push("", e.description);
        const sources = e.sourceDocumentIds.map((id) => docName.get(id)).filter(Boolean);
        if (sources.length) lines.push("", `_Documents: ${sources.join(", ")}_`);
        lines.push("");
    }
    lines.push(`_Generated by ${BRAND.name} from the confirmed case record. ${LEGAL_INFORMATION_DISCLAIMER}_`);
    return lines.join("\n");
}

function sourceVersions(type: ArtifactType): ArtifactGeneration["sourceVersions"] {
    return (CITED_SOURCES[type] ?? []).map((key) => {
        const s = getSource(key);
        return { key: s.key, version: s.version };
    });
}

// ── generation ───────────────────────────────────────────────────────────────

export async function generateArtifact(actor: Actor, caseId: string, type: ArtifactType, opts?: GenerateArtifactOptions): Promise<ArtifactRow> {
    // Tenancy first (a guessed case id is a plain 404), then policy: type
    // validity, generic-path allowed, regulatory flags, entitlement. Nothing
    // below runs — no usage counting, no model call, no write — if this throws.
    const c = await requireCaseAccess(actor, caseId);
    const policy = await assertArtifactAllowed(actor, caseId, type);
    const supplementary = parseSupplementary(opts);
    const processId = opts?.processId ?? null;
    const { events, facts, docs, employment, people, issues, basis } = await gatherBasis(actor, caseId, processId, supplementary);

    let content: string;
    let generatedBy = "system";
    let generation: ArtifactGeneration;
    let reviewFlags: ArtifactReviewFlag[] = [];

    if (!policy.modelDrafted) {
        // Only the chronology reaches here (case_pack is refused by policy).
        content = renderChronology(events, docs);
        generation = {
            task: `${type}_deterministic_v1`,
            promptVersion: "deterministic",
            provider: "deterministic",
            model: "deterministic",
            payloadHash: hashPayload(JSON.stringify({ events: events.map((e) => e.id), docs: docs.map((d) => d.id) })),
            supplementaryKeys: [],
            ruleVersions: [],
            sourceVersions: [],
            generatedAt: new Date().toISOString(),
        };
    } else {
        const usage = await checkAndCountUsage(actor.userId, caseId, "ai_generation");
        if (!usage.ok) throw new ValidationError(usage.reason);

        const deadlines = await listDeadlines(actor, caseId);
        const authoritative: Record<string, unknown> = {
            title: TITLES[type],
            today: todayISO(),
            employer: employment.employerName ?? "[employer name]",
            jobTitle: employment.jobTitle ?? null,
            employment: { status: employment.employmentStatus, startDate: employment.startDate, endDate: employment.endDate, stillEmployed: employment.stillEmployed, workplace: employment.workplace },
            people: people.map((p) => ({ name: p.name, role: p.role })),
            issues: issues.map((i) => ({ title: i.title, description: i.description, desiredResolution: i.desiredResolution })),
            events: events.map((e) => ({ date: e.date, dateEnd: e.dateEnd, approximate: e.dateApproximate, title: e.title, description: e.description, disputed: e.disputed })),
            facts: facts.map((f) => ({ statement: f.statement, key: f.key, value: f.value, provenance: f.provenance, disputed: f.disputed })),
            documents: docs.map((d) => ({ filename: d.filename, type: d.docType, date: d.docDate })),
            timeLimits: deadlines.map((d) => ({ label: d.label, date: d.calculatedDate, status: d.status })),
            desiredResolution: issues.map((i) => i.desiredResolution).filter(Boolean).join("; ") || null,
            uncertainties: [
                ...(employment.employerName ? [] : ["Employer name not recorded."]),
                ...facts.filter((f) => f.disputed).map((f) => `Disputed: ${f.statement}`),
            ],
        };
        if (processId) {
            const proc = await getProcess(actor, caseId, processId);
            authoritative.process = { type: proc.type, state: proc.state, data: proc.data };
            if (proc.type === "disciplinary") {
                authoritative.allegations = (await listAllegations(actor, caseId, proc.id)).map((a) => ({ employerAllegation: a.employerAllegation, employerEvidence: a.employerEvidence, workerResponse: a.workerResponse, workerEvidence: a.workerEvidence, missingInformation: a.missingInformation, hearingQuestions: a.hearingQuestions }));
            }
            if (proc.type === "grievance") {
                const gd = proc.data as GrievanceProcessData;
                if (gd.desiredResolution) authoritative.desiredResolution = gd.desiredResolution;
            }
            if (proc.type === "grievance_appeal" || proc.type === "disciplinary_appeal" || type === "grievance_appeal" || type === "disciplinary_appeal") {
                authoritative.grounds = (await listAppealGrounds(actor, caseId, proc.id)).filter((g) => g.selected).map((g) => ({ category: g.category, summary: g.summary, detail: g.detail }));
            }
        }

        const provider = await getProvider();
        const draft = await runDraft(provider, type, { authoritative, supplementary });
        const body = draft.text.trim();
        reviewFlags = checkDraft(body, { authoritative, supplementary });
        content = `${body}\n\n---\n_${LEGAL_INFORMATION_DISCLAIMER}_`;
        generatedBy = `${draft.provider}:${draft.model}`;
        generation = {
            task: draft.task,
            promptVersion: draft.promptVersion,
            provider: draft.provider,
            model: draft.model,
            payloadHash: hashPayload(draft.input),
            supplementaryKeys: supplementaryKeys(supplementary),
            ruleVersions: dedupe(deadlines.map((d) => ({ id: d.ruleId, version: d.ruleVersion }))),
            sourceVersions: sourceVersions(type),
            generatedAt: new Date().toISOString(),
        };
    }

    const db = await getDb();
    const existing = await db.select().from(artifacts).where(and(eq(artifacts.caseId, caseId), eq(artifacts.type, type), processId ? eq(artifacts.processId, processId) : eq(artifacts.status, "draft"))).orderBy(desc(artifacts.version)).limit(1);
    const version = (existing[0]?.version ?? 0) + 1;
    const id = newId();
    await db.insert(artifacts).values({ id, caseId, type, title: TITLES[type], content, version, status: "draft", stale: false, basis, generation, reviewFlags, processId, generatedBy });
    await touchCase(caseId);
    await recordAudit({
        userId: actor.userId,
        caseId,
        action: "artifact.generated",
        targetType: "artifact",
        targetId: id,
        details: { type, version, generatedBy, task: generation.task, promptVersion: generation.promptVersion, events: events.length, facts: facts.length, flags: reviewFlags.length, supplementaryKeys: generation.supplementaryKeys, jurisdiction: c.jurisdiction },
    });
    return (await db.select().from(artifacts).where(eq(artifacts.id, id)))[0];
}

function dedupe(items: Array<{ id: string; version: string }>): Array<{ id: string; version: string }> {
    const seen = new Set<string>();
    return items.filter((i) => {
        const k = `${i.id}@${i.version}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

export { DRAFT_PROMPT_VERSION, draftTaskId };

// ── read / edit / delete ─────────────────────────────────────────────────────

export async function listArtifacts(actor: Actor, caseId: string): Promise<ArtifactRow[]> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    return db.select().from(artifacts).where(eq(artifacts.caseId, caseId)).orderBy(desc(artifacts.updatedAt));
}

export async function getArtifact(actor: Actor, caseId: string, artifactId: string): Promise<ArtifactRow> {
    await requireCaseAccess(actor, caseId);
    const db = await getDb();
    const rows = await db.select().from(artifacts).where(and(eq(artifacts.id, artifactId), eq(artifacts.caseId, caseId))).limit(1);
    if (!rows[0]) throw new ValidationError("Document not found.");
    return rows[0];
}

/** Exactly what a user may change about a generated document. Everything else is rejected. */
export const EditArtifactInput = z
    .object({
        content: z.string().max(200_000, "The document is too long.").optional(),
        title: z.string().trim().min(1).max(200).optional(),
        status: z.enum(["draft", "final"]).optional(),
    })
    .strict();

export type EditArtifactInput = z.infer<typeof EditArtifactInput>;

/**
 * Edit wording. Never touches facts. The patch is validated before any
 * database access; `caseId`, `generatedBy`, `basis`, `stale` and every other
 * column are not editable and their presence rejects the whole request. The
 * update is keyed by (id, caseId) so it can never move a row between cases.
 * The first content edit keeps the generated original in `generatedContent`.
 */
export async function editArtifact(actor: Actor, caseId: string, artifactId: string, patch: unknown): Promise<ArtifactRow> {
    const parsed = EditArtifactInput.safeParse(patch);
    if (!parsed.success) {
        const unknownKeys = parsed.error.issues.filter((i) => i.code === "unrecognized_keys").flatMap((i) => ("keys" in i ? (i.keys as string[]) : []));
        const message = unknownKeys.length ? `These fields cannot be edited: ${unknownKeys.join(", ")}.` : "The edit is not valid.";
        throw new ValidationError(message, { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    const update = parsed.data;
    const fields = Object.keys(update);
    if (fields.length === 0) throw new ValidationError("Nothing to change.");

    const current = await getArtifact(actor, caseId, artifactId);
    const now = new Date();
    const set: Partial<typeof artifacts.$inferInsert> = { ...update, updatedAt: now };
    if (update.content !== undefined && update.content !== current.content) {
        if (current.userEditedAt === null) set.userEditedAt = now;
        if (current.generatedContent === null) set.generatedContent = current.content;
    }
    const db = await getDb();
    await db.update(artifacts).set(set).where(and(eq(artifacts.id, artifactId), eq(artifacts.caseId, caseId)));
    await touchCase(caseId);
    await recordAudit({ userId: actor.userId, caseId, action: "artifact.edited", targetType: "artifact", targetId: artifactId, details: { fields } });
    return getArtifact(actor, caseId, artifactId);
}

export async function deleteArtifact(actor: Actor, caseId: string, artifactId: string): Promise<void> {
    await getArtifact(actor, caseId, artifactId);
    const db = await getDb();
    await db.delete(artifacts).where(and(eq(artifacts.id, artifactId), eq(artifacts.caseId, caseId)));
}

/** Recompute staleness by comparing the stored inputs hash with the current basis. */
export async function refreshArtifactStaleness(actor: Actor, caseId: string): Promise<void> {
    const { basis } = await gatherBasis(actor, caseId);
    const db = await getDb();
    const rows = await db.select().from(artifacts).where(eq(artifacts.caseId, caseId));
    for (const r of rows) {
        if (r.type === "chronology" || r.type === "case_summary") {
            const stale = r.basis.inputsHash !== basis.inputsHash;
            if (stale !== r.stale) await db.update(artifacts).set({ stale, staleReason: stale ? "the case record changed since this was generated" : null }).where(and(eq(artifacts.id, r.id), eq(artifacts.caseId, caseId)));
        }
    }
}
