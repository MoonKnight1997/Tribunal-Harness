# Tribunal Harness — Rust rebuild (`tribunal-harness-rs/`)

A Rust port of the production Next.js app in `../tribunal-harness/`: the same
HTTP API (identical routes, request/response JSON, status codes and wording),
the same server-rendered pages, and the same legal content — statutory dates,
time limits, bank holidays, the curated authority list, disclaimers, rubric
text and system prompts — ported verbatim. **This is a port, not a redesign.**
The Next.js app is untouched and remains the reference.

Everything server-side is Rust (Axum, no Node at runtime): the deadline
calculator, citation validation, the Find Case Law (TNA) client, the model
clients (Anthropic Messages API, and Meta's Model API for Muse Spark — see
[Running on Muse Spark](#running-on-muse-spark)), PDF/DOCX text extraction,
the three-agent debate engine and the legal-writing refinement pass. The UI is rendered with `maud`; the six
interactive pages use small inline scripts that call the same `/api/*` routes
the React pages called. The stylesheet is the app's `globals.css` compiled once
by the Tailwind standalone CLI and embedded in the binary; the fonts are
self-hosted.

> Legal information, not legal advice. Every page and every analysis output
> carries the same persistent disclaimer as the Next.js app.

## Requirements

- Rust 1.85 or newer (`rustup toolchain install stable`). Nothing else: no
  Node, no Tailwind, no system libraries (TLS is `rustls`; PDF and DOCX
  extraction are pure Rust).
- Network is only needed at run time for the live services the Next.js app
  also calls (Anthropic, TNA Find Case Law, Resend). The test suite never
  touches the network.

## Build, run, test

```bash
cd tribunal-harness-rs

cargo build --workspace                 # debug build of all three crates
cargo test --workspace                  # hermetic: recorded fixtures, no network, no API key
cargo run --bin th-server               # http://localhost:3000 (PORT overrides)
LLM_PROVIDER=agent cargo run --bin smoke   # end-to-end smoke run, writes smoke-report.{json,md}

cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings
```

`cargo run --release --bin th-server` for a production binary. The server reads
`.env.local` in the working directory (like Next) without overriding variables
already in the environment.

### Environment variables (same names and meanings as the Next.js app)

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Enables real model calls through Anthropic. Without any provider (no Anthropic key, no `MODEL_API_KEY`, no stand-in) `/api/analyse` and `/api/triage` return their degraded 200 bodies and `/api/debate` returns the 500 `ANTHROPIC_API_KEY not configured` (wording kept from the Next.js app). |
| `MODEL_API_KEY` | Enables real model calls through Meta's Model API running **Muse Spark** — see [Running on Muse Spark](#running-on-muse-spark). Used automatically when `ANTHROPIC_API_KEY` is unset, or explicitly with `LLM_PROVIDER=muse`. |
| `LLM_PROVIDER` | `agent` → the deterministic offline stand-in (`th_core::agent_provider`; refused when `NODE_ENV=production`). `muse` → Meta Model API. `anthropic` → Anthropic. Unset → Anthropic if its key is set, else Muse if `MODEL_API_KEY` is set. |
| `MODEL_API_MODEL`, `MODEL_API_BASE_URL`, `MODEL_API_STREAM`, `MODEL_API_USE_CONFIGURED_TEMPERATURE` | Muse provider tuning; defaults `muse-spark-1.3`, `https://api.meta.ai/v1`, `true`, unset. |
| `REFINEMENT_DISABLED=1` | Bypasses the legal-writing refinement pass (`refinement.reason = "disabled"`). |
| `NODE_ENV` | `development` attaches `_debug` metadata to responses; `production` refuses the stand-in. |
| `WEBHOOK_SECRET` | Required for `/api/webhook` (otherwise 503). |
| `RESEND_API_KEY`, `NOTIFY_EMAIL` | Optional e-mail notification for `/api/request-access`. |
| `ERA_2025_TIME_LIMIT_COMMENCEMENT` | Override the assumed Oct 2026 ET time-limit commencement (YYYY-MM-DD). A malformed value refuses to start, as `constants.ts` throws. |
| `PORT` | Listen port (default 3000). |

Access requests are appended to `<cwd>/data/access-requests.jsonl`, exactly as
the Next.js route does.

### Running on Muse Spark

The site can run entirely on Meta's Model API with the `muse-spark-1.3`
model instead of Anthropic. Put the key in `.env.local` (never commit it):

```bash
MODEL_API_KEY=...          # from dev.meta.ai
LLM_PROVIDER=muse          # optional: it is selected automatically when ANTHROPIC_API_KEY is unset
cargo run --release --bin th-server
```

The start-up log prints `LLM provider: Meta Model API — muse-spark-1.3 via
https://api.meta.ai/v1`. Every `callClaude()` site (triage, analysis, the
Drafter/Critic/Judge debate agents, legal-writing refinement) then goes to
`POST /v1/responses` (the Responses API) with bearer-token auth. The system
prompts, user messages, JSON output contracts, citation quarantine, deadline
logic and disclaimers are unchanged — only the transport differs:

| Tribunal Harness endpoint config | Responses API request |
|---|---|
| system prompt | `instructions` (developer-level, sent on every call) |
| user message | `input: [{role:"user", content:[{type:"input_text", text}]}]` |
| `max_tokens` | `max_output_tokens` (both cover reasoning + visible output) |
| `effort` + `thinking` | `reasoning.effort`: `minimal` where extended thinking was disabled (triage, refine), otherwise `low`/`medium`/`high`/`xhigh` |
| `temperature` | not sent (Muse Spark is tuned for its defaults); `MODEL_API_USE_CONFIGURED_TEMPERATURE=1` sends the per-endpoint value |
| — | `store: false` — Meta keeps no copy of the conversation |
| — | `stream: true` — long generations avoid the non-streaming 504 limit; the terminal `response.completed` event is parsed |

A reply that stops on `max_output_tokens` is reported as the same
`response_truncated_max_tokens` error the Anthropic path raises; a `failed`
response or a non-2xx status is a typed error and the route returns 500 —
nothing is ever simulated. 429/5xx and connection errors are retried twice
with a short back-off. The single-model routing means the Haiku/Sonnet/Opus
split in `claude_config` collapses to one model; the per-endpoint labels,
prompt versions and token limits still apply. Cost estimates in `_debug`
(development only) are 0 for Muse because no price is hard-coded.

`crates/th-server/tests/muse_provider.rs` runs `/api/analyse`, `/api/triage`
and `/api/debate` against a scripted Model API (request shape validated,
SSE terminal event returned) and checks the route bodies match the stand-in
run. `crates/th-services/src/muse.rs` holds the client and its unit tests.

### Live checks (opt-in, never run by default)

```bash
RUN_LIVE_CASELAW=1 cargo test -p th-services --test live_optin -- --ignored --nocapture
RUN_LIVE_MUSE=1 MODEL_API_KEY=... cargo test -p th-services --test live_optin -- --ignored --nocapture
```

### Optional real-browser check of the UI scripts

`scripts/browser-check.js` drives the six interactive pages in headless
Chromium against a running server (consent gate → analysis → results,
adversarial debate, schema explorer, case-law search, request access, nav).
It needs `playwright-core` and a Chromium build and is a developer tool, not a
runtime or test-suite dependency:

```bash
LLM_PROVIDER=agent PORT=3123 cargo run --bin th-server &
npm i playwright-core@1.55.0   # anywhere; then set executablePath in the script if needed
BASE=http://127.0.0.1:3123 node scripts/browser-check.js
```

### Rebuilding the stylesheet

`crates/th-server/tailwind/input.css` is the Next.js `globals.css` verbatim
(plus an `@source` line and `ui-port.css`). The compiled `static/app.css` is
committed and embedded, so a fresh clone needs no Tailwind. After changing
templates or CSS, rebuild it with the Tailwind v4 standalone CLI — see
`crates/th-server/tailwind/README.md`.

## Layout

```
tribunal-harness-rs/
├── Cargo.toml / Cargo.lock       workspace (th-core, th-services, th-server)
├── crates/th-core/               pure domain logic: constants, dates, schemas, deadlines,
│                                 citation validation, Find Case Law parsing/verdicts, prompts,
│                                 model routing config, agent stand-in, refinement helpers, view models
├── crates/th-services/           async I/O behind an HttpClient trait: TNA client, Anthropic client,
│                                 Meta Model API (Muse Spark) client, PDF/DOCX extraction,
│                                 authoritative citation check, refinement, debate
├── crates/th-server/             Axum router (all /api routes, sitemap, robots, redirects, 404),
│   ├── src/ui/                   maud layout, nav/footer, 19 pages, result fragments, inline scripts
│   ├── src/bin/smoke.rs          hermetic smoke harness (port of scripts/smoke-run.ts)
│   ├── static/                   compiled app.css, fonts.css, self-hosted woff2 fonts
│   ├── tailwind/                 input.css (globals.css verbatim) + ui-port.css + build notes
│   └── tests/                    route replay, smoke comparison, page parity, fragment tests
├── fixtures/                     golden fixtures recorded from the TypeScript app (see fixtures/README.md)
├── scripts/browser-check.js      optional headless-Chromium UI check
├── AUDIT.md                      inventory of the TypeScript app that was ported
├── PARITY.md                     behaviour contract with per-row verification evidence
├── PLAN.md                       work plan / resume point
└── DECISIONS.md                  crate choices, assumptions, conflicts, follow-ups
```

CI for this directory is `.github/workflows/rust-ci.yml` (format, clippy,
locked build, hermetic tests, smoke run with the report uploaded as an
artifact, and a stylesheet drift check); the Next.js `ci.yml` is separate. The
live Find Case Law checks are a manual `workflow_dispatch` job.

## How parity was established

1. The TypeScript app was run as an oracle: its Vitest suite, its `npm run smoke`
   report, and a generator that invoked every service and every route handler
   in-process with canned upstream responses, recording inputs and outputs
   (`fixtures/`, ~14 MB, hermetic).
2. Every Rust module carries fixture-diff tests that compare serialised JSON
   byte-for-byte (key order included) with those recordings: ~12,000 deadline
   cases, 190 citation verdicts, every route request/response pair, the agent
   stand-in for every endpoint × message, the smoke report.
3. The rendered Next.js pages were captured from a production build; every
   heading and text node of each page must appear in the Rust page.

`PARITY.md` lists each feature and route with the test that verifies it and
the two items that are `[partial]` (PDF text whitespace from `pdf-extract`
versus pdf.js) or `[blocked]` (live TNA calls, unreachable from the build
sandbox; an opt-in live test is provided).
