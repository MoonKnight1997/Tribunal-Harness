# CLAUDE.md — coffeecup (this repository)

**Last updated: 24 September 2026**

The active application is `coffeecup/`. Read `coffeecup/README.md` and the
documents in `coffeecup/docs/` before changing anything. The previous product
(Tribunal Harness) was rebuilt into coffeecup; the mapping of what was
retained, adapted, replaced or removed is in
`coffeecup/docs/MIGRATION_FROM_TRIBUNAL_HARNESS.md`.

Also in this repository: `tribunal-harness-rs/` (a standalone Rust port of the
old Tribunal Harness app) and forward-looking plans in `coffeecup/PRODUCT-PLAN.md`,
`coffeecup/ARCHITECTURE.md` and `coffeecup/RECONCILIATION.md` (planning only —
get founder sign-off before building from them).

## What this is

A UK workplace-problem case-management and decision-support application for
ordinary workers in England, Wales and Scotland: understand the problem,
preserve facts and documents, build a chronology, work through grievance /
disciplinary / appeal processes, prepare for Acas Early Conciliation, and only
where appropriate and enabled, prepare for an Employment Tribunal claim.

It provides legal information and organisational tools, **not legal advice**.
Every page that shows legal information or generated wording renders
`LEGAL_INFORMATION_DISCLAIMER` from `coffeecup/src/brand/config.ts`.

## Non-negotiable invariants

1. **Case, not chat.** The authoritative record is the `Case` and its tables.
   Model output is a proposal until the user confirms it. Never promote
   `MODEL_INFERENCE` or `DOCUMENT_EXTRACTED` provenance to a confirmed state in
   code; only user actions do that (`src/facts/service.ts`, `src/timeline/service.ts`).
2. **Deadlines are deterministic.** `src/legal/deadlines/engine.ts` and the
   versioned rules in `src/legal/rules/` are the only source of dates. An LLM
   never calculates a limitation date. Missing data → `uncertain`, never a guess.
3. **Versioned law.** Select rules by the event date, never "the newest".
   ERA 2025 dates live only in `src/legal/era-2025.ts`. TBC commencements are
   labelled "exact commencement date to be confirmed by Statutory Instrument".
4. **No scores.** Never emit likelihood-of-success percentages or
   strong/weak/winner/hopeless labels. Elements are `supported`,
   `potentially_supported`, `disputed`, `unsupported_on_current_information`,
   `information_missing`, `not_applicable`.
5. **Flags are server-side.** `ENABLE_PERSONALISED_CLAIM_IDENTIFICATION`,
   `ENABLE_PERSONALISED_ET1_DRAFTING`, `ENABLE_CASELAW_LLM_ANALYSIS`,
   `ENABLE_EXTERNAL_CASE_REFERRAL`, `ENABLE_PAID_CLAIM_FEATURES` are enforced
   with `requireFlag` in services/routes, not just hidden in the UI.
6. **Tenancy.** Every case-scoped operation goes through `requireCaseAccess`.
   A guessed id returns the same `NotFoundError` as a missing one. Add an
   isolation test for any new case-scoped table.
7. **Staleness.** Any change to a source fact calls `markStale` with the
   affected kinds (`src/cases/staleness.ts`). Never leave a derived output
   silently wrong.
8. **Provider-agnostic.** Business logic depends only on `LLMProvider`
   (`src/ai/provider.ts`). No SDK calls outside `src/ai/providers/`. The mock
   backend must serve every task so the whole suite runs offline.
9. **Brand.** Never hard-code a product name; use `BRAND` from `src/brand/config.ts`.
10. **Privacy.** No document text or narratives in logs/audit/analytics. No
    public document URLs. No cross-case model context.

## Working in the repo

```bash
cd coffeecup
npm install
npm run dev
npm test                 # Vitest, in-process Postgres (PGlite), mock provider
npm run lint && npm run typecheck && npm run build
```

- Schema changes: edit `src/db/schema.ts` (enums in `src/db/enums.ts`), run
  `npm run db:generate`, review and commit the SQL in `drizzle/`.
- New case-scoped services: take an `Actor`, call `requireCaseAccess`, write an
  audit event, call `markStale` where appropriate, add tests.
- New legal sources: add to `src/legal/sources/registry.ts` with
  `effectiveFrom`, `lastVerifiedAt` and applicability notes. New time-limit
  rules are new rows in `src/legal/rules/time-limits.ts`, not edits.
- Client components must not import server modules: import enums from
  `@/db/enums` and pure labels from `@/cases/stages` / `@/processes/machines`.
- Commit messages: reference the phase or area (e.g. `P5 acas: …`).

## Open decisions (do not decide unilaterally)

- Public brand name, domain and operator entity.
- Whether Find Case Law judgment text may be processed computationally
  (licensing); keep `ENABLE_CASELAW_LLM_ANALYSIS` off until confirmed.
- Enabling personalised claim identification / ET1 drafting publicly
  (regulatory review first).
- Payment provider go-live and final prices.
- Confirmed commencement date for the ERA 2025 six-month time limit.
