# PARITY.md — behaviour contract between the TypeScript app and the Rust port

One row per feature (from the README list) and per route. The **Verified**
column is filled only with evidence produced in this repository (a named test,
a fixture diff, or a captured server response). Status values:
`verified`, `[partial]` (what differs and why), `[blocked]` (what could not be
checked and why), or empty (not yet verified).

## Features

| # | Feature | How it is checked | Verified |
|---|---|---|---|
| F1 | 10 claim-type schemas | `th-core` test `schemas_match_fixture` diffs each schema's serialised JSON against `fixtures/schemas/all-schemas.json`; `GET /api/schema/{id}` for all 10 diffed against `fixtures/routes/responses.json` | |
| F2 | ERA 2025 commencement constants + live tracker | `constants_match_fixture` (ERA_2025, tracker rows incl. `tbc`, TIME_LIMIT_CONFIG, CLAIM_TYPES, FSM_STATES, format helpers, override validation); `GET /api/era-2025/tracker` diff | |
| F3 | Deadline calculator: 3/6-month regime change, bank holidays, ACAS extension | 7 308 add-months cases, 1 856 no-ACAS acts, 2 826 ACAS scenarios, multi/single/invalid cases diffed byte-for-byte (with injected `today`); the 40 ported Vitest cases | |
| F4 | Live TNA lookup; `/api/analyse` VERIFIED only on exact neutral-citation match; curated pre-2003 fallback | offline: 190 `validateCitation` cases, `authoritative.json` decisions (curated short-circuit, unavailable fallback, FMX guard), `verify.json`, `search.json`, `parse.json`; live: `RUN_LIVE_CASELAW=1` opt-in test | |
| F5 | Three-agent debate with 100-point rubric | `/api/debate` agent-mode responses (single pass + adversarial, all 10 claim types in fixtures) diffed; score clamping, viability, usage totals, fallback keys; ported Vitest cases with a scripted LLM | |
| F6 | Triage/analysis model routing + graceful degradation without key | `ENDPOINT_CONFIG` diff; `/api/analyse` and `/api/triage` degraded bodies for all claim types diffed; `isClientAvailable` semantics; `callClaude` returns `None` without key | |
| F7 | Legal-writing refinement preserving the JSON schema | `refinement/cases.json` diff (allowlists, expand/collect, splice, disabled, empty-input, no-client); prompt byte-equal | |
| F8 | Epistemic quarantine: trust level on every proposition; ungrounded stripped | `/api/analyse` responses: `quarantined_count`, stripped authorities, `quarantine_summary`; debate `attachCitationTrust`; `analyse-contract` defaults (unknown → QUARANTINED) | |
| F9 | UK GDPR Art 9 consent gate; LSA 2007 disclaimer on every page and output | route: `consent !== true` → 400 (fixtures); UI: every page's rendered HTML contains the disclaimer sentence; consent checkbox gates the analysis and debate buttons and is forwarded as `consent` | |
| F10 | PDF and DOCX → text before any LLM sees a document | `/api/triage` on `documents/sample.{pdf,docx,txt}`: extracted text compared with `expected-text.json` | |
| F11 | `LLM_PROVIDER=agent` deterministic stand-in + hermetic smoke harness | `agent-provider/cases.json` diff for every endpoint × message; `cargo run --bin smoke` reproduces the 7 sections and its JSON is diffed against `fixtures/smoke/ts-smoke-report.json` (ignoring timings/env) | |
| F12 | Noir design system and existing routes/URLs | all 17 sitemap routes + 3 redirects + `/adversarial-debate` + `/schema-builder` + `/sitemap.xml` + `/robots.txt` respond; CSS tokens (`#000000`, `#8B5CF6`, `#E8E3D5`) present; light theme wrapper on the 6 institutional pages | |

## Routes

| # | Route | How it is checked | Verified |
|---|---|---|---|
| R1 | `POST /api/analyse` | every recorded request in `routes/responses.json` replayed against the Axum router: status + JSON body equality (with `today` injected, `request_id` shape-only); rate limit 11th call → 429 | |
| R2 | `POST /api/triage` | multipart replays: no document, string field, > 10 MB, unsupported ext, txt/pdf/docx in degraded and agent modes, corrupt pdf/docx → 422 | |
| R3 | `POST /api/deadlines` | 29 recorded bodies + bad JSON | |
| R4 | `GET /api/schema/{claimType}` | 13 recorded (10 valid, 404s) | |
| R5 | `GET /api/case-law/search` | 25 recorded query strings | |
| R6 | `GET /api/case-law/find` | 7 recorded with canned upstream | |
| R7 | `GET /api/case-law/judgment` | 5 recorded with canned upstream | |
| R8 | `GET /api/era-2025/tracker` | body equality | |
| R9 | `POST /api/request-access` | 17 recorded bodies + bad JSON; persisted JSONL line shape | |
| R10 | `POST /api/roadmap` | 11 recorded bodies | |
| R11 | `GET /api/roadmap/{caseId}` | body equality | |
| R12 | `POST /api/webhook` | 16 recorded signature/timestamp cases with injected `now` | |
| R13 | `POST /api/debate` | 14 recorded bodies (400s, no client 500, agent single/adversarial) | |
| R14 | `/sitemap.xml`, `/robots.txt` | route list/priorities equal `ui/sitemap.json`; robots text equal | |
| R15 | Pages: `/`, `/adversarial-debate`, `/analysis-engine`, `/case-law-db`, `/era-2025`, `/security`, `/ethics`, `/methodology`, `/privacy`, `/terms`, `/product`, `/request-access`, `/schema-builder`, `/about`, `/blog`, `/contact`, `/documentation`, `/how-it-works`, `/pricing`, redirects `/analysis`, `/case-law`, `/docs` | fetched from the running Rust server: 200 (or 307 for redirects), `<title>`, disclaimer sentence, theme class, key headings compared with the TypeScript page sources | |
