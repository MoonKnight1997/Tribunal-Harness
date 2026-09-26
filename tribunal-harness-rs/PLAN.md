# PLAN.md — Rust rebuild of Tribunal Harness

Resume point for a fresh session: read this file, then `PARITY.md`, then run
`cargo test --workspace` and `cargo run --bin smoke`.

## Workspace layout

```
tribunal-harness-rs/
├── Cargo.toml / Cargo.lock     # workspace (rustfmt.toml: max_width 180)
├── crates/
│   ├── th-core/                # pure domain logic, no I/O
│   │   └── src/{constants,dates,schemas/*,types,deadlines,qualifying_period,
│   │            verified_authorities,citation_validator,find_case_law,
│   │            analyse_contract,prompts,claude_config,agent_provider,jsnum,
│   │            refinement,rate_limit,ui_view/*,seed_cases,tracker,roadmap}.rs
│   ├── th-services/            # async I/O behind traits: HttpClient (reqwest / mock)
│   │   └── src/{http,tna,anthropic,claude_client,pdf_to_markdown,docx,
│   │            citation_authority,refinement,debate,request_access}.rs
│   └── th-server/              # Axum app: API routes, maud pages, embedded static assets
│       ├── src/{main,app,config,state,query,jsval,smoke,testkit,routes/*,ui/*,bin/smoke}.rs
│       ├── static/             # app.css (Tailwind standalone build), fonts.css, fonts/*.woff2
│       ├── tailwind/           # input.css (globals.css verbatim) + ui-port.css + README
│       └── tests/              # routes.rs, smoke.rs, pages.rs (+ common/)
├── fixtures/                   # golden fixtures from the TypeScript app (see fixtures/README.md)
├── scripts/browser-check.js    # optional headless-Chromium check of the inline UI scripts
└── AUDIT.md PARITY.md PLAN.md DECISIONS.md README.md
(CI: ../.github/workflows/rust-ci.yml — separate from the Next.js ci.yml)
```

## Order of work (checklist)

- [x] 1. Audit the TypeScript app → `AUDIT.md`
- [x] 2. Oracle: Vitest baseline, smoke report, differential fixtures → `fixtures/`
- [x] 3. Contract → `PARITY.md`
- [x] 4. This plan
- [x] 5. Core (`th-core`), each with fixture-diff tests:
  - [x] 5.1 `dates` (civil-date arithmetic, weekday, ISO parse/format, "today")
  - [x] 5.2 `constants` (+ override validation) and `types`
  - [x] 5.3 `schemas` (10 files + registry), serialised field order = TS
  - [x] 5.4 `deadlines`, `qualifying_period`
  - [x] 5.5 `verified_authorities`, `citation_validator` (offline), `find_case_law` (pure parse/verify)
  - [x] 5.6 `analyse_contract`, `prompts`, `claude_config`, `agent_provider`, `rate_limit`
  - [x] 5.7 `refinement` path helpers, `ui_view` (debate modes, results view), `seed_cases`, `tracker`, `roadmap`
- [x] 6. Services (`th-services`): `HttpClient` trait + reqwest + mock; TNA client; Anthropic Messages client and `call_claude`; PDF (pdf-extract) and DOCX (zip + quick-xml); authoritative citation validation; refinement; debate engine; request-access persistence + Resend — fixture-diff tests in `tests/fixtures_services.rs`
- [x] 7. Server (`th-server`): Axum router with identical paths/payloads; `AppState`; route replay tests against `fixtures/routes/responses.json` (`tests/routes.rs`); `smoke` binary + comparison with the TS report (`tests/smoke.rs`)
- [x] 8. UI: maud layout (NavBar, Footer), 19 pages + 3 redirects, consent gate + disclaimers, inline JS for the 6 interactive pages, `/_ui/fragments/*` result renderers, Tailwind standalone build of `globals.css`, self-hosted fonts; page parity tests (`tests/pages.rs`); real-browser check (`scripts/browser-check.js`, 23/23)
- [x] 9. Verify every `PARITY.md` row; Verified column filled with evidence
- [x] 10. Hand-off: `README.md` (this directory + a section in the repo README), `.github/workflows/rust-ci.yml` (adopted), opt-in live test, PR against this fork's `main`
- [x] 11. (post-parity request) Muse Spark provider: `th-services/src/muse.rs` (Meta Model API, Responses endpoint, SSE), `LLM_PROVIDER=muse` / `MODEL_API_KEY` in `claude_client`, end-to-end route test against a scripted Model API (`th-server/tests/muse_provider.rs`), opt-in live call (`RUN_LIVE_MUSE=1`), README section, DECISIONS assumption 22

## Running

```bash
cd tribunal-harness-rs
cargo test --workspace            # hermetic; no network, no key (96 tests)
cargo run --bin smoke             # LLM_PROVIDER=agent end-to-end, writes smoke-report.{json,md}
cargo run --bin th-server         # http://localhost:3000
```

Environment variables honoured (same names as the TypeScript app):
`ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `REFINEMENT_DISABLED`, `WEBHOOK_SECRET`,
`RESEND_API_KEY`, `NOTIFY_EMAIL`, `ERA_2025_TIME_LIMIT_COMMENCEMENT`,
`NODE_ENV` (only `production`/`development` are meaningful), `PORT`.

## What is still open (see the PR summary and DECISIONS.md follow-ups)

- Live TNA and Anthropic calls could not be exercised from the build sandbox
  (no route to either host); the offline paths are fixture-verified and an
  opt-in live test exists. First deployment should run it.
- PDF text extraction is `pdf-extract`, not pdf.js: same words, different
  whitespace. Evaluate on real judgment PDFs before relying on it for triage.
- The Muse Spark provider has not been run against the real Model API from
  the sandbox (host blocked). Run the opt-in live test with a key, then a real
  analysis and debate, before switching production to it.
