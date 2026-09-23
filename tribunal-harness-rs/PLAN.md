# PLAN.md — Rust rebuild of Tribunal Harness

Resume point for a fresh session: read this file, then `PARITY.md`, then run
`cargo test --workspace` and `cargo run --bin smoke`.

## Workspace layout

```
tribunal-harness-rs/
├── Cargo.toml                  # workspace
├── crates/
│   ├── th-core/                # pure domain logic, no I/O
│   │   └── src/{constants,dates,schemas/*,types,deadlines,qualifying_period,
│   │            verified_authorities,citation_validator,find_case_law,
│   │            analyse_contract,prompts,claude_config,agent_provider,
│   │            refinement,rate_limit,ui_view/*,seed_cases,tracker,roadmap}.rs
│   ├── th-services/            # async I/O behind traits: HttpClient (reqwest / mock),
│   │   └── src/{http,tna,anthropic,claude_client,pdf_to_markdown,docx,
│   │            citation_authority,refinement,debate,request_access}.rs
│   └── th-server/              # Axum app: API routes, maud pages, static assets
│       └── src/{main,app,state,routes/*,ui/*,bin/smoke}.rs
├── static/                     # app.css (built by Tailwind standalone CLI), robots.txt
├── tailwind/                   # input.css + build script
├── fixtures/                   # golden fixtures from the TypeScript app (see fixtures/README.md)
├── ci/                         # proposed GitHub workflow (not wired up)
└── AUDIT.md PARITY.md PLAN.md DECISIONS.md README.md
```

## Order of work (checklist)

- [x] 1. Audit the TypeScript app → `AUDIT.md`
- [x] 2. Oracle: Vitest baseline, smoke report, differential fixtures → `fixtures/`
- [x] 3. Contract → `PARITY.md`
- [x] 4. This plan
- [ ] 5. Core (`th-core`), in this order, each with fixture-diff tests:
  - [ ] 5.1 `dates` (civil-date arithmetic, weekday, ISO parse/format, "today")
  - [ ] 5.2 `constants` (+ override validation) and `types`
  - [ ] 5.3 `schemas` (10 files + registry), serialised field order = TS
  - [ ] 5.4 `deadlines`, `qualifying_period`
  - [ ] 5.5 `verified_authorities`, `citation_validator` (offline), `find_case_law` (pure parse/verify)
  - [ ] 5.6 `analyse_contract`, `prompts`, `claude_config`, `agent_provider`, `rate_limit`
  - [ ] 5.7 `refinement` path helpers, `ui_view` (debate modes, results view), `seed_cases`, `tracker`, `roadmap`
- [ ] 6. Services (`th-services`): `HttpClient` trait + reqwest + mock; TNA client; Anthropic Messages client and `call_claude`; PDF (pdf-extract) and DOCX (zip + quick-xml); authoritative citation validation; refinement; debate engine; request-access persistence + Resend
- [ ] 7. Server (`th-server`): Axum router with identical paths/payloads; `AppState` (config, clock, http client, rate limiters); route replay tests against `fixtures/routes/responses.json`; `smoke` binary
- [ ] 8. UI: maud layout (NavBar, Footer), 19 pages + 3 redirects, consent gate + disclaimers, inline JS for the 6 interactive pages, Tailwind standalone build of `globals.css`
- [ ] 9. Verify every `PARITY.md` row; fill the Verified column with evidence
- [ ] 10. Hand-off: README section, `ci/rust-ci.yml` proposal, PR against this fork's `main` if permitted

## Running

```bash
cd tribunal-harness-rs
cargo test --workspace            # hermetic; no network, no key
cargo run --bin smoke             # LLM_PROVIDER=agent end-to-end, writes smoke-report.{json,md}
cargo run --bin th-server         # http://localhost:3000
```

Environment variables honoured (same names as the TypeScript app):
`ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `REFINEMENT_DISABLED`, `WEBHOOK_SECRET`,
`RESEND_API_KEY`, `NOTIFY_EMAIL`, `ERA_2025_TIME_LIMIT_COMMENCEMENT`,
`NODE_ENV` (only `production`/`development` are meaningful), `PORT`.
