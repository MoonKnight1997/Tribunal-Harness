/**
 * coffeecup — relational schema (Drizzle ORM, PostgreSQL dialect).
 *
 * The authoritative case record lives here. Chat, model output and generated
 * wording are never authoritative: they are inputs to, or derived from, these
 * tables.
 *
 * Conventions
 * - Primary keys are application-generated UUID strings (crypto.randomUUID) so
 *   the same code runs on PGlite (dev/test) and hosted Postgres (production).
 * - Legal dates (dismissal date, Acas Day A/B, deadlines) are `date` columns
 *   stored as ISO YYYY-MM-DD strings. Never store a legal date as a timestamp:
 *   timezone shifts cause off-by-one errors that are legal-safety failures.
 * - Every case-scoped table carries `caseId`, and every query goes through the
 *   tenancy guard in src/cases/access.ts.
 * - JSON columns are typed with `$type<>()` so the shape is checked at compile
 *   time, but they are still validated with Zod on the way in.
 */

import {
    pgTable,
    text,
    timestamp,
    date,
    boolean,
    integer,
    jsonb,
    index,
    uniqueIndex,
    foreignKey,
    primaryKey,
    customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Shared enums live in ./enums (pure TypeScript, safe to import from client components).
import type {
    Jurisdiction, CaseStage, CaseStatus, EntryRoute, EmploymentStatus, Provenance, EventStatus, EventCategory,
    DocumentType, ExtractionStatus, ProcessType, JobStatus, ArtifactType, EntitlementTier, EntitlementStatus, ClaimElementStatus, AppealGroundCategory,
} from "./enums";
export * from "./enums";

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const isoDate = (name: string) => date(name, { mode: "string" });

/** bytea for document bodies stored in the database storage adapter. */
export const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
    dataType() {
        return "bytea";
    },
    toDriver(value: Buffer) {
        return value;
    },
    fromDriver(value: Buffer | Uint8Array) {
        return Buffer.isBuffer(value) ? value : Buffer.from(value);
    },
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
    "users",
    {
        id: id(),
        email: text("email").notNull(),
        emailVerifiedAt: ts("email_verified_at"),
        passwordHash: text("password_hash").notNull(),
        displayName: text("display_name"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
        deletedAt: ts("deleted_at"),
    },
    (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const consents = pgTable(
    "consents",
    {
        id: id(),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        /** e.g. "terms", "privacy", "special_category_data" */
        kind: text("kind").notNull(),
        version: text("version").notNull(),
        grantedAt: ts("granted_at").notNull().defaultNow(),
        withdrawnAt: ts("withdrawn_at"),
    },
    (t) => [index("consents_user_idx").on(t.userId)],
);

export const sessions = pgTable(
    "sessions",
    {
        id: id(),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        /** SHA-256 of the cookie token. The raw token is never stored. */
        tokenHash: text("token_hash").notNull(),
        expiresAt: ts("expires_at").notNull(),
        createdAt: createdAt(),
        lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    },
    (t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const recoveryTokens = pgTable(
    "recovery_tokens",
    {
        id: id(),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        tokenHash: text("token_hash").notNull(),
        expiresAt: ts("expires_at").notNull(),
        usedAt: ts("used_at"),
        createdAt: createdAt(),
    },
    (t) => [uniqueIndex("recovery_token_idx").on(t.tokenHash)],
);

// ---------------------------------------------------------------------------
// Case core
// ---------------------------------------------------------------------------

export interface IntakeAnswers {
    situationDescription?: string;
    stillEmployed?: boolean;
    keyDates?: Record<string, string>;
    currentProceduralStage?: string;
    urgencyNotes?: string;
    inferredRoutes?: EntryRoute[];
}

/**
 * How precisely a legal date is known. Carried with every structured date so
 * an approximate date can never turn into an exact-looking deadline.
 */
export type DatePrecision = "exact" | "approximate" | "month" | "year";

export const cases = pgTable(
    "cases",
    {
        id: id(),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        title: text("title").notNull(),
        jurisdiction: text("jurisdiction").$type<Jurisdiction>().notNull().default("england_wales"),
        stage: text("stage").$type<CaseStage>().notNull().default("understanding"),
        status: text("status").$type<CaseStatus>().notNull().default("active"),
        entryRoute: text("entry_route").$type<EntryRoute>().notNull().default("not_sure"),
        intake: jsonb("intake").$type<IntakeAnswers>().notNull().default({}),
        /** Plain-language summary of "what is happening", confirmed by the user. */
        situationSummary: text("situation_summary"),
        summaryStale: boolean("summary_stale").notNull().default(false),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
        lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
        deletedAt: ts("deleted_at"),
    },
    (t) => [index("cases_user_idx").on(t.userId)],
);

export const employmentRelationships = pgTable("employment_relationships", {
    id: id(),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }).unique(),
    employerName: text("employer_name"),
    respondentLegalEntity: text("respondent_legal_entity"),
    respondentAddress: text("respondent_address"),
    jobTitle: text("job_title"),
    employmentStatus: text("employment_status").$type<EmploymentStatus>(),
    startDate: isoDate("start_date"),
    startDatePrecision: text("start_date_precision").$type<DatePrecision>().notNull().default("exact"),
    endDate: isoDate("end_date"),
    endDatePrecision: text("end_date_precision").$type<DatePrecision>().notNull().default("exact"),
    stillEmployed: boolean("still_employed"),
    payAmount: text("pay_amount"),
    payPeriod: text("pay_period"),
    hoursPerWeek: text("hours_per_week"),
    workplace: text("workplace"),
    contractualDetails: jsonb("contractual_details").$type<Record<string, string>>().notNull().default({}),
    updatedAt: updatedAt(),
});

export const persons = pgTable(
    "persons",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        /** manager | hr | witness | representative | colleague | conciliator | other */
        role: text("role").notNull().default("other"),
        organisation: text("organisation"),
        notes: text("notes"),
        createdAt: createdAt(),
    },
    (t) => [index("persons_case_idx").on(t.caseId)],
);

export const events = pgTable(
    "events",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        date: isoDate("date").notNull(),
        dateEnd: isoDate("date_end"),
        dateApproximate: boolean("date_approximate").notNull().default(false),
        title: text("title").notNull(),
        description: text("description"),
        category: text("category").$type<EventCategory>().notNull().default("other"),
        actorIds: jsonb("actor_ids").$type<string[]>().notNull().default([]),
        sourceDocumentIds: jsonb("source_document_ids").$type<string[]>().notNull().default([]),
        status: text("status").$type<EventStatus>().notNull().default("confirmed"),
        userConfirmed: boolean("user_confirmed").notNull().default(false),
        /** 0–1 confidence for extracted events; null for manual entries. */
        confidence: integer("confidence_pct"),
        disputed: boolean("disputed").notNull().default(false),
        provenance: text("provenance").$type<Provenance>().notNull().default("USER_CONFIRMED"),
        proposedByJobId: text("proposed_by_job_id"),
        mergedIntoId: text("merged_into_id"),
        /** Verbatim passage the proposal was drawn from, and where it sits in the source text. */
        sourceQuote: text("source_quote"),
        sourceLocation: jsonb("source_location").$type<SourceLocation | null>(),
        /** True only when the quote was found verbatim (whitespace-normalised) in the extracted text. */
        quoteVerified: boolean("quote_verified"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [index("events_case_idx").on(t.caseId), index("events_case_date_idx").on(t.caseId, t.date)],
);

/** Where in a source document a proposal came from. Offsets are into the extracted text. */
export interface SourceLocation {
    documentId?: string;
    /** 1-based page where known (PDF/OCR); null for plain text/email. */
    page?: number | null;
    /** Character offsets into the extracted text representation. */
    startOffset?: number;
    endOffset?: number;
    /** Chunk index when the document was processed in windows. */
    chunk?: number;
}

export const issues = pgTable(
    "issues",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        title: text("title").notNull(),
        description: text("description"),
        /** Free category from the intake route taxonomy, e.g. "discrimination", "pay". */
        category: text("category").notNull().default("other"),
        status: text("status").notNull().default("open"),
        desiredResolution: text("desired_resolution"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [index("issues_case_idx").on(t.caseId)],
);

export const facts = pgTable(
    "facts",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        statement: text("statement").notNull(),
        provenance: text("provenance").$type<Provenance>().notNull().default("USER_ALLEGATION"),
        /** proposed | confirmed | rejected | superseded */
        status: text("status").notNull().default("proposed"),
        disputed: boolean("disputed").notNull().default(false),
        confidence: integer("confidence_pct"),
        /** Optional key for structured facts, e.g. "dismissal_date", "employment_start". */
        key: text("key"),
        value: text("value"),
        /** Precision of a structured date value. Never defaults an approximate date to exact. */
        valuePrecision: text("value_precision").$type<DatePrecision>().notNull().default("exact"),
        sourceDocumentId: text("source_document_id"),
        sourceEventId: text("source_event_id"),
        issueId: text("issue_id"),
        supersededById: text("superseded_by_id"),
        sourceQuote: text("source_quote"),
        sourceLocation: jsonb("source_location").$type<SourceLocation | null>(),
        quoteVerified: boolean("quote_verified"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [index("facts_case_idx").on(t.caseId), index("facts_case_key_idx").on(t.caseId, t.key)],
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documents = pgTable(
    "documents",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        filename: text("filename").notNull(),
        mimeType: text("mime_type").notNull(),
        sizeBytes: integer("size_bytes").notNull(),
        /** Key in the object-storage adapter. Never a public URL. */
        storageKey: text("storage_key").notNull(),
        sha256: text("sha256").notNull(),
        docType: text("doc_type").$type<DocumentType>().notNull().default("unknown"),
        docTypeConfirmed: boolean("doc_type_confirmed").notNull().default(false),
        docDate: isoDate("doc_date"),
        author: text("author"),
        recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
        extractedText: text("extracted_text"),
        extractionStatus: text("extraction_status").$type<ExtractionStatus>().notNull().default("queued"),
        extractionError: text("extraction_error"),
        /** Coverage manifest and item-level diagnostics from the last extraction run. */
        extractionReport: jsonb("extraction_report").$type<ExtractionReport | null>(),
        pageCount: integer("page_count"),
        /** Process (e.g. disciplinary) the document belongs to; preserved across reprocessing. Validated against caseId. */
        processId: text("process_id"),
        /** Optional user description, e.g. "Letter inviting me to the hearing". */
        userDescription: text("user_description"),
        uploadedAt: createdAt(),
        updatedAt: updatedAt(),
        deletedAt: ts("deleted_at"),
    },
    (t) => [index("documents_case_idx").on(t.caseId), uniqueIndex("documents_id_case_idx").on(t.id, t.caseId)],
);

/**
 * What an extraction run actually covered and what it could not use. Written
 * by the extraction job so "completed" is never claimed for a partially
 * processed document.
 */
export interface ExtractionReport {
    /** Text-layer / email-part / OCR coverage. */
    coverage: {
        totalChars: number;
        charsSent: number;
        chunks: number;
        chunksSucceeded: number;
        truncated: boolean;
        /** For emails: which MIME parts were read and which were skipped. */
        parts?: Array<{ kind: string; contentType: string; read: boolean; note?: string }>;
        /** For OCR: per-page quality signal. */
        pages?: Array<{ page: number; chars: number; confidence?: number | null }>;
    };
    /** Items the model returned that could not be used, with the reason. */
    diagnostics: Array<{ chunk: number; kind: "event" | "fact" | "allegation" | "document"; index: number; problem: string }>;
    counts: { events: number; facts: number; allegations: number; duplicatesSkipped: number; quotesUnverified: number };
    /** "text" | "eml" | "ocr" etc. */
    method: string;
    /** Extraction task/prompt identity for reproducibility. */
    task: string;
    provider?: string;
    model?: string;
    attachments?: Array<{ filename: string | null; contentType: string; sizeBytes: number | null }>;
    completedAt: string;
}

/** Raw file bodies for the database storage adapter (default). */
export const documentBlobs = pgTable("document_blobs", {
    storageKey: text("storage_key").primaryKey(),
    caseId: text("case_id").notNull(),
    body: bytea("body").notNull(),
    createdAt: createdAt(),
});

export const documentLinks = pgTable(
    "document_links",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
        /** event | issue | fact | allegation | process */
        targetType: text("target_type").notNull(),
        targetId: text("target_id").notNull(),
        note: text("note"),
        createdAt: createdAt(),
    },
    (t) => [
        index("document_links_doc_idx").on(t.documentId),
        index("document_links_target_idx").on(t.targetType, t.targetId),
        // A link can only point at a document in the same case.
        foreignKey({ name: "document_links_doc_case_fk", columns: [t.documentId, t.caseId], foreignColumns: [documents.id, documents.caseId] }).onDelete("cascade"),
    ],
);

// ---------------------------------------------------------------------------
// Processes (grievance, disciplinary, appeal, Acas)
// ---------------------------------------------------------------------------

export interface AcasProcessData {
    /** Day A: the date Acas received the early conciliation notification. */
    notificationDate?: string;
    reference?: string;
    conciliatorName?: string;
    conciliatorContact?: string;
    certificateStatus?: "not_started" | "in_progress" | "issued" | "not_required";
    /**
     * Date printed on / sent with the certificate. Historically this field was
     * the only certificate date and was mirrored to `acas_day_b`. It is NOT a
     * verified receipt date: Day B under ERA 1996 s207B(2) is the day the
     * worker receives (or is treated as receiving) the certificate.
     */
    certificateIssueDate?: string;
    /** Date the worker actually received the certificate, if known. */
    certificateReceivedDate?: string;
    /** How the certificate was sent; drives deemed receipt. */
    certificateDeliveryMethod?: "email" | "post" | "unknown";
    certificateNumber?: string;
    communications?: Array<{ date: string; direction: "from_acas" | "to_acas" | "employer"; summary: string }>;
    offers?: Array<{ date: string; from: "worker" | "employer"; amount?: string; terms: string; status: "open" | "accepted" | "rejected" | "withdrawn" }>;
    preparation?: {
        keyIssues?: string[];
        stepsTaken?: string[];
        moneyIssues?: string;
        desiredResolution?: string;
        questionsToClarify?: string[];
        importantDocumentIds?: string[];
    };
}

export interface GrievanceProcessData {
    issueIds?: string[];
    supportingEventIds?: string[];
    supportingDocumentIds?: string[];
    desiredResolution?: string;
    submittedDate?: string;
    meetingDate?: string;
    outcomeDate?: string;
    employerResponseSummary?: string;
    outcomeAnalysis?: OutcomeAnalysis;
    appealGroundIds?: string[];
}

export interface DisciplinaryProcessData {
    investigationStartDate?: string;
    hearingDate?: string;
    outcomeDate?: string;
    outcome?: string;
    outcomeSanction?: "none" | "warning" | "final_warning" | "dismissal" | "other";
    outcomeAnalysis?: OutcomeAnalysis;
    hearingQuestions?: string[];
    appealGroundIds?: string[];
}

export interface OutcomeAnalysis {
    findingsSummary?: string;
    pointsAgreed?: string[];
    pointsDisputed?: string[];
    evidenceNotConsidered?: string[];
    proceduralConcerns?: string[];
}

export type ProcessData = AcasProcessData | GrievanceProcessData | DisciplinaryProcessData | Record<string, unknown>;

export const processes = pgTable(
    "processes",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        type: text("type").$type<ProcessType>().notNull(),
        state: text("state").notNull(),
        data: jsonb("data").$type<ProcessData>().notNull().default({}),
        parentProcessId: text("parent_process_id"),
        /** The Acas Code version applicable to this process, chosen by its start date. */
        acasCodeVersion: text("acas_code_version"),
        startedAt: ts("started_at").notNull().defaultNow(),
        updatedAt: updatedAt(),
        closedAt: ts("closed_at"),
    },
    // (id, case_id) is unique so child tables can reference the pair and the
    // database itself refuses a child row whose case differs from its process.
    (t) => [index("processes_case_idx").on(t.caseId), uniqueIndex("processes_id_case_idx").on(t.id, t.caseId)],
);

export const processTransitions = pgTable(
    "process_transitions",
    {
        id: id(),
        processId: text("process_id").notNull().references(() => processes.id, { onDelete: "cascade" }),
        fromState: text("from_state"),
        toState: text("to_state").notNull(),
        note: text("note"),
        occurredAt: ts("occurred_at").notNull().defaultNow(),
    },
    (t) => [index("process_transitions_proc_idx").on(t.processId)],
);

export const allegations = pgTable(
    "allegations",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        processId: text("process_id").notNull().references(() => processes.id, { onDelete: "cascade" }),
        employerAllegation: text("employer_allegation").notNull(),
        employerEvidence: text("employer_evidence"),
        workerResponse: text("worker_response"),
        workerEvidence: text("worker_evidence"),
        missingInformation: text("missing_information"),
        proceduralEventIds: jsonb("procedural_event_ids").$type<string[]>().notNull().default([]),
        hearingQuestions: jsonb("hearing_questions").$type<string[]>().notNull().default([]),
        sourceDocumentId: text("source_document_id"),
        sourceQuote: text("source_quote"),
        sourceLocation: jsonb("source_location").$type<SourceLocation | null>(),
        quoteVerified: boolean("quote_verified"),
        proposedByJobId: text("proposed_by_job_id"),
        provenance: text("provenance").$type<Provenance>().notNull().default("EMPLOYER_ALLEGATION"),
        status: text("status").notNull().default("open"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        index("allegations_process_idx").on(t.processId),
        foreignKey({ name: "allegations_process_case_fk", columns: [t.processId, t.caseId], foreignColumns: [processes.id, processes.caseId] }).onDelete("cascade"),
    ],
);


export const appealGrounds = pgTable(
    "appeal_grounds",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        processId: text("process_id").notNull().references(() => processes.id, { onDelete: "cascade" }),
        category: text("category").$type<AppealGroundCategory>().notNull(),
        summary: text("summary").notNull(),
        detail: text("detail"),
        supportingFactIds: jsonb("supporting_fact_ids").$type<string[]>().notNull().default([]),
        supportingDocumentIds: jsonb("supporting_document_ids").$type<string[]>().notNull().default([]),
        selected: boolean("selected").notNull().default(true),
        createdAt: createdAt(),
    },
    (t) => [
        index("appeal_grounds_process_idx").on(t.processId),
        foreignKey({ name: "appeal_grounds_process_case_fk", columns: [t.processId, t.caseId], foreignColumns: [processes.id, processes.caseId] }).onDelete("cascade"),
    ],
);

// ---------------------------------------------------------------------------
// Deadlines, tasks, artifacts
// ---------------------------------------------------------------------------

/** Where a deadline's trigger date came from and how much it can be trusted. */
export interface DeadlineTrigger {
    date: string | null;
    precision: DatePrecision | null;
    /** e.g. "structured_fact:dismissal_date", "employment.end_date", "acas.notification_date". */
    source: string | null;
    /** True when the value was entered or confirmed by the user (not merely proposed). */
    confirmed: boolean;
    /** Distinct competing values recorded for the same trigger, if any. */
    conflictingValues?: string[];
}

/** How Acas Day B was derived. */
export interface AcasBasis {
    dayA: string | null;
    dayB: string | null;
    /** "received" = user-entered receipt date; "issue_date_assumed" = only the issue date is known (conservative); "deemed_received" = derived from delivery method. */
    dayBBasis: "received" | "issue_date_assumed" | "deemed_received" | "pending" | "none";
    note: string | null;
}

export interface DeadlineExplanation {
    triggerDate: string | null;
    triggerDescription: string;
    trigger?: DeadlineTrigger;
    assumptions: string[];
    acasEffect: string | null;
    acas?: AcasBasis;
    source: { title: string; reference: string; url?: string; version: string };
    warnings: string[];
    missingInformation: string[];
    secondary?: { label: string; date: string; note: string } | null;
    /**
     * When conciliation is pending (Day A known, Day B not), the date the
     * limit would have expired WITHOUT Acas. Background only: the real
     * deadline will be no earlier than this, and cannot be calculated yet.
     */
    unadjusted?: { date: string; note: string } | null;
}

export const deadlines = pgTable(
    "deadlines",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        /** e.g. "et_claim_time_limit", "grievance_appeal_window", "acas_certificate_follow_up" */
        kind: text("kind").notNull(),
        label: text("label").notNull(),
        /** Null when the engine could not calculate a definitive date. */
        calculatedDate: isoDate("calculated_date"),
        ruleId: text("rule_id").notNull(),
        ruleVersion: text("rule_version").notNull(),
        explanation: jsonb("explanation").$type<DeadlineExplanation>().notNull(),
        /**
         * calculated | uncertain | pending_acas | stale | expired.
         * "expired" is a presentation state derived from today's date on read;
         * the stored value is what was true at computedAt.
         */
        status: text("status").$type<DeadlineStatus>().notNull().default("calculated"),
        /** The date the rows were computed for; a different "today" means urgency/expiry must be re-derived. */
        computedForDate: isoDate("computed_for_date"),
        computedAt: ts("computed_at").notNull().defaultNow(),
    },
    (t) => [index("deadlines_case_idx").on(t.caseId)],
);

export type DeadlineStatus = "calculated" | "uncertain" | "pending_acas" | "stale" | "expired";

export const tasks = pgTable(
    "tasks",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        title: text("title").notNull(),
        description: text("description"),
        /** procedural | evidence | preparation | deadline | information */
        kind: text("kind").notNull().default("information"),
        dueDate: isoDate("due_date"),
        status: text("status").notNull().default("open"),
        /** Stable key so system-generated tasks are not duplicated on refresh. */
        systemKey: text("system_key"),
        /** Why the system suggests this (shown to the user); null for user-created tasks. */
        reason: text("reason"),
        /** Higher runs first on the dashboard. Derived at write time from urgency and dependency. */
        priority: integer("priority").notNull().default(0),
        createdAt: createdAt(),
        completedAt: ts("completed_at"),
        /** open | done | dismissed | obsolete. Obsolete = the system withdrew it after a correction. */
        dismissedAt: ts("dismissed_at"),
    },
    (t) => [index("tasks_case_idx").on(t.caseId), uniqueIndex("tasks_case_system_key_idx").on(t.caseId, t.systemKey)],
);

