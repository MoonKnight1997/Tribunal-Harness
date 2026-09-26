# Migration from Tribunal Harness to coffeecup

**Status:** complete. Written before any destructive work, then updated as each phase landed. The legacy `tribunal-harness/` app, the root Vite prototype, the stale planning documents, `_AGENT_BRIEFINGS/`, `.Jules/`, the `Design/` screenshots and `assets/` were removed in the final phase; all of it remains in git history at commit `36aecfb`.
**Audit basis:** the `tribunal-harness/` Next.js 15 app at commit `36aecfb`
(403 Vitest tests passing, 2 skipped) and the legacy Vite prototype at the
repository root (`src/*.jsx`, `server.js`, `index.html`).

## Why the product inverted

Tribunal Harness asked the user to pick a legal claim type and then analysed it.
coffeecup starts from a **workplace problem**, keeps one persistent `Case`, and
only reaches claim analysis and ET1 preparation as a late, feature-flagged stage.
The fundamental data object is `Case`, not `Chat`, `Claim` or `Analysis`.

## Migration map

| Existing component (tribunal-harness/) | Decision | New home | Reason |
|---|---|---|---|
| `src/lib/constants.ts` (ERA 2025 dates, tracker, TIME_LIMIT_CONFIG, QUALIFYING_PERIOD_CONFIG) | **Retain** (adapt) | `src/legal/era-2025.ts` | Single source of truth for commencement dates. Claim-type list moved to the claim registry; FSM_STATES replaced by the Case stage model. |
| `src/services/deadline-calculator.ts` + tests | **Retain** (wrap) | `src/legal/deadlines/et-time-limit.ts`; wrapped by the versioned rule registry in `src/legal/rules/` | Deterministic, UTC-safe, correct corresponding-date rule, s207B Acas logic, non-working-day warning. The engine now selects a *rule version* by event date instead of one universal period, and every output carries assumptions, trigger date, Acas effect and source. |
| `src/services/qualifying-period.ts` + tests | **Retain** | `src/legal/deadlines/qualifying-period.ts` | Deterministic ERA 1996 s108 logic with regime switch. |
| `src/schemas/*.ts` (10 claim schemas) | **Adapt** | `src/legal/claims/definitions/*.ts` | Kept as legal-element definitions (`ClaimDefinition` with `elements[]`), used by the claim engine to produce `ClaimCandidate`/`ClaimElement`. Removed the form-field UI coupling; intake no longer starts from a claim type. |
| `src/schemas/types.ts`, `analyse-contract.ts` | **Replace** | `src/legal/claims/types.ts` + Zod schemas in `src/ai/schemas/` | The old contract encoded STRONG/MODERATE/WEAK strength bands. The new contract uses per-element statuses (`supported`, `potentially_supported`, `disputed`, `unsupported`, `information_missing`, `not_applicable`) and never emits strength labels or percentages. |
| `src/services/citation-validator.ts`, `src/lib/verified-authorities.ts`, `src/services/find-case-law.ts` | **Retain** (adapt) | `src/legal/sources/citation-validator.ts`, `verified-authorities.ts`, `find-case-law.ts` | Epistemic-quarantine core. Live Find Case Law lookup is kept but gated by `ENABLE_CASELAW_LLM_ANALYSIS` for any LLM processing of judgment text; single-citation verification stays available (see `LEGAL_SOURCE_GOVERNANCE.md`). |
| `src/services/pdf-to-markdown.ts` | **Retain** | `src/documents/extract/pdf.ts` | SSRF-hardened, never throws. |
| `/api/triage` document parsing (pdf-parse, mammoth) | **Adapt** | `src/documents/extract/*` + extraction job | Extraction now writes `document.extractedText` and *proposes* events/facts into a review queue; it never inserts confirmed facts. |
| `src/lib/claude-client.ts`, `src/lib/claude-config.ts` | **Replace** | `src/ai/provider.ts`, `src/ai/providers/anthropic.ts`, `src/ai/routing.ts` | Business logic must not depend on the Anthropic SDK. Adapters implement `LLMProvider`; routing is by capability tier (`extraction`, `classification`, `structuring`, `analysis`, `critique`, `drafting`). |
| `src/lib/llm/agent-provider.ts` | **Adapt** | `src/ai/providers/mock.ts` | Deterministic test provider kept as a first-class adapter; hermeticity invariant preserved (only curated citations). |
| `src/agents/prompts.ts` (ANALYSE/TRIAGE/DRAFTER/CRITIC/JUDGE/REFINEMENT) | **Adapt / partly remove** | `src/ai/prompts/*.ts` | Drafter → `structuring`/`drafting` prompts; Critic → contrary-facts prompt; Judge → `reviewer` prompt answering the ten error-control questions. ANALYSE strength scoring and the 100-point rubric are removed (no likelihood scoring). Refinement pass removed: it added cost and edited prose the user must be able to trust as their own. |
| `/api/debate` route + `components/adversarial/*` | **Replace** | `src/legal/claims/review.ts` | Theatrical adversarial loop replaced by a single reviewer pass that checks facts vs conclusions. |
| `/api/analyse` route | **Replace** | `src/legal/claims/engine.ts` behind `ENABLE_PERSONALISED_CLAIM_IDENTIFICATION` | Claims are generated from structured confirmed facts, not narrative text. |
| `/api/deadlines` route | **Adapt** | `src/legal/deadlines/engine.ts` and case-scoped API | Deadlines are generated from case data (dismissal date, Acas dates) and stored as `Deadline` rows. |
| `/api/schema/[claimType]` | **Remove** | — | Intake no longer asks the user for a claim type. Claim definitions are exposed internally only. |
| `/api/era-2025/tracker` + `/era-2025` page | **Adapt** | Public content page `/help/law-changes` | Public informational content reads the same constants. |
| `/api/case-law/search` (20 seed cases) | **Remove** | — | Curated seed search was a demo. Verified authorities list is retained for validation only. |
| `/api/case-law/find`, `/api/case-law/judgment` | **Adapt** | `src/legal/sources/find-case-law.ts` (server-only) | Live lookup kept for citation verification. Judgment text fetch + LLM analysis gated by `ENABLE_CASELAW_LLM_ANALYSIS` (default off). |
| `/api/request-access`, `/request-access` page | **Remove** | — | Gated-access lead capture is replaced by account creation. |
| `/api/webhook` (HMAC) | **Replace** | `/api/payments/webhook` (Stripe signature) | The generic webhook stub had no consumer. |
| `/api/roadmap/[caseId]` | **Replace** | Case stage model (`src/cases/stages.ts`) | Static roadmap replaced by a stage model that spans internal processes, Acas and tribunal. |
| `src/lib/rate-limit.ts` | **Retain** | `src/lib/rate-limit.ts` | Trusted-hop keying and bounded map. |
| `src/components/layout/NavBar.tsx`, `Footer.tsx`, Noir design system, liquid glass CSS | **Replace** | `src/components/shell/*`, `globals.css` | The dark "legal intelligence" aesthetic is wrong for stressed workers. New calm, light, plain-English design. |
| Marketing pages (product, methodology, ethics, security, pricing, blog, about, documentation, how-it-works, schema-builder, analysis-engine, case-law-db, adversarial-debate) | **Replace** | Public content framework `src/app/(public)/*` | Content rewritten around grievance/disciplinary/Acas/tribunal clusters with jurisdiction and reviewed dates. Privacy/Terms retained in substance and rewritten. |
| `scripts/smoke-run.ts` | **Replace** | Journey tests in `src/journeys/*.test.ts` | End-to-end coverage now runs against the real service layer with the mock provider and an in-process Postgres (PGlite). |
| `src/test/setup.ts` (env snapshot) | **Retain** | `src/test/setup.ts` | Good isolation practice. |
| Legacy Vite prototype at repo root (`src/*.jsx`, `server.js`, `index.html`, root `package.json`) | **Remove** | — | Superseded twice over; nothing imports it. |
| Root historical documents (`STACK-DECISION-*.md`, `OPUS48_WORKFLOW_PROMPT.md`, `SESSION-DEBRIEF.md`, venture audit PDF/DOCX, `_AGENT_BRIEFINGS/`, `.Jules/`) | **Remove** | git history | Stale, and the inner CLAUDE.md already warned they were stale. |
| `corpus/` (authorities manifest) | **Retain** | `coffeecup/legal-corpus/` | Manifest of verified authorities is useful governance evidence. |
| `Design/` (screenshots), `assets/`, `.Jules/palette.md` | **Remove** | git history | Artefacts of the Noir design that coffeecup replaces. |

