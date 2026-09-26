# Testing

```bash
cd coffeecup
npm test            # whole suite
npx vitest run src/journeys        # journeys A–E only
npm run typecheck && npm run lint  # static checks
```

Vitest runs each file in its own process with an in-memory PGlite database
migrated from `drizzle/`, and the mock model provider. No network, no API
keys, no Docker. `src/test/setup.ts` snapshots and restores `process.env`
and strips provider keys, `DATABASE_URL` and all regulatory flags before every
test.

## Suites

| Area | File(s) | Covers |
|---|---|---|
| Database | `db/client.test.ts` | connection, migrations |
| Auth | `auth/service.test.ts` | hashing, sessions, enumeration resistance, recovery |
| Cases | `cases/service.test.ts` | persistence, validation, **tenant isolation** |
| Legal core (retained) | `legal/deadlines/et-time-limit.test.ts`, `qualifying-period.test.ts`, `era-2025.test.ts`, `sources/*.test.ts` | corresponding-date rule, Acas s207B, non-working days, regime switch, citation validation, Find Case Law parsing |
| Deadline engine | `legal/deadlines/engine.test.ts` | rule versioning by event date, missing dates, Acas effects, expired limits, jurisdiction differences, approximate dates |
| Provider layer | `ai/structured.test.ts` | JSON extraction, Zod validation + retry, malformed output rejection, provider failure, routing |
| Documents / timeline / facts | `documents/service.test.ts` | extraction, review queue, confirm/correct/reject/merge, provenance transitions, extraction failure recovery, malformed model output, isolation |
| Processes / artifacts / Acas | `processes/service.test.ts` | state machines, Acas Code version, allegations, appeal grounds, drafting from confirmed material, staleness, Acas deadline updates, employer-policy appeal windows |
| Claims | `claims/service.test.ts` | flag gating, deterministic triggers, element statuses, qualifying service, ERA 2025 availability, Northern Ireland, deterministic review, hallucinated fact ids, provider failure, staleness |
| ET1 / exports / intake / payments / deletion | `et1/service.test.ts` | pack assembly, case pack, resources, triage, intake → case, webhook verification, replay, refund revocation, purge, account deletion |
| Journeys | `journeys/journeys.test.ts` | A–E below and persistence across sign-in |

## Journeys

- **A** Problem → grievance → outcome → resolved (no tribunal step).
- **B** Disciplinary → dismissal → appeal (allegations, hearing prep, appeal grounds, policy appeal window).
- **C** Dismissal → Acas EC → certificate → potential claims (flag on) → ET1 pack.
- **D** Already has Acas certificate (Scotland) → imports history and documents → ET1 pack.
- **E** Multiple documents → extraction errors → user corrects facts → downstream analysis updates.

## Fixture coverage checklist

pre/post statutory commencement dates ✔ · jurisdiction differences ✔ · Acas EC
deadline effects ✔ · missing dates ✔ · contradictory/corrected dates ✔ ·
grievance progression ✔ · disciplinary progression ✔ · user fact correction ✔ ·
document extraction ✔ · stale-analysis invalidation ✔ · tenant isolation ✔ ·
payment entitlements ✔ · regulatory feature flags ✔ · provider failure ✔ ·
malformed structured model output ✔ · hallucinated citation/fact rejection ✔ ·
ET1 pack assembly ✔

## Browser testing

Playwright is not wired in this repository yet. The journeys run against the
service layer, which the route handlers call directly; `npm run build`
verifies pages and client/server boundaries compile.
