# Decision log (single current record)

One line per decision that shapes the product. Older planning documents
(`../PRODUCT-PLAN.md`, `../ARCHITECTURE.md`, `../RECONCILIATION.md`) are
historical; if they disagree with this file, this file wins.

| # | Date | Decision | Status | Where it is enforced |
|---|---|---|---|---|
| D1 | 2026-09-24 | The active product is the Next.js/TypeScript coffeecup app in `coffeecup/`. The former Tribunal Harness app was removed. | Decided | root `README.md`, `CLAUDE.md` |
| D2 | 2026-09-27 | No Rust rewrite. `tribunal-harness-rs/` is an archived reference of the *old* app with no parity relationship to coffeecup; `rust-ci.yml` keeps it compilable only. A port would be a fresh decision after the review findings are closed. | Decided | `tribunal-harness-rs/README.md` banner |
| D3 | 2026-09-24 | Case, not chat: the `Case` record is authoritative; model output is a proposal until the user confirms it. | Decided | `src/facts`, `src/timeline`, `docs/PRODUCT.md` |
| D4 | 2026-09-24 | Deadlines are deterministic and versioned by event date; an LLM never calculates a limitation date; missing data is `uncertain`. | Decided | `src/legal/deadlines`, `src/legal/rules` |
| D5 | 2026-09-27 | A pending Acas conciliation (Day A known, Day B unknown) is a distinct `pending_acas` state, never an unqualified expired deadline; Day B is receipt/deemed receipt, with the issue date used only as a labelled conservative assumption. | Decided (review F05) | `src/legal/deadlines/engine.ts` |
| D6 | 2026-09-27 | Legal commencement dates change only through the source-to-rule register with a cited instrument; a policy timetable is a lead, not an amendment. Unverified items stay conservative and visibly unresolved. | Decided (review F08) | `src/legal/rules/register.ts`, `docs/LEGAL_SOURCE_GOVERNANCE.md` |
| D7 | 2026-09-27 | Artifact generation policy (which flags and tier each document type needs) lives in one table and is enforced inside the generation service, not only at named routes. | Decided (review F07) | `src/artifacts/policy.ts` |
| D8 | 2026-09-24 | Regulatory flags default off; enabling personalised claim identification or ET1 drafting publicly needs regulatory review first. | Open (needs human decision) | `src/flags` |
| D9 | 2026-09-24 | Public brand name, domain and operator entity. | Open | `src/brand/config.ts` |
| D10 | 2026-09-24 | Payment provider go-live and final prices. | Open | `src/payments/pricing.ts` |
| D11 | 2026-09-24 | Whether Find Case Law judgment text may be processed computationally (licensing). Keep `ENABLE_CASELAW_LLM_ANALYSIS` off until confirmed. | Open | `src/flags` |
| D12 | 2026-09-27 | Basic data portability (a JSON export of the user's own record) is never paywalled; only generated documents may be entitlement-gated. | Decided (review §6) | `src/exports/service.ts` |
| D13 | 2026-09-27 | No outcome scores, percentages or strength language anywhere; deterministic checks flag such wording for review, they do not certify correctness. | Decided | `src/legal/claims/language.ts`, `src/artifacts/checks.ts` |
| D14 | 2026-09-27 | OCR is optional and local (binary present on the host); documents are never sent to a networked extraction service. | Decided (review F11) | `src/documents/extract/ocr.ts` |

## How to add a decision

Append a row; if it supersedes an earlier one, say so in the Status column
("Supersedes D3"). Keep it to what was decided, not the discussion.
