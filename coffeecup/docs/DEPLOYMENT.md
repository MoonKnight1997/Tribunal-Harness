# Deployment

## Prerequisites

- Node.js 22+
- PostgreSQL 15+ (any host). Locally you can skip this: PGlite is embedded.
- A model provider key (Anthropic or an OpenAI-compatible endpoint), or run
  with the mock provider for staging. The mock is refused in production unless
  `ALLOW_MOCK_LLM_IN_PRODUCTION=1`.
- Stripe account (only if `PAYMENTS_ENABLED=1`).
- A transactional email API key (Resend-compatible) for account recovery.

## Environment

Copy `.env.example` and set at least:

```
DATABASE_URL=postgres://...
LLM_PROVIDER=anthropic          # or openai_compatible
ANTHROPIC_API_KEY=...           # or OPENAI_COMPATIBLE_API_KEY
NEXT_PUBLIC_BRAND_NAME=...
NEXT_PUBLIC_BRAND_ORIGIN=https://your-domain
EMAIL_API_KEY=...
ANALYTICS_SALT=<random>
JOBS_RUN_TOKEN=<random>
JOBS_INLINE=0
```

Leave every `ENABLE_*` flag unset (off) unless the regulatory position for that
capability has been confirmed.

## Database migrations

```bash
npm run db:migrate       # applies ./drizzle to DATABASE_URL
```

`AUTO_MIGRATE` (default on) also applies migrations on first connection, which
is fine for a single instance. For multi-instance deployments run
`db:migrate` from CI/CD before rollout and set `AUTO_MIGRATE=0`.

To change the schema: edit `src/db/schema.ts`, run `npm run db:generate`,
review the SQL in `drizzle/`, commit both.

## Build and run

```bash
npm ci
npm run build
npm start
```

Works on Vercel, Fly.io, Railway, Render or a container. Set
`serverExternalPackages` are already configured for `pdf-parse`, `postgres`
and `@electric-sql/pglite`.

## Background jobs

Document extraction and the retention purge run as jobs. In production set
`JOBS_INLINE=0` and schedule one of:

- `POST /api/jobs/run` with `Authorization: Bearer $JOBS_RUN_TOKEN` (e.g. a
  platform cron every minute), or
- `npm run jobs:run` from a worker/cron container.

## Payments (optional)

1. `PAYMENTS_ENABLED=1`, `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`.
2. Point a Stripe webhook at `POST /api/payments/webhook` for
   `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`.
3. Prices via `PRICE_CASE_PASS_PENCE` / `PRICE_CLAIM_PACK_PENCE`.

Entitlements are only ever granted by the verified webhook.

## Storage

Default keeps uploaded files in Postgres (`document_blobs`). For very large
volumes add an S3-compatible adapter implementing `StorageProvider` in
`src/documents/storage.ts` and select it with `STORAGE_PROVIDER`.

## Rate limiting

The built-in limiter is per process. Behind more than one instance, replace it
with a shared store (Redis) in `src/lib/rate-limit.ts`.

## Health

`GET /api/health` reports database kind, provider name and flag state (no
secrets).

## Checklist before public launch

- ICO registration and a completed DPIA.
- Data-processing agreement with the model provider; confirm no training on inputs.
- Independent regulatory review of enabled flags (Legal Services Act boundary).
- Backups and restore drill for Postgres.
- Confirm the Employment Rights Act 2025 commencement SI and set
  `ERA_2025_TIME_LIMIT_COMMENCEMENT` / `TIME_LIMIT_SI_CONFIRMED` accordingly.
