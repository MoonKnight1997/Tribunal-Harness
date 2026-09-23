# Golden fixtures recorded from the TypeScript app

Everything in this directory was produced by running the **TypeScript**
(Next.js) app's own modules in-process, hermetically (no network, no API key),
and recording their outputs. The Rust crates diff themselves against these
files in `cargo test`. Nothing here was hand-edited.

## How they were produced

From a clean checkout of commit `36aecfb` (branch `main`), Node 22.22.2:

```bash
cd tribunal-harness
npm ci

# (a) the TypeScript test suite — baseline results
TMPDIR=/tmp npx vitest run --reporter=verbose > ../tribunal-harness-rs/fixtures/ts-vitest-baseline.log
#   → 28 files, 403 passed, 2 skipped (the two RUN_LIVE_CASELAW live tests)

# (b) the hermetic smoke harness — per-route request/response output
npm run smoke                      # writes smoke-report.{json,md}

# (c)+(d) differential cases and canned upstream responses
LLM_PROVIDER=agent npx tsx --tsconfig tsconfig.json \
    ../tribunal-harness-rs/fixtures/generators/generate-fixtures.ts
```

The generator (`generators/generate-fixtures.ts`) replaces `globalThis.fetch`
with canned responders and never touches the network. It sets
`LLM_PROVIDER=agent` so every LLM call is served by the app's own deterministic
stand-in (`src/lib/llm/agent-provider.ts`), and deletes `ANTHROPIC_API_KEY`,
`WEBHOOK_SECRET`, `RESEND_API_KEY`, `NOTIFY_EMAIL`, `REFINEMENT_DISABLED` and
`ERA_2025_TIME_LIMIT_COMMENCEMENT` first.

`documents/sample.pdf` was printed once from `documents/sample.html` with the
pre-installed Chromium (`chrome --headless=new --print-to-pdf`), so it is a
realistic compressed PDF. `documents/sample.docx` is built by the generator
(a minimal WordprocessingML package). `documents/expected-text.json` records
what `pdf-parse` and `mammoth` extract from them.

## Time-dependent values

Deadline `days_remaining` / `is_expired`, the roadmap `status` fields and the
webhook replay window depend on "now". Each such fixture records
`generated_today` (UTC calendar date) or `now_seconds`; the Rust comparison
tests inject that same instant, so the comparisons are exact and repeatable.

Values that are random or wall-clock (`request_id` UUIDs, `duration_ms`,
`timestamp` in persisted access requests, `lastModified` in the sitemap) are
replaced by `<uuid>`, `<varies>`, `<iso-timestamp>`, `<now>` placeholders by the
generator and are compared for shape only.

## Directory map

| Path | Source module | What it holds |
|---|---|---|
| `ts-vitest-baseline.log` | Vitest | full verbose run of the TypeScript suite |
| `smoke/ts-smoke-report.{json,md}` | `scripts/smoke-run.ts` | golden smoke output (7 sections) |
| `constants/constants.json` | `lib/constants.ts` | ERA_2025, tracker, configs, CLAIM_TYPES, FSM states, date-format samples, override validation cases |
| `constants/verified-authorities.json` | `lib/verified-authorities.ts` | the 24 curated authorities + lookup cases |
| `constants/claude-config.json` | `lib/claude-config.ts` | model ids, endpoint config, 33 cost samples |
| `prompts/prompts.json` | `agents/prompts.ts` | every system prompt, byte-exact |
| `schemas/all-schemas.json` | `schemas/` | all 10 claim schemas as served by the API |
| `deadlines/add-months-less-one-day.json` | `services/deadline-calculator.ts` | 7 308 cases: every day 2024-01-01..2028-12-31 × {1,3,6,12} months |
| `deadlines/grid-no-acas.json` | same | 1 856 acts (every day 2024-06-01..2029-06-30) through `calculateDeadlines` |
| `deadlines/grid-acas.json` | same | 2 826 ACAS scenarios (every 7th day 2025-01-01..2027-12-31 × 18 Day A/Day B offsets, including inverted, late and same-day) |
| `deadlines/multi.json`, `single.json`, `invalid.json` | same | multi-claim warnings, `calculateDeadline` singles, rejected inputs |
| `qualifying-period/grid.json` | `services/qualifying-period.ts` | 1 900+ start/EDT pairs across the Jan-2027 boundary + rejects |
| `citations/validate.json` | `services/citation-validator.ts` | 190 offline validation cases (all authorities × 5 spellings, test cases, schema key authorities), extraction, normalisation, party tokens, batch summaries |
| `citations/authoritative.json` | same (async) | curated-first + canned live verification decisions |
| `find-case-law/*.json` | `services/find-case-law.ts` | Atom feeds, parse results, search envelopes per upstream status, verify decisions incl. the FMX false-positive guard and cache behaviour |
| `pdf-to-markdown/cases.json` | `services/pdf-to-markdown.ts` | tidy/header/allowlist cases, buffer conversion, SSRF-guarded fetch incl. redirects |
| `documents/*` | — | sample PDF/DOCX/TXT + extracted text |
| `analyse-contract/cases.json` | `schemas/analyse-contract.ts` | normaliser in/out pairs incl. malformed input |
| `agent-provider/cases.json` | `lib/llm/agent-provider.ts` | stand-in output for every endpoint × 17 user messages |
| `claude-client/cases.json` | `lib/claude-client.ts` | agent-path results, no-client null, production refusal, truncation error text |
| `refinement/cases.json` | `services/legal-writing-refinement.ts` | allowlists, refine results (agent, disabled, no client), path get/set cases |
| `rate-limit/cases.json` | `lib/rate-limit.ts` | client key derivation, fixed-window sequence |
| `ui/debate-modes.json`, `ui/analysis-results-view.json`, `ui/sitemap.json`, `ui/robots.txt.json` | components | pure UI helper outputs |
| `routes/responses.json` | `src/app/api/**/route.ts` | ~180 request/response pairs for every route (400s, degraded, agent mode, rate limit, bad JSON) |
| `pages/*.html` | `next build && next start` | server-rendered HTML of every page route (see `pages/README.md` for how) |

## Live upstreams

The sandbox's egress proxy refuses `caselaw.nationalarchives.gov.uk` (HTTP 403
on CONNECT) and no `ANTHROPIC_API_KEY` is available, so **no live TNA or
Anthropic responses were recorded**. The TNA feeds used are the ones embedded in
the TypeScript test suite (`find-case-law.test.ts`) plus one synthetic variant
exercising attribute order, entity decoding and the link fallback. The
Anthropic request/response shapes come from `claude-client.test.ts`. Live checks
are opt-in only (`RUN_LIVE_CASELAW=1`) and marked `[blocked]` in `PARITY.md`.
