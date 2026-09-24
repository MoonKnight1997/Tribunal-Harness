# Architecture

Next.js 15 (App Router) application with a service layer that never imports
Next.js, a PostgreSQL schema managed by Drizzle, a provider-agnostic model
layer, and server-side regulatory flags.

```
src/
  app/                 Route handlers and pages (thin adapters over services)
    (public)/          Marketing and informational content; no case data
    (auth)/            Sign in / up / recover / reset
    app/               Authenticated case workspace
    api/               JSON API; every case endpoint goes through one router
  brand/               Central brand configuration
  db/                  Drizzle schema, enums, client (Postgres or PGlite), migrations in ../drizzle
  auth/                scrypt passwords, hashed session/recovery tokens, cookies
  cases/               Case service, tenancy guard, audit, stage model, staleness, dashboard, retention
  intake/              Triage (stateless) and case creation from intake
  facts/ timeline/ issues/ tasks/   Case record services
  documents/           Storage abstraction, extraction, upload + proposal pipeline
  processes/           Grievance / disciplinary / appeal / Acas state machines and data
  legal/
    era-2025.ts        Single source of truth for ERA 2025 dates
    sources/           Legal source registry; verified authorities; citation validator; Find Case Law client
    rules/             Versioned time-limit rules; Acas Code versions
    deadlines/         Deterministic engine (+ retained calculator), case-level computation
    claims/            Claim definitions, engine, deterministic review
  ai/                  LLMProvider interface, structured-output guard, routing, backends, tasks
  artifacts/           Generated documents (editable; basis + staleness)
  claims/ et1/ exports/ resources/   Downstream stages
  entitlements/ payments/            Entitlements, pricing, provider abstraction, Stripe/mock
  jobs/                Background jobs with explicit state
  analytics/           Privacy-conscious events
  journeys/            Golden-path tests A–E
```

## Request flow

1. Route handler (`src/app/api/...`) authenticates via the session cookie
   (`auth/current-user.ts`) and parses input.
2. It calls a service with an `Actor { userId }`.
3. The service calls `requireCaseAccess(actor, caseId)`, which selects the case
   by id **and** owner; anything else is `NotFoundError`.
4. Mutations write an audit event, bump the case activity time, and call
   `markStale` for the derived outputs that depend on the changed input.
5. Errors are `AppError`s mapped to HTTP status in `lib/http.ts`.

## Provenance and confirmation

Facts and events carry `provenance` and `status`. Pipelines write
`proposed` rows with `DOCUMENT_EXTRACTED` / `EMPLOYER_ALLEGATION` /
`MODEL_INFERENCE`; only user actions produce `USER_CONFIRMED` /
`DOCUMENT_CONFIRMED`. Engines read confirmed rows only.

## Staleness

`cases/staleness.ts` is the dependency map. A changed employment date or
structured fact invalidates deadlines, claims, artifacts and the summary; a
changed event invalidates claims, artifacts and summary; Acas dates invalidate
deadlines, claims and artifacts. Regeneration is explicit.

## Deterministic core

Time limits, qualifying service, Acas effect, appeal windows and claim
availability are computed by code from structured data with versioned rules.
The model never calculates a date.

## Model layer

`ai/provider.ts` defines `LLMProvider`; `ai/structured.ts` enforces JSON +
Zod validation with one retry; `ai/routing.ts` maps capabilities to tiers and
providers; `ai/providers/*` are the adapters (mock, Anthropic, OpenAI-compatible).
Tasks live in `ai/tasks/*` with their prompts and schemas.

## Flags and entitlements

`flags/` reads the five regulatory flags from the environment; services and
route handlers call `requireFlag`. `entitlements/` decides what a case may use;
when `PAYMENTS_ENABLED` is off, everything is entitled.

## Background work

`jobs/service.ts` stores jobs with `queued → processing → completed | failed |
requires_review` and retries. Document extraction is a job. In development and
tests jobs run inline; in production a scheduler calls `POST /api/jobs/run`
or `npm run jobs:run`.

## Breaking changes from Tribunal Harness

See `MIGRATION_FROM_TRIBUNAL_HARNESS.md`.
