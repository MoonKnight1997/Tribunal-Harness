# AUDIT.md — inventory of the TypeScript production app

Scope: `tribunal-harness/` (Next.js 15 App Router). Every entry below was
grounded by opening the file named. The Vite prototype at the repository root
is out of scope. Line counts are from `wc -l` on 23 September 2026 at commit
`36aecfb`.

Legend for the **Rust** column: crate/module in `tribunal-harness-rs/` that
ports the item.

## 1. Configuration and entry points

| File | Purpose | Depends on | Rust |
|---|---|---|---|
| `package.json` | scripts: `dev`, `build`, `start`, `lint`, `test` (Vitest, `TMPDIR=/tmp`), `smoke` (`LLM_PROVIDER=agent tsx scripts/smoke-run.ts`). Deps: `@anthropic-ai/sdk`, `mammoth`, `pdf-parse`, `next`, `react`, `framer-motion`, `lucide-react`, `clsx`, `tailwind-merge`. | — | `Cargo.toml` workspace; `README.md` |
| `vitest.config.ts` | node env, `src/**/*.test.ts`, setup file, `@` alias | `src/test/setup.ts` | `cargo test` |
| `src/test/setup.ts` | snapshots `process.env` per test; strips `ERA_2025_TIME_LIMIT_COMMENCEMENT` and `ANTHROPIC_API_KEY` | — | tests never read ambient env: config is passed explicitly |
| `tsconfig.json` | strict, `@/*` → `./src/*` | — | — |
| `next.config.ts` | `outputFileTracingRoot`, `serverExternalPackages: ["pdf-parse"]` | — | — |
| `.env.example` | `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `NOTIFY_EMAIL`, `WEBHOOK_SECRET`, `ERA_2025_TIME_LIMIT_COMMENCEMENT` | — | `th-server` env loading (`dotenvy`) |
| `scripts/smoke-run.ts` (745) | in-process smoke harness: 7 sections (`schema_lookup`, `triage`, `analyse`, `deadlines`, `case_law_search`, `era_2025_tracker`, `debate`), writes `smoke-report.{json,md}`, exit 0 iff all OK | every API route | `th-server` bin `smoke` |
| `.github/workflows/ci.yml` (repo root) | npm ci, lint, tsc, test, build in `tribunal-harness/` | — | proposed `ci-rust.yml` (not applied, see hand-off) |

## 2. `src/lib` — constants, LLM config, client, utilities

| File | Exports | Depends on | Rust |
|---|---|---|---|
| `lib/constants.ts` (439) | `ERA_2025` (21 keys, 4 `null`), `ERA_2025_TRACKER` (21 rows, `tbc` flag), `isValidIsoDate`, `resolveTimeLimitCommencement(override)` (throws on malformed), `TIME_LIMIT_CONFIG` (3/6 months, `COMMENCEMENT_DATE` from env at module load, `TIME_LIMIT_SI_CONFIRMED:false`), `QUALIFYING_PERIOD_CONFIG` (2y/6m, `2027-01-01`), `CLAIM_TYPES` (10, with `effectiveFrom` on fire-and-rehire / zero-hours), `FSM_STATES` (16), `formatCommencementDate` ("1 January 2027"), `formatCommencementMonth` ("January 2027"), `TBC_COMMENCEMENT_KEYS`, `isCommencementTbc`, `formatCommencementLabel` | `process.env.ERA_2025_TIME_LIMIT_COMMENCEMENT` | `th-core::constants` |
| `lib/claude-config.ts` (244) | `CLAUDE_MODELS` {OPUS `claude-opus-4-8`, SONNET `claude-sonnet-5`, HAIKU `claude-haiku-4-5-20251001`}, `ENDPOINT_CONFIG` (triage, analyse, analyse_complex, drafter, critic, judge, refine), `PRICING`, `USD_TO_GBP=0.79`, `estimateCost` (4 dp rounding), `getEndpointConfig` (warns + falls back to `analyse`) | — | `th-core::claude_config` |
| `lib/claude-client.ts` (285) | `isClientAvailable()` (`LLM_PROVIDER=agent` or key), `ClaudeTruncatedResponseError` (code `response_truncated_max_tokens`), `callClaude({endpoint, system, userMessage, promptVersion, configOverride})` → `ClaudeCallResult | null`; agent path refuses when `NODE_ENV=production`; real path builds Messages request (`model`, `max_tokens`, `system`, `messages`, optional `temperature`; if thinking enabled: `thinking:{type:"enabled",budget_tokens}` clamped to `max_tokens-1` and `temperature` deleted); throws on `stop_reason==="max_tokens"`; takes first `text` block; logs cost line | `@anthropic-ai/sdk`, `claude-config`, `llm/agent-provider` | `th-services::claude_client` (+ `anthropic` HTTP client) |
| `lib/llm/agent-provider.ts` (400) | `AGENT_STAND_IN_MODEL="agent-stand-in"`, `VERIFIED_CITES` (Polkey, Burchell, Iceland), `extractClaimType` (regex `/claim[_ ]?type:\s*([a-z][a-z_]*)/i`, default `unfair_dismissal`), `extractFacts`, `detectClaimTypes`, `synthAnalyse/Triage/Drafter/Critic/Judge/Refine`, `generateAgentResponse`, `estimateTokens` (`ceil(len/4)`, min 1) | `schemas`, `constants` | `th-core::agent_provider` |
| `lib/verified-authorities.ts` (367) | `VerifiedAuthority`, `VERIFIED_AUTHORITIES` (24), `findAuthorityByShortName` (case-insensitive exact), `findAuthorityByPartialMatch` (first authority whose shortName or fullName is a substring) | — | `th-core::verified_authorities` |
| `lib/rate-limit.ts` (82) | `clientKeyFromRequest` (last XFF hop, else `unknown-ip`), `createRateLimiter({windowMs,maxRequests})` fixed window with eviction | `next/server` types | `th-core::rate_limit` |
| `lib/ui-utils.ts` (10) | `cn()` = `twMerge(clsx(...))` | `clsx`, `tailwind-merge` | not ported (React class merging has no equivalent in server-rendered maud; see DECISIONS) |

Tests: `constants.test.ts` (198), `claude-config.test.ts` (135), `claude-client.test.ts` (231, mocks SDK), `rate-limit.test.ts` (60), `verified-authorities.test.ts` (94), `ui-utils.test.ts` (39).

## 3. `src/agents/prompts.ts` (450)

`PROMPT_VERSIONS` {ANALYSE `ANALYSE_PROMPT_v2`, TRIAGE, DRAFTER, CRITIC, JUDGE, REFINEMENT `v1`}, `REFINEMENT_PROMPT_VERSION`, `commencement(key)` helper (TBC keys render as "October 2026 (exact date TBC by SI)", null keys as "a date to be confirmed by Statutory Instrument"), `ANALYSE_PROMPT_v2`, `TRIAGE_PROMPT_v2`, `DRAFTER_PROMPT_v2`, `CRITIC_PROMPT_v2`, `JUDGE_PROMPT_v2`, legacy `*_PROMPT_v1` (5), `LEGAL_WRITING_REFINEMENT_PROMPT_v1`. Depends on `constants`. Test `prompts.test.ts` (52). Rust: `th-core::prompts` (byte-equal, verified against `fixtures/prompts/prompts.json`).

## 4. `src/schemas`

| File | Content | Rust |
|---|---|---|
| `types.ts` (223) | `SchemaField`, `ERA2025Annotation`, `ERAFlagStatus`, `TrustLevel`, `ClaimStrength`, `ClaimSchema`, `AnalyseRequest` (`consent`), `AnalyseResponse`, `LegalTestElement`, `ClaimAnalysis`, `Authority` (+ enrichment fields), `StatutoryProvision`, `ERA2025Flag`, `DeadlineRequest/Response/Result`, `TriageResponse/Query`, `RequestAccessData`, `ERA2025TrackerEntry` | `th-core::types` |
| `index.ts` (36) | `SCHEMAS` registry (insertion order = `CLAIM_TYPES` order), `getSchema` (null on unknown), `getAllSchemas` | `th-core::schemas` |
| `unfair-dismissal.ts` (159) | 9 fields, 5 legalTest, 4 keyAuthorities, 4 era2025Changes (formatted months) | `th-core::schemas::unfair_dismissal` |
| `direct-discrimination.ts` (47), `indirect-discrimination.ts` (36), `harassment.ts` (81), `victimisation.ts` (32), `reasonable-adjustments.ts` (44), `whistleblowing.ts` (70), `wrongful-dismissal.ts` (31), `fire-and-rehire.ts` (52), `zero-hours-rights.ts` (48) | the other 9 schemas; harassment/whistleblowing/fire-and-rehire/zero-hours carry `era2025` annotations (zero-hours uses `"TBC (SI awaited)"` for the null date) | same module, one file each |
| `analyse-contract.ts` (199) | `isRecord`, `asString/asBool/asArray/pick`, `normaliseStrength` (default WEAK), `normaliseTrustLevel` (default QUARANTINED), `normaliseFlagStatus` (default tbc), `normaliseElement/Claim/Authority/StatutoryProvision/Flag`, `normaliseAnalyseResponse` | `th-core::analyse_contract` |

Tests: `schema-integrity.test.ts` (58), `analyse-contract.test.ts` (160).

## 5. `src/services`

| File | Exports / behaviour | Depends on | Rust |
|---|---|---|---|
| `deadline-calculator.ts` (510) | `parseUTC` (strict YYYY-MM-DD, rejects overflow), `toISODate`, `UK_BANK_HOLIDAYS_EW` (32 dates 2025–2028), `isNonWorkingDay`, `previousWorkingDay`, `addMonthsLessOneDay` (corresponding-date rule), `addMonths` (clamped), `computeOne` (ACAS s.207B: no revival if Day A > base; inverted B<A uses A; gap added; max with 1 month from Day B; floor at base; `days_remaining` from UTC midnight today), `calculateDeadline`, `calculateDeadlines` (F-3 hedge: two entries per claim when act ≥ commencement and SI unconfirmed; 7 warning kinds in fixed order) | `constants.TIME_LIMIT_CONFIG`, `formatCommencementMonth` | `th-core::deadlines` |
| `qualifying-period.ts` (134) | `parseUTCStrict`, `completeMonthsBetween`, `qualifyingPeriod(start, edt)` → regime by EDT vs `2027-01-01`; note text; `autoUnfairMayApply:true` | `QUALIFYING_PERIOD_CONFIG` | `th-core::qualifying_period` |
| `citation-validator.ts` (340) | `extractNeutralCitation` (regex allows `_`), `citationsEqual`, `resolveNameMatch` (VERIFIED only on exact normalised citation), `validateCitation` (first word → 4/3/2-word prefixes → partial), `validateAllCitations` (summary with `verifiedPercentage` rounded), `validateCitationAuthoritative` (curated VERIFIED short-circuits; else live `verifyCitation`; `unavailable` fallback; `higherTrust` merge; `source` enum), `validateAllCitationsAuthoritative` (`liveChecks` count) | `verified-authorities`, `find-case-law` | `th-core::citation_validator` (offline) + `th-services::citation_authority` (async) |
| `find-case-law.ts` (417) | `TNA_BASE`, timeout 12 s, `USER_AGENT`, `decodeEntities`, `normaliseCitation` (lowercase, strip non-alphanumerics), `BOILERPLATE_PARTY_TOKENS`, `significantPartyTokens`, `extractNeutralCitation` (no `_`), `parseAtomFeed(xml, limit)` (regex over `<entry>`, `<tna:identifier type="ukncn" slug>`, bare `rel="alternate"` link fallback, `<author><name>`, `<published>`, `totalResults`), `fetchAtom` (`/atom.xml?query&page[&court][&party]`), `statusForResponse`, `searchCaseLaw` (limit clamp 1..50, envelope statuses), 1-hour `verifyCache`, `verifyCitation` (exact NCN match + party-token cross-check → VERIFIED/CHECK; name hit or first result → CHECK; empty → QUARANTINED; upstream failure → `unavailable`), `_clearVerifyCache`, `getJudgmentMarkdown(slug)` (`/<slug>/data.pdf` via `fetchPdfAsMarkdown`) | global `fetch`, `pdf-to-markdown` | `th-core::find_case_law` (pure parse/verify logic) + `th-services::tna` (HTTP) |
| `pdf-to-markdown.ts` (177) | `ALLOWED_HOSTS` (5), 20 MB cap, 20 s timeout, `tidyToMarkdown`, `looksLikePdf`, `pdfBufferToMarkdown` (pdf-parse; `empty` when no text), `isAllowedPdfUrl` (https + host allowlist), `fetchPdfAsMarkdown` (manual redirects ≤5, re-validated; 429/5xx → `upstream_unavailable`; content-length + body caps) | `pdf-parse`, global `fetch` | `th-services::pdf_to_markdown` (`pdf-extract` crate; see PARITY [partial]) |
| `legal-writing-refinement.ts` (458) | `ENDPOINT_PROSE_FIELDS` (analyse 6, triage 3, debate 20 templates), `parsePath`, `expandPath`, `getByPath`, `setByPath`, `collectProseFields`, `sameKeys`, `spliceRefinedFields` (structuredClone), `parseClaudeJson` (strips ``` fences), `refineForUser(endpoint, payload)` → `{payload, refinement:{applied, source?, changes?, error?, reason?}}`; kill switch `REFINEMENT_DISABLED=1`; `source` = `agent-stand-in` when `LLM_PROVIDER=agent` else `claude-sonnet` | `claude-client`, `prompts` | `th-core::refinement` (paths) + `th-services::refinement` (async) |
| `api-routes.test.ts` (473) | integration tests for deadlines, schema, analyse degraded, case-law search, request-access | routes | ported as Rust route tests + fixture diffs |