export interface ArtifactBasis {
    factIds: string[];
    eventIds: string[];
    documentIds: string[];
    processId?: string;
    /** Hash of the inputs at generation time, used for staleness detection. */
    inputsHash: string;
}

/**
 * Exactly what a generated document was produced from. Persisted so a draft
 * can always be traced to its task, prompt version, model and the rule and
 * source versions in force when it was written.
 */
export interface ArtifactGeneration {
    task: string;
    promptVersion: string;
    provider: string;
    model: string;
    /** sha256 (truncated) of the full payload sent to the model, including any supplementary input. */
    payloadHash: string;
    /** Keys of supplementary (non-authoritative) input the caller supplied, if any. */
    supplementaryKeys: string[];
    /** Rule ids/versions and legal source versions cited or applied. */
    ruleVersions: Array<{ id: string; version: string }>;
    sourceVersions: Array<{ key: string; version: string }>;
    generatedAt: string;
}

/** A deterministic post-generation check that found something the reader should verify. */
export interface ArtifactReviewFlag {
    kind: "unsupported_date" | "unsupported_name" | "unsupported_quote" | "percentage" | "strength_assertion" | "fabricated_source" | "other";
    excerpt: string;
    note: string;
}

export const artifacts = pgTable(
    "artifacts",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        type: text("type").$type<ArtifactType>().notNull(),
        title: text("title").notNull(),
        /** Markdown body. Editable by the user; edits never change case facts. */
        content: text("content").notNull(),
        version: integer("version").notNull().default(1),
        /** draft | final */
        status: text("status").notNull().default("draft"),
        stale: boolean("stale").notNull().default(false),
        staleReason: text("stale_reason"),
        basis: jsonb("basis").$type<ArtifactBasis>().notNull(),
        generation: jsonb("generation").$type<ArtifactGeneration | null>(),
        reviewFlags: jsonb("review_flags").$type<ArtifactReviewFlag[]>().notNull().default([]),
        /** Set when the user has edited the generated wording; the generated original is kept in `generatedContent`. */
        userEditedAt: ts("user_edited_at"),
        generatedContent: text("generated_content"),
        processId: text("process_id"),
        generatedBy: text("generated_by").notNull().default("system"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [index("artifacts_case_idx").on(t.caseId)],
);

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export interface ClaimTimeLimitInfo {
    deadlineId?: string;
    calculatedDate: string | null;
    summary: string;
}

export interface ClaimSourceRef {
    key: string;
    title: string;
    reference: string;
    url?: string;
    version: string;
}

export const claimCandidates = pgTable(
    "claim_candidates",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        claimType: text("claim_type").notNull(),
        label: text("label").notNull(),
        triggeredBy: jsonb("triggered_by").$type<string[]>().notNull().default([]),
        supportingFactIds: jsonb("supporting_fact_ids").$type<string[]>().notNull().default([]),
        contraryFactIds: jsonb("contrary_fact_ids").$type<string[]>().notNull().default([]),
        relevantDocumentIds: jsonb("relevant_document_ids").$type<string[]>().notNull().default([]),
        missingFacts: jsonb("missing_facts").$type<string[]>().notNull().default([]),
        timeLimit: jsonb("time_limit").$type<ClaimTimeLimitInfo | null>(),
        acasStatus: text("acas_status").notNull().default("unknown"),
        sources: jsonb("sources").$type<ClaimSourceRef[]>().notNull().default([]),
        uncertainties: jsonb("uncertainties").$type<string[]>().notNull().default([]),
        alternatives: jsonb("alternatives").$type<string[]>().notNull().default([]),
        reviewerResult: jsonb("reviewer_result").$type<Record<string, unknown> | null>(),
        stale: boolean("stale").notNull().default(false),
        staleReason: text("stale_reason"),
        inputsHash: text("inputs_hash").notNull(),
        generatedAt: ts("generated_at").notNull().defaultNow(),
    },
    (t) => [index("claim_candidates_case_idx").on(t.caseId), uniqueIndex("claim_candidates_id_case_idx").on(t.id, t.caseId)],
);

