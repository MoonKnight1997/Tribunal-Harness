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

Each worker run identifies itself (`hostname:pid`, or `JOBS_WORKER_ID`) and
takes a lease of `JOBS_LEASE_SECONDS` (default 300) on every job it claims. A
worker killed mid-job leaves a `processing` row whose lease expires; the next
run reclaims it automatically, so no database edit is needed to recover. A
handler exception re-queues the job with exponential backoff (15 s × 2^attempts,
capped at one hour) until `max_attempts` is reached. Set the lease longer than
your slowest expected job (large PDFs, OCR).

### OCR (optional)

Images are always kept as evidence. To have their text read locally, install
`tesseract` on the worker and set `OCR_PROVIDER=tesseract_cli`. Scanned PDFs
additionally need `pdftoppm` (poppler-utils) to rasterise pages. Nothing is
ever sent to a network OCR service. The extraction report records per-page
character counts and confidence; low confidence marks the document
"needs a look" rather than proposing from it silently.

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
- Confirm the Employment Rights Act 2025 commencement instruments. There is no
  operator switch: `TIME_LIMIT_SI_CONFIRMED` is derived in code from
  `src/legal/rules/register.ts` (a rule counts as confirmed only when its
  register entry is `commenced` with a recorded commencement instrument that
  was actually fetched). Confirming a commencement is a reviewed code change
  per `docs/LEGAL_SOURCE_GOVERNANCE.md` ("How to add or confirm a
  commencement"). `ERA_2025_TIME_LIMIT_COMMENCEMENT` only overrides the
  *assumed* GB date and never confirms anything. Run
  `npm run legal:check-sources` and clear every `UNREAD`/`UNREACH` before
  relying on deadlines.
