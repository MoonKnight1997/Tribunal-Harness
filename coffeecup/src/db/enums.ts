/**
 * Shared enums for the domain model. Pure TypeScript with no runtime
 * dependencies, so client components can import the option lists without
 * pulling the database layer into the browser bundle. Kept as TS unions +
 * text columns rather than pg enums so adding a value is a code change, not
 * a migration.
 */


export const JURISDICTIONS = ["england_wales", "scotland", "northern_ireland"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const CASE_STAGES = [
    "understanding",
    "informal_resolution",
    "grievance",
    "disciplinary",
    "internal_appeal",
    "acas_early_conciliation",
    "considering_tribunal",
    "et1_preparation",
    "et1_submitted",
    "resolved",
    "closed",
] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export const CASE_STATUSES = ["active", "paused", "resolved", "closed", "deleted"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const ENTRY_ROUTES = [
    "not_sure",
    "problem_at_work",
    "grievance",
    "disciplinary",
    "appeal",
    "dismissal",
    "redundancy",
    "discrimination",
    "disability_adjustments",
    "whistleblowing",
    "pay",
    "contract_change",
    "acas_early_conciliation",
    "acas_certificate_received",
    "considering_tribunal",
    "et1_preparation",
] as const;
export type EntryRoute = (typeof ENTRY_ROUTES)[number];

export const EMPLOYMENT_STATUSES = ["employee", "worker", "self_employed", "agency", "unsure"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

/** Provenance for every material proposition (see PRIVACY_SECURITY.md / DATA_MODEL.md). */
export const PROVENANCES = [
    "USER_CONFIRMED",
    "DOCUMENT_EXTRACTED",
    "DOCUMENT_CONFIRMED",
    "EMPLOYER_ALLEGATION",
    "USER_ALLEGATION",
    "MODEL_INFERENCE",
    "LEGAL_SOURCE",
    "DISPUTED",
    "UNKNOWN",
] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const EVENT_STATUSES = ["proposed", "confirmed", "rejected"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_CATEGORIES = [
    "employment",
    "incident",
    "meeting",
    "communication",
    "grievance",
    "disciplinary",
    "appeal",
    "dismissal",
    "pay",
    "absence",
    "acas",
    "tribunal",
    "medical",
    "other",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const DOCUMENT_TYPES = [
    "contract",
    "payslip",
    "letter",
    "email",
    "message",
    "meeting_notes",
    "grievance",
    "grievance_outcome",
    "disciplinary_invite",
    "disciplinary_outcome",
    "appeal",
    "appeal_outcome",
    "policy",
    "medical",
    "acas_certificate",
    "acas_correspondence",
    "witness_statement",
    "photo",
    "other",
    "unknown",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const EXTRACTION_STATUSES = ["queued", "processing", "completed", "failed", "requires_review", "unsupported"] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const PROCESS_TYPES = ["grievance", "disciplinary", "grievance_appeal", "disciplinary_appeal", "acas_early_conciliation", "informal"] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

export const JOB_STATUSES = ["queued", "processing", "completed", "failed", "requires_review"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ARTIFACT_TYPES = [
    "grievance_letter",
    "grievance_appeal",
    "disciplinary_response",
    "disciplinary_appeal",
    "chronology",
    "case_summary",
    "acas_preparation",
    "meeting_preparation",
    "potential_claims_summary",
    "et1_readiness_pack",
    "case_pack",
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ENTITLEMENT_TIERS = ["case_pass", "claim_pack"] as const;
export type EntitlementTier = (typeof ENTITLEMENT_TIERS)[number];

export const ENTITLEMENT_STATUSES = ["active", "refunded", "revoked", "expired"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const CLAIM_ELEMENT_STATUSES = [
    "supported",
    "potentially_supported",
    "disputed",
    "unsupported_on_current_information",
    "information_missing",
    "not_applicable",
] as const;
export type ClaimElementStatus = (typeof CLAIM_ELEMENT_STATUSES)[number];


export const APPEAL_GROUND_CATEGORIES = [
    "factual_findings_disputed",
    "missing_evidence",
    "evidence_misunderstood",
    "procedural_issue",
    "inconsistency",
    "new_evidence",
    "remedy_outcome_dispute",
] as const;
export type AppealGroundCategory = (typeof APPEAL_GROUND_CATEGORIES)[number];
