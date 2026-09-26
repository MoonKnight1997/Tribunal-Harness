# coffeecup

Internal codename for a UK workplace-problem case-management and decision-support
application. It helps an ordinary worker in England, Wales or Scotland understand
and organise a problem at work, keep one continuous record, work through
grievance, disciplinary and appeal processes, prepare for Acas Early
Conciliation, and, only where appropriate and enabled, prepare for an Employment
Tribunal claim.

The public brand is not decided; everything user-facing reads from
`src/brand/config.ts`.

It provides legal information and organisational tools, not legal advice.

## Quick start

```bash
cd coffeecup
npm install
cp .env.example .env.local     # defaults: embedded database, mock model provider, payments off
npm run dev                     # http://localhost:3000
```

No external services are needed to run it locally: the database is an embedded
Postgres (PGlite) under `./data/pglite`, the model provider is a deterministic
mock, and payments are disabled so every feature is available.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Vitest suite (in-process Postgres, mock provider); see `docs/TESTING.md` |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:generate` | Generate a SQL migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (or the local PGlite database) |
| `npm run jobs:run` | Run queued background jobs and the retention purge once |

## Documentation

- `docs/PRODUCT.md` — what the product does and does not do
- `docs/ARCHITECTURE.md` — modules, request flow, invariants
- `docs/DATA_MODEL.md` — tables and provenance model
- `docs/LEGAL_SOURCE_GOVERNANCE.md` — source registry, versioned rules, case law policy
- `docs/AI_PROVIDER_ARCHITECTURE.md` — provider interface, routing, structured output guard
- `docs/PRIVACY_SECURITY.md` — tenancy, storage, retention, logging
- `docs/REGULATORY_FEATURE_FLAGS.md` — the five server-side flags
- `docs/TESTING.md` — suites, fixtures, journeys A–E
- `docs/DEPLOYMENT.md` — prerequisites, environment, migrations, jobs, payments
- `docs/MIGRATION_FROM_TRIBUNAL_HARNESS.md` — what was retained, adapted, replaced or removed

## Planning documents

Earlier forward-looking plans (a Rust backend with Meta Muse Spark 1.3 as the
reasoning layer; launch not before February 2027) are kept alongside the built
app. They predate this implementation and re-open resolved decisions, so get
founder sign-off before acting on them:

- [`PRODUCT-PLAN.md`](./PRODUCT-PLAN.md) — product thesis, screens, runtime design, build phases
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — target Rust backend (distinct from `docs/ARCHITECTURE.md`, which describes the current app)
- [`RECONCILIATION.md`](./RECONCILIATION.md) — carry-over, conflicts, founder decisions required
