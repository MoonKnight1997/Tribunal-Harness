# Data model

Schema: `src/db/schema.ts` (Drizzle, PostgreSQL). Enums: `src/db/enums.ts`.
Migrations: `drizzle/*.sql`, generated with `npm run db:generate`.

All ids are application-generated UUID strings. Legal dates are `date`
columns stored as `YYYY-MM-DD` strings; never timestamps.

## Identity

| Table | Purpose |
|---|---|
| `users` | email (unique), scrypt password hash, display name, soft delete |
| `consents` | terms / privacy / special-category consent, versioned |
| `sessions` | SHA-256 of the session token, expiry, last seen |
| `recovery_tokens` | SHA-256 of the one-time reset token, expiry, used-at |

## Case core

| Table | Purpose |
|---|---|
| `cases` | owner, title, jurisdiction, stage, status, entry route, intake answers, confirmed situation summary (+ stale flag) |
| `employment_relationships` | employer, respondent legal entity/address, job title, status, start/end dates, pay, hours, workplace, contractual details |
| `persons` | managers, HR, witnesses, representatives, conciliators |
| `events` | date/date-end, approximate flag, title, description, category, actors, source documents, status (proposed/confirmed/rejected), user-confirmed, confidence, disputed, provenance, merged-into |
| `issues` | what the worker says occurred, category, desired resolution |
| `facts` | statement, provenance, status (proposed/confirmed/rejected/superseded), disputed, confidence, optional structured key/value, sources, superseded-by |

Structured fact keys the engines read: `employment_start`, `employment_end`,
`dismissal_date`, `effective_date_of_termination`, `date_of_last_act`,
`date_of_deduction`, `acas_day_a`, `acas_day_b`, plus process dates. Each
carries `value_precision` (`exact` / `approximate` / `month` / `year`). The
deadline engine reads one confirmed value per key; two confirmed rows with
different values are a conflict the user must resolve, never a recency pick.
Triggers are never substituted between claim families: discrimination and
whistleblowing use `date_of_last_act` only, unlawful deductions
`date_of_deduction` only, dismissal-based claims the EDT chain
(`effective_date_of_termination` → `dismissal_date` → employment end date when
employment has ended).

Acas process data (`processes.data`, type `acas_early_conciliation`):
`notificationDate` is Day A; `certificateIssueDate` is the date on the
certificate; `certificateReceivedDate` is Day B when known;
`certificateDeliveryMethod` (`email` / `post` / `unknown`) drives deemed
receipt. `acas_day_b` mirrors the receipt date if given, else the issue date
(conservative; ERA 1996 s207B(2), SI 2014/254 rule 9).

## Provenance

```
USER_CONFIRMED · DOCUMENT_EXTRACTED · DOCUMENT_CONFIRMED · EMPLOYER_ALLEGATION
USER_ALLEGATION · MODEL_INFERENCE · LEGAL_SOURCE · DISPUTED · UNKNOWN
```

Transitions are only made by user action: `DOCUMENT_EXTRACTED → DOCUMENT_CONFIRMED`,
`MODEL_INFERENCE → USER_CONFIRMED`, `USER_ALLEGATION → USER_CONFIRMED`.
A correction supersedes the old row (kept for audit) with a new
`USER_CONFIRMED` row.

## Documents

| Table | Purpose |
|---|---|
| `documents` | metadata, storage key (never a URL), sha256, type (+ confirmed flag), date, author, recipients, extracted text, extraction status/error, user description |
| `document_blobs` | raw bytes for the database storage adapter |
| `document_links` | document ↔ event / issue / fact / allegation / process |

Extraction statuses: `queued`, `processing`, `completed`, `failed`,
`requires_review`, `unsupported`.

## Processes

| Table | Purpose |
|---|---|
| `processes` | type (grievance, disciplinary, grievance_appeal, disciplinary_appeal, acas_early_conciliation, informal), state, structured data, parent, Acas Code version, dates |
| `process_transitions` | every state change |
| `allegations` | employer allegation, employer evidence, worker response, worker evidence, missing information, procedural events, hearing questions, provenance, status |
| `appeal_grounds` | category, summary, detail, supporting facts/documents, selected |

## Legal outputs

| Table | Purpose |
|---|---|
| `deadlines` | kind, label, calculated date (nullable), rule id + version, full explanation (trigger with date/precision/source/confirmed/conflicting values, assumptions, Acas effect, Acas basis for Day A/Day B, source, warnings, missing information, secondary, unadjusted floor while conciliation is pending), status (`calculated` / `uncertain` / `pending_acas` / `stale`; `expired` is derived on read from today's date), computed-for date |
| `claim_candidates` | claim type, triggers, supporting/contrary fact ids, missing facts, time-limit info, Acas status, sources, uncertainties, alternatives, reviewer result, stale, inputs hash |
| `claim_elements` | element key, label, status (supported / potentially_supported / disputed / unsupported_on_current_information / information_missing / not_applicable), reasoning, fact ids, missing information, source keys |
| `evidence_links` | fact / claim element ↔ document / event |

## Generated artefacts, tasks, jobs, audit

| Table | Purpose |
|---|---|
| `artifacts` | type, title, Markdown content (editable), version, status, stale + reason, basis (fact/event/document ids + inputs hash), process |
| `tasks` | user and system tasks (idempotent by `system_key`) |
| `jobs` | queued → processing → completed / failed / requires_review, attempts, payload/result, error |
| `audit_events` | who/what/when with redacted details |
| `analytics_events` | event name, salted subject hash, allow-listed props |

## Commerce

| Table | Purpose |
|---|---|
| `entitlements` | user + case + tier (case_pass / claim_pack), status (active / refunded / revoked / expired), source, payment reference |
| `payment_events` | provider + provider event id (unique), type, payload, outcome |
| `usage_counters` | fair-use counts per user/case/kind/day |

## Legal sources

The source registry and versioned rules are code (`src/legal/sources/registry.ts`,
`src/legal/rules/*`), reviewed through version control. Outputs store the
source key, title, reference, URL and version they used.