## Renames

| Old | New |
|---|---|
| `TribunalCase` (FSM states) | `EmploymentCase` stage model (`Case.stage`) |
| `ClaimIntake` / `/api/analyse` | `ClaimAssessment` (downstream of `Case`) |
| `ClaimSchema.legalTest[]` (question strings) | `ClaimDefinition.elements[]` (`ClaimElementDefinition`) |
| `TrustLevel` VERIFIED/CHECK/QUARANTINED | retained for **citations**; facts use `Provenance` |

Legal concepts that genuinely refer to Employment Tribunal processes (ET1, Acas
Early Conciliation, EDT, s207B) keep their names.

## Target architecture (summary)

```
coffeecup/
  src/app/(public)/     marketing + informational content, no case data
  src/app/(auth)/       sign-in, sign-up, recovery
  src/app/(app)/        authenticated case workspace
  src/app/api/          route handlers (flags enforced server-side)
  src/brand/            central brand config (public name changeable)
  src/db/               Drizzle schema, migrations, connection (Postgres / PGlite)
  src/auth/             sessions, password hashing (scrypt), recovery tokens
  src/cases/            case service, stages, tenancy guard, audit, staleness
  src/documents/        storage abstraction, extraction, proposal queue
  src/timeline/         events, merge, confirm
  src/facts/            facts + provenance
  src/processes/        grievance / disciplinary / appeal / acas state machines
  src/legal/            era-2025 constants, rules registry, deadlines, claims, sources
  src/ai/               LLMProvider interface, adapters, routing, prompts, schemas
  src/artifacts/        generated documents (editable, separate from facts)
  src/et1/              readiness pack assembly
  src/payments/         PaymentProvider, Stripe adapter, entitlements
  src/flags/            regulatory feature flags (server-side)
  src/resources/        external support directory
  src/analytics/        privacy-conscious event analytics
  src/journeys/         golden-path tests A–E
```

## Breaking changes

- All `/api/analyse`, `/api/triage`, `/api/debate`, `/api/schema/*`,
  `/api/case-law/search`, `/api/request-access`, `/api/roadmap/*`,
  `/api/era-2025/tracker`, `/api/webhook` endpoints are removed.
- Strength bands (STRONG/MODERATE/WEAK) and the 100-point judge rubric are gone.
- Browser-only state is gone: a saved case requires an account.
- The public brand is read from `src/brand/config.ts` (`BRAND.name`), never
  hard-coded.