export const claimElements = pgTable(
    "claim_elements",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        claimCandidateId: text("claim_candidate_id").notNull().references(() => claimCandidates.id, { onDelete: "cascade" }),
        elementKey: text("element_key").notNull(),
        label: text("label").notNull(),
        status: text("status").$type<ClaimElementStatus>().notNull(),
        reasoning: text("reasoning").notNull(),
        supportingFactIds: jsonb("supporting_fact_ids").$type<string[]>().notNull().default([]),
        contraryFactIds: jsonb("contrary_fact_ids").$type<string[]>().notNull().default([]),
        missingInformation: jsonb("missing_information").$type<string[]>().notNull().default([]),
        sourceKeys: jsonb("source_keys").$type<string[]>().notNull().default([]),
        order: integer("sort_order").notNull().default(0),
    },
    (t) => [
        index("claim_elements_candidate_idx").on(t.claimCandidateId),
        // An element can only belong to a candidate in the same case.
        foreignKey({ name: "claim_elements_candidate_case_fk", columns: [t.claimCandidateId, t.caseId], foreignColumns: [claimCandidates.id, claimCandidates.caseId] }).onDelete("cascade"),
    ],
);

export const evidenceLinks = pgTable(
    "evidence_links",
    {
        id: id(),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        factId: text("fact_id"),
        claimElementId: text("claim_element_id"),
        documentId: text("document_id"),
        eventId: text("event_id"),
        note: text("note"),
        createdAt: createdAt(),
    },
    (t) => [index("evidence_links_case_idx").on(t.caseId)],
);

