# Privacy and security

Workplace cases contain sensitive personal data, including special category
data. The design assumes so.

## Tenancy isolation

- Every case-scoped query goes through `requireCaseAccess(actor, caseId)`
  (`src/cases/access.ts`), which selects by id **and** owner. A guessed id for
  another user's case returns the same `NotFoundError` as a non-existent id.
- Sub-resources are always filtered by `caseId` after the guard passes.
- Automated isolation tests: `src/cases/service.test.ts`,
  `src/documents/service.test.ts`.

## Authentication

- scrypt password hashing (Node built-in, OWASP parameters), NFKC-normalised,
  constant-time verification.
- Session and recovery tokens are 256-bit random values; only their SHA-256 is
  stored. Cookies are HttpOnly, SameSite=Lax, Secure in production.
- Sign-in errors do not distinguish unknown email from wrong password; sign-up
  collisions and recovery requests do not confirm whether an email exists.
- Password reset invalidates every session.

## Storage

- Uploaded files are stored through `StorageProvider` under an opaque
  case-scoped key; there are no public URLs. Bytes are served only by the
  authenticated download route after the tenancy guard.
- Default adapter stores bytes in Postgres (`document_blobs`); local-disk
  adapter for development; an S3-compatible adapter can be added without
  touching the document service.

## Model context

- No cross-case context is ever sent to a model.
- Only what the task needs is sent (confirmed facts/events or the document
  text being extracted).
- Provider keys are server-side only. The mock provider is refused in
  production.

## Logging and audit

- `audit_events` records actions with redacted structured details: ids,
  counts, kinds and statuses. `redactDetails` drops keys that look like
  text, names, emails, tokens or passwords.
- Operational logs never include document text or narratives.
- Analytics store event names and a salted hash of the user id with an
  allow-list of scalar properties.

## Consent

- Terms and privacy consent are recorded at sign-up with versions.
- The sign-up wording covers explicit consent for special category data the
  worker chooses to record; withdrawal is by deleting the case or account.

## Retention and deletion

- Case deletion is soft, then purged (rows and files) after
  `DELETED_CASE_RETENTION_DAYS` (default 30) by the jobs worker; immediate purge
  is available to the user.
- Account deletion removes the user; cascades remove cases, sessions,
  entitlements; files are removed explicitly.

## Transport and headers

- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, referrer policy
  and permissions policy on every response (`next.config.ts`).
- Downloads are `private, no-store` with `nosniff`.

## Rate limiting

- Auth and triage endpoints are rate limited per client (trusted-hop keying).
  The in-memory limiter is single-instance; use a shared store for multi-instance
  deployments (see DEPLOYMENT.md).

## Payments

- Entitlements are granted only from a signature-verified webhook and stored
  separately from payment events; replays are idempotent; refunds revoke.