Other tests: `deadline-calculator.test.ts` (451), `citation-validator.test.ts` (206), `find-case-law.test.ts` (186), `legal-writing-refinement.test.ts` (198), `pdf-to-markdown.test.ts` (141), `qualifying-period.test.ts` (96).

## 6. `src/app/api` — HTTP routes (request/response shapes are the contract)

| Route | Method | Behaviour (status → body) | Depends on | Rust |
|---|---|---|---|---|
| `analyse/route.ts` (395) | POST | 429 `{error}` rate limit (10/h per last-XFF-hop); 400 `claim_type is required`; 400 `Unknown claim type: X`; 400 consent (`consent !== true`); consent audit log (sha256 prefix, no PII); 400 narrative > 50 000; 400 narrative mode < 50 trimmed chars; no client → 200 degraded body (`error`, `message`, empty claims/authorities, statutory_provisions from schema, procedural_notes with numbered legal test, `era_2025_flags` via `deriveDegradedFlagStatus` (month label reverse-map; commenced ⇒ `in_force`; TBC ⇒ `tbc`; else `upcoming`; unknown ⇒ `tbc` + "See implementation tracker"), `refinement:{applied:false, reason:"llm-unavailable"}`); else `callClaude` with `analyse`/`analyse_complex` (`complexity:"high"`), parse JSON, `validateAllCitationsAuthoritative`, per-authority enrichment (`citation_corrected` via neutral-cite comparison, `original_citation`, `verified`, `trust_level`, `validation_reason`, `matched_case`, `matched_citation`, `source_url`, `verification_source`), `quarantine_summary`, `normaliseAnalyseResponse`, strip QUARANTINED → `quarantined_count`, `_debug` only when `NODE_ENV=development`, `refineForUser("analyse")`, attach `refinement`; JSON parse failure → fallback body (`procedural_notes:[content]`, `raw_analysis`, `quarantined_count:0`) also refined; any throw → 500 `{error:"Internal server error", request_id}` | schemas, constants, citation-validator, find-case-law, analyse-contract, prompts, claude-client, refinement, rate-limit | `th-server::routes::analyse` |
| `triage/route.ts` (161) | POST multipart | 400 no `document`; 400 non-File `document`; 413 > 10 MB; `.txt`/`.pdf`/`.docx` by lowercased name else 400; 422 on PDF/DOCX parse failure; no client → 200 degraded (`extracted_text` ≤ 5000, summary "Extracted N characters from NAME. AI triage requires an Anthropic API key.", `refinement:{applied:false, reason:"llm-unavailable"}`); else `callClaude("triage")` with `Current schema state: <schema_state|none>\n\nDocument text:\n<first 10 000 chars>`, JSON parse, `refineForUser("triage")`; fallback body on non-JSON; catch → 500 `{error, details:String(error)}` | prompts, claude-client, refinement, pdf-parse, mammoth | `th-server::routes::triage` |
| `deadlines/route.ts` (143) | POST | `dateOfAct = effective_date_of_termination || date_of_last_act`; 400 missing; 400 not a real YYYY-MM-DD in 1990..2100 (message includes `JSON.stringify` of value); 400 empty/missing `claim_types`; 400 one ACAS date only; 400 each ACAS date invalid; 400 `acas_day_b < acas_day_a` (string compare); 200 `calculateDeadlines`; catch → 500 `{error:"Internal server error while calculating deadlines.", request_id}` | deadline-calculator | `th-server::routes::deadlines` |
| `schema/[claimType]/route.ts` (41) | GET | 200 schema JSON; 404 `{error:"Unknown claim type: X", available_types:[10]}` | schemas | `th-server::routes::schema` |
| `case-law/search/route.ts` (340) | GET | `SEED_CASES` (20 entries, 2 with formatted ERA dates), `scoreCase` (name +10, summary +5, citation +8, claim type +6, binding +2, statutory +1, year≥2020 +1), `limit` parseInt default 10 clamp 1..20, 400 if neither `q` nor `claim_type`, tier filter, claim filter, score>0 sort desc slice; body `{query, claim_type, total, data_source:"seed_v1", note, results}` | constants | `th-server::routes::case_law_search` |
| `case-law/find/route.ts` (43) | GET | 400 no `q`/`query`; `court`, `limit` parseInt default 10 clamp 1..50 (NaN → 10); 200 `searchCaseLaw` envelope | find-case-law | `th-server::routes::case_law_find` |
| `case-law/judgment/route.ts` (31) | GET | 400 no `slug`; 200 `getJudgmentMarkdown` | find-case-law | `th-server::routes::case_law_judgment` |
| `era-2025/tracker/route.ts` (83) | GET | `{changes:[...]}` derived from `ERA_2025_TRACKER` + `API_METADATA` (`tool_status`, `notes`; default `planned`/`""`) | constants | `th-server::routes::tracker` |
| `request-access/route.ts` (140) | POST | 400 invalid JSON `{error:"Invalid request payload"}`; 400 missing name/email/user_type; 400 email regex; 400 user_type not in 5; record `{name,email,user_type,description(≤500 or ""),timestamp}` appended to `<cwd>/data/access-requests.jsonl`; Resend email if `RESEND_API_KEY` and `NOTIFY_EMAIL`; log non-PII; 200 `{success:true, message}` | fs, fetch | `th-server::routes::request_access` |
| `roadmap/route.ts` (92) | POST | 400 `dateOfLastAct is required`; 400 malformed date; `calculateDeadline(date, undefined, undefined, claimType || "unfair_dismissal")`; JSON array of one `TimelineStage` (`level`, `abbrev`, `color:"#8B5CF6"`, 3 steps: ACAS EC + ET1 with `deadline` = ISO datetime of `final_deadline`, status `overdue` if now > deadline else `upcoming`, CMPH with `deadline:null`, status `future`); catch → 500 `{error, request_id}` | deadline-calculator, Timeline types | `th-server::routes::roadmap_post` |
| `roadmap/[caseId]/route.ts` (41) | GET | `{case_id, stages:[16], current_stage:"PRE_ACTION", note}`; two `era2025_note` strings use `formatCommencementMonth` | constants | `th-server::routes::roadmap_case` |
| `webhook/route.ts` (87) | POST raw | 503 no `WEBHOOK_SECRET`; 403 timestamp missing/malformed/outside ±300 s; 403 signature mismatch (`sha256=` + HMAC over `<ts>.<body>`, timing-safe compare); 400 body not JSON; 200 `{status:"acknowledged", phase:4, message}` | crypto | `th-server::routes::webhook` |
| `debate/route.ts` (539) | POST | 429 rate limit (separate bucket); 400 `facts and claim_type are required` (falsy check); 400 facts > 50 000 (string only); 400 mode not `single_pass`/`adversarial`; 500 `{error:"ANTHROPIC_API_KEY not configured"}` when no client; single pass Drafter→Critic→Judge with exact user-message templates; `parseAgentOutput` fallback keys `argument`/`attacks`/`synthesis`; `attachCitationTrust` on `legal_framework[]` (name key `authority`) and `attacks[]`; `clampJudgeScores` (total 0..100 rounded, each criterion 0..max); `viable = score >= 70` or null; body `{mode, rounds_run:1, drafter, critic, judge, viable, usage:{total_input_tokens,total_output_tokens}, [_debug], refinement}` (refined as `debate`); adversarial mode: initial draft + up to 3 rounds (critic, revise, judge), early stop ≥ 70, `iterations[]`, `final`, `stopped_early`, only `final` refined | prompts, claude-client, refinement, citation-validator, rate-limit | `th-server::routes::debate` + `th-services::debate` |