// ---------------------------------------------------------------------------
// Background jobs, audit, analytics
// ---------------------------------------------------------------------------

export const jobs = pgTable(
    "jobs",
    {
        id: id(),
        caseId: text("case_id"),
        userId: text("user_id"),
        type: text("type").notNull(),
        status: text("status").$type<JobStatus>().notNull().default("queued"),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
        result: jsonb("result").$type<Record<string, unknown> | null>(),
        error: text("error"),
        attempts: integer("attempts").notNull().default(0),
        maxAttempts: integer("max_attempts").notNull().default(3),
        /**
         * Lease: a processing job whose lease has expired was abandoned (worker
         * died) and may be reclaimed by another worker.
         */
        leaseExpiresAt: ts("lease_expires_at"),
        lockedBy: text("locked_by"),
        /** Earliest time the job may (re)run — set with exponential backoff after a failure. */
        nextRunAt: ts("next_run_at"),
        cancelledAt: ts("cancelled_at"),
        /** Optional caller-supplied key so the same logical job is not enqueued twice. */
        idempotencyKey: text("idempotency_key"),
        createdAt: createdAt(),
        startedAt: ts("started_at"),
        finishedAt: ts("finished_at"),
    },
    (t) => [
        index("jobs_status_idx").on(t.status),
        index("jobs_case_idx").on(t.caseId),
        uniqueIndex("jobs_idempotency_idx").on(t.idempotencyKey).where(sql`idempotency_key is not null`),
    ],
);

