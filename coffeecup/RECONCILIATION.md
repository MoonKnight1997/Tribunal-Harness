# coffeecup ↔ Tribunal Harness — Reconciliation

> Captured 24 September 2026. How the coffeecup plan ([`PRODUCT-PLAN.md`](./PRODUCT-PLAN.md),
> [`ARCHITECTURE.md`](./ARCHITECTURE.md)) relates to the existing code in
> `../tribunal-harness/`, what carries over, what conflicts, and what needs a founder
> decision before any code is written.

## 1. Decisions that need founder sign-off

Per the root `CLAUDE.md` ("Open Design Decisions — do not make unilateral choices"),
none of these have been actioned. Each conflicts with something currently recorded
as settled.

| # | Decision | Current repo position | coffeecup position | Recommendation |
|---|---|---|---|---|
| C1 | **LLM provider** | Decision #5 **RESOLVED**: Claude hub-and-spoke via `src/lib/claude-config.ts` | Meta Muse Spark 1.3, Standard tier only | Re-open #5 explicitly. Add Muse as a second provider behind the existing `LLM_PROVIDER` switch rather than ripping out Claude, so both can be A/B'd on the same fixtures. |
| C2 | **Backend language** | Next.js 15 / TypeScript, 193+ Vitest tests | Rust (Axum, SQLx, Tokio) | Start Rust with the pure, LLM-free core (deadline engine, domain types, workflow FSM) as a library crate, ported against the TS test suite as a golden master. Keep Next.js as the UI and API shell until the Rust core proves out. |
| C3 | **Product identity / audience** | "Tribunal Harness" — ET legal intelligence engine for LiPs, claim-first | "coffeecup" — workplace-problem case companion, case-first, tribunal is downstream | Decide whether coffeecup is a rebrand, a sibling consumer product sharing the engine, or a replacement. This drives C2, C6, and the marketing site. |
| C4 | **Database / auth** | Open decisions #3 (auth) — Supabase Postgres listed but not built | PostgreSQL + "appropriate secure authentication" (Phase A) | Postgres is consistent. Auth provider remains open. |
| C5 | **Case law** | Live lookup from TNA Find Case Law (`docs/live-case-law.md`) | Curated/licensed case law ranked 5th; statute + GOV.UK + Acas first | Compatible. The TNA client (`src/services/find-case-law.ts`) can sit behind `get_official_source`. |
| C6 | **Pricing** | Existing `/pricing` page | £6.99 Case Pass, £9.99 Claim Pack, no subscription | Needs sign-off; payments provider (Stripe named in the architecture) not yet chosen. |
| C7 | **FCA / claims-management perimeter** | `/api/analyse` **already** identifies personalised claims today, ungated | Personalised claim identification behind `ENABLE_PERSONALISED_CLAIM_IDENTIFICATION`, off until an FCA perimeter opinion is on file | **Highest priority.** The plan's own reasoning applies to the current live app, not only to coffeecup. Consider gating the existing analyse flow now, pending the opinion. |

## 2. What carries over from Tribunal Harness

| coffeecup component | Existing asset | Notes |
|---|---|---|
| Deadline Rules Engine (Phase E) | `tribunal-harness/src/services/deadline-calculator.ts` + 51 tests | Regime selection by act date, ACAS EC clock-stop (Day A/Day B, one-month floor), non-working-day **warning without moving the date** (July 2026 founder decision). Port the tests first. |
| Qualifying-period check ("Applicable service rule — deterministic check") | `src/services/qualifying-period.ts` | Already deterministic and tested. |
| Commencement metadata | `src/lib/constants.ts` (`ERA_2025`, `TBC_COMMENCEMENT_KEYS`, `TIME_LIMIT_CONFIG`) | Seed data for the legal-source/rule registry. |
| Claim schemas (Phase H) | `src/schemas/*.ts` — all 10 claim types | Become `ClaimElement` definitions; intake flips from claim-first to `Case → facts → triggers → elements`. |
| Critic pass (claim pipeline pass 3) | `/api/debate` 3-agent Drafter/Critic/Judge engine, `src/agents/prompts.ts` | The anti-fabrication Critic prompt is directly reusable; the Judge's 100-point score must **not** surface to users (plan forbids numeric success prediction). |
| Validator (pass 4) | `src/services/citation-validator.ts`, `src/lib/verified-authorities.ts` | VERIFIED / CHECK / QUARANTINED trust states are for **legal citations**; coffeecup's `FactStatus` is for **case facts**. Keep both — they are complementary. |
| Official source fetching | `src/services/pdf-to-markdown.ts` (allowlisted, SSRF-safe), `find-case-law.ts` | Backs `get_official_source`. |
| Offline/hermetic testing | `src/lib/llm/agent-provider.ts`, `LLM_PROVIDER=agent`, `npm run smoke` | Pattern to copy for a Muse stand-in so the domain and pipeline are testable without network. |
| Rate limiting (Phase J) | `src/lib/rate-limit.ts` | |
| Disclaimers / GDPR Art. 9 consent gate | Existing UI | coffeecup still needs both; add the 18+ gate before the consent gate. |