Route tests: `analyse/route.test.ts` (314, mocks client + validator), `debate/route.test.ts` (427), `deadlines/route.test.ts` (137), `triage/route.test.ts` (90), `webhook/route.test.ts` (126), `era-2025/tracker/route.test.ts` (142), `roadmap/route.test.ts` (159), `request-access/route.test.ts` (149), `case-law/find/route.test.ts` (45), `case-law/judgment/route.test.ts` (48).

## 7. `src/app` — pages, layout, metadata

| File | Route | Theme | Disclaimer text present | Interactivity | Rust |
|---|---|---|---|---|---|
| `layout.tsx` (61) | all | fonts Playfair Display / Outfit / Fira Code via `next/font/google`; `<NavBar/> <main/> <Footer/>`; metadata title "Tribunal Harness \| Structured Legal Analysis" | — | — | `th-server::ui::layout` (Google Fonts `<link>`, same CSS variables) |
| `globals.css` (738) | all | `@theme` tokens (bg `#000000`, purple `#8B5CF6`, cream `#E8E3D5`, …), Liquid Glass classes, typography utilities, nav/card/input/button/footer classes, responsive rules, `.theme-light` | — | — | `static/app.css` (verbatim, `@import "tailwindcss"` replaced by Tailwind standalone build) |
| `page.tsx` (179) | `/` | dark | "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship." (persistent) | ClaimInputPanel → POST `/api/analyse` + `/api/roadmap`; drop → `/api/triage`; consent checkbox gates the button and `consent` field | `th-server::ui::pages::home` + inline JS |
| `adversarial-debate/page.tsx` (485) | `/adversarial-debate` | dark | yes (2 places) | mode radio, consent gate, POST `/api/debate`, results renderer using `debate-modes.ts` helpers | `ui::pages::adversarial_debate` + inline JS |
| `analysis-engine/page.tsx` (98) | `/analysis-engine` | dark | "…Schema outputs are informational and should be independently verified." | GET `/api/schema/<id>` | `ui::pages::analysis_engine` + inline JS |
| `case-law-db/page.tsx` (240) | `/case-law-db` | dark | yes | GET `/api/case-law/search` | `ui::pages::case_law_db` + inline JS |
| `era-2025/page.tsx` (66) | `/era-2025` | dark | yes | static table from `ERA_2025_TRACKER` | `ui::pages::era_2025` |
| `security/page.tsx` (153) | `/security` | dark | yes | static | `ui::pages::security` |
| `ethics/page.tsx` (41) | `/ethics` | dark | yes (boxed) | static | `ui::pages::ethics` |
| `methodology/page.tsx` (68) | `/methodology` | dark | yes | static + SVG | `ui::pages::methodology` |
| `privacy/page.tsx` (145) | `/privacy` | dark | yes | static | `ui::pages::privacy` |
| `terms/page.tsx` (136) | `/terms` | dark | yes (boxed) | static | `ui::pages::terms` |
| `product/page.tsx` (76) | `/product` | dark | yes | static | `ui::pages::product` |
| `request-access/page.tsx` (88) | `/request-access` | dark | yes | POST `/api/request-access`, required consent checkbox | `ui::pages::request_access` + inline JS |
| `schema-builder/page.tsx` (85) | `/schema-builder` | dark | yes | client-side field list + JSON preview | `ui::pages::schema_builder` + inline JS |
| `about/page.tsx` (52) | `/about` | light | "…The author is not practising as a solicitor or barrister via this platform." | static | `ui::pages::about` |
| `blog/page.tsx` (34) | `/blog` | light | "Content published here will constitute legal information, not legal advice…" | static | `ui::pages::blog` |
| `contact/page.tsx` (57) | `/contact` | light | yes | static | `ui::pages::contact` |
| `documentation/page.tsx` (99) | `/documentation` | light | yes | static (CLAIM_TYPES + tracker table) | `ui::pages::documentation` |
| `how-it-works/page.tsx` (76) | `/how-it-works` | light | yes | static (6 tracker rows) | `ui::pages::how_it_works` |
| `pricing/page.tsx` (50) | `/pricing` | light | yes | static | `ui::pages::pricing` |
| `analysis/page.tsx` (7), `case-law/page.tsx` (7), `docs/page.tsx` (7) | redirects → `/analysis-engine`, `/case-law-db`, `/documentation` | — | — | — | 307/308 redirects in `th-server` |
| `error.tsx` (55), `global-error.tsx` (61) | error boundaries | dark | — | reset button | `ui::pages::error` (500 page) |
| `sitemap.ts` (35) | `/sitemap.xml` | 17 routes with priorities | — | — | `th-server::routes::sitemap` |
| `public/robots.txt` | `/robots.txt` | — | — | — | static file |