export const auditEvents = pgTable(
    "audit_events",
    {
        id: id(),
        userId: text("user_id"),
        caseId: text("case_id"),
        action: text("action").notNull(),
        targetType: text("target_type"),
        targetId: text("target_id"),
        /** Redacted structured detail. Never raw document or narrative text. */
        details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
        createdAt: createdAt(),
    },
    (t) => [index("audit_case_idx").on(t.caseId), index("audit_user_idx").on(t.userId)],
);

export const analyticsEvents = pgTable(
    "analytics_events",
    {
        id: id(),
        name: text("name").notNull(),
        /** Salted hash of the user id; never the raw id or email. */
        subject: text("subject"),
        props: jsonb("props").$type<Record<string, string | number | boolean>>().notNull().default({}),
        createdAt: createdAt(),
    },
    (t) => [index("analytics_name_idx").on(t.name)],
);

// ---------------------------------------------------------------------------
// Commerce
// ---------------------------------------------------------------------------

export const entitlements = pgTable(
    "entitlements",
    {
        id: id(),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
        tier: text("tier").$type<EntitlementTier>().notNull(),
        status: text("status").$type<EntitlementStatus>().notNull().default("active"),
        /** "stripe" | "mock" | "manual" */
        source: text("source").notNull(),
        /** Provider reference (e.g. checkout session id). Not a secret. One entitlement per purchase. */
        paymentRef: text("payment_ref"),
        grantedAt: ts("granted_at").notNull().defaultNow(),
        revokedAt: ts("revoked_at"),
        revokedReason: text("revoked_reason"),
    },
    (t) => [
        index("entitlements_case_idx").on(t.caseId),
        index("entitlements_user_idx").on(t.userId),
        // A purchase grants at most one entitlement, however many times its webhook is delivered.
        uniqueIndex("entitlements_payment_ref_idx").on(t.paymentRef).where(sql`payment_ref is not null`),
    ],
);