## 3. Points of friction to resolve during migration

1. **`ET_DEADLINE_MONTHS = 6` anti-pattern.** The plan forbids a bare months constant.
   `TIME_LIMIT_CONFIG` currently has `PRE_ERA_2025_MONTHS: 3` / `POST_ERA_2025_MONTHS: 6`
   alongside a single `COMMENCEMENT_DATE`. It works for one E&W transition but must
   become per-rule records (`claim rule`, `trigger event`, `jurisdiction`,
   `effective_from`, `base_limit`, `source`) to support Scotland's differing
   breach-of-contract commencement and future changes.

2. **1 October 2026 status.** The plan states the six-month limit takes effect on
   1 October 2026. The repo still has `TIME_LIMIT_SI_CONFIRMED: false` and flags the date
   TBC, so the calculator hedges to the shorter 3-month result for acts on/after it.
   **Not changed here:** confirm the commencement SI (number and wording, including the
   transitional rule for pre-commencement acts) before flipping the flag in
   `constants.ts`. Hard Rule 4 (deadline conservatism) applies until then.

3. **Jurisdiction.** The current calculator is England & Wales only (Hard Rule 5).
   coffeecup needs `Jurisdiction::{EnglandWales, Scotland, NorthernIreland}`; NI must
   route away from the GB ET framework rather than silently reuse it.

4. **PDF handling.** The inner `CLAUDE.md` requires converting PDFs to Markdown before an
   LLM reasons over them. Muse accepts PDFs natively, but the plan's provenance chain
   (`original → extracted content → propositions → confirmed facts`) still needs a stored
   extraction layer — keep the Markdown/text extraction step and pass Muse both, or
   decide explicitly.

5. **Acas Code versioning.** Nothing in the repo models source status. The registry needs
   `effective_from` / `effective_to` and `draft` / `current` / `superseded`, with the 2026
   replacement Code held as `draft` until it takes effect (expected 2027).

6. **Model routing table.** The per-endpoint Claude table (Haiku/Sonnet/Opus with thinking
   budgets) maps onto Muse effort levels roughly as: triage → `minimal`/`low`; analyse
   standard → `medium`; analyse complex → `high`; debate critic/judge → `xhigh`
   (flag-gated). Config must be runtime-switchable (no deploy to disable a feature).

7. **Workflow FSM.** Root `CLAUDE.md` Pillar 3 lists tribunal-procedure states
   (`PRE_ACTION → … → COA_HEARING`). coffeecup's `CaseStage` starts earlier (workplace
   problem, grievance, disciplinary) and stops at ET1 preparation. The two should
   compose: `CaseStage` for the worker journey, the existing FSM for post-ET1 procedure.

## 4. Suggested first slice (once C1–C3 are decided)

1. `coffeecup-core` Rust library crate: `Jurisdiction`, `CaseStage`, `FactStatus`,
   `ProposedFact` / `ConfirmedFact` (confirmation-only constructor), `LegalRule` with
   effective-date metadata, and `calculate_deadline` ported from the TS calculator.
2. Golden-master test harness: export every TS deadline test case to JSON fixtures and run
   them against both implementations until they agree.
3. Grievance workflow FSM with transition tests.
4. Only then: Axum shell, Postgres schema, and the Muse client + Case Context Compiler.