## 8. `src/components`

| File | Purpose | Rust |
|---|---|---|
| `layout/NavBar.tsx` (217) | sticky glass nav: 5 links, Trust dropdown (Security/Ethics/Methodology), Blog, Request Access CTA, hamburger < md with mobile menu | `ui::layout::nav_bar` + small inline JS for toggles |
| `layout/Footer.tsx` (87) | cream footer: Platform/Company/Legal link columns, disclaimer bar with current year, huge brand text | `ui::layout::footer` |
| `analysis/ClaimInputPanel.tsx` (167) | claim type select (★ for ERA 2025), date, narrative, consent checkbox, Run Analysis (disabled until consent), drop zone | `ui::components::claim_input` |
| `analysis/AnalysisResultsPanel.tsx` (243) | `buildAnalysisResultsView` (normalise, drop QUARANTINED, `strippedQuarantineCount = max(stripped, summary.quarantined)`), `flagStatusLabel`, render claims/authorities/flags/timeline | `th-core::ui_view::analysis_results` (pure) + JS renderer |
| `analysis/Timeline.tsx` (174) | `TimelineStep/Stage` types; collapsible stage; `formatDate` en-GB short | JS renderer |
| `adversarial/debate-modes.ts` (253) | `DEBATE_MODES`, `getDebateMode`, `getArgumentText`, `getSynthesisText`, `getScore`, `partitionAuthorities`, `formatInt`, `formatUsage`, `describeRounds`, `viabilityLabel` | `th-core::ui_view::debate_modes` (pure, fixture-tested) + JS |
| `ui/Badge.tsx`, `ui/Button.tsx`, `ui/Card.tsx` | Tailwind class variants | maud helpers with the same class strings |

Tests: `debate-modes.test.ts` (145), `AnalysisResultsPanel.test.ts` (128).

## 9. Documentation read for context (not ported)

`tribunal-harness/CLAUDE.md`, `README.md`, `HANDOFF.md`, `TESTING_READINESS.md`, `AUDIT_REPORT.md`, `docs/live-case-law.md`, `scripts/README.md`, root `CLAUDE.md`, `corpus/authorities/MANIFEST.md` (lists six citation discrepancies in `verified-authorities.ts` — ported as-is, listed under follow-ups).

## 10. Baseline evidence recorded

- `npm test` (Vitest 3): **28 files, 403 passed, 2 skipped** (the two `RUN_LIVE_CASELAW` live tests). Log: `fixtures/ts-vitest-baseline.log`.
- `npm run smoke`: **PASS 7/7**. Report: `fixtures/smoke/ts-smoke-report.{json,md}`.
- Generator: `fixtures/generators/generate-fixtures.ts` (see `fixtures/README.md`).