/**
 * Every webhook delivery, with receipt recorded separately from successful
 * processing. A row with processedAt = null is a delivery that was received
 * but not (yet) applied and may be retried; only a processed row is a
 * duplicate.
 */
export const paymentEvents = pgTable(
    "payment_events",
    {
        id: id(),
        provider: text("provider").notNull(),
        providerEventId: text("provider_event_id").notNull(),
        type: text("type").notNull(),
        /** Provider purchase reference the event relates to (checkout session id), for reconciliation across events. */
        paymentRef: text("payment_ref"),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
        receivedAt: createdAt(),
        processedAt: ts("processed_at"),
        /** received | processed | failed */
        processingStatus: text("processing_status").notNull().default("received"),
        attempts: integer("attempts").notNull().default(0),
        lastError: text("last_error"),
        outcome: text("outcome"),
    },
    (t) => [uniqueIndex("payment_events_provider_event_idx").on(t.provider, t.providerEventId), index("payment_events_ref_idx").on(t.paymentRef)],
);

/**
 * Shared fixed-window rate limiter state, so limits hold across instances.
 * Rows are upserted atomically (INSERT … ON CONFLICT DO UPDATE) and old
 * windows are pruned opportunistically.
 */
export const rateLimits = pgTable(
    "rate_limits",
    {
        /** e.g. "triage:ip:203.0.113.4" or "ai:user:<id>" */
        key: text("key").notNull(),
        windowStart: ts("window_start").notNull(),
        count: integer("count").notNull().default(0),
    },
    (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const usageCounters = pgTable(
    "usage_counters",
    {
        id: id(),
        userId: text("user_id").notNull(),
        caseId: text("case_id"),
        /** e.g. "ai_generation", "document_extraction" */
        kind: text("kind").notNull(),
        periodStart: isoDate("period_start").notNull(),
        count: integer("count").notNull().default(0),
    },
    (t) => [uniqueIndex("usage_counter_idx").on(t.userId, t.caseId, t.kind, t.periodStart)],
);
