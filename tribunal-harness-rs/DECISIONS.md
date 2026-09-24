# DECISIONS.md — choices, assumptions and conflicts logged during the port

## Crate choices

| Need | Crate | Why (and what was rejected) |
|---|---|---|
| HTTP server | `axum` 0.8 + `tokio` | The brief names Axum; mature, tower-based, first-class multipart via the `multipart` feature. |
| HTML rendering | `maud` 0.27 | Compile-time-checked templates, zero runtime templating cost, no build step. **Leptos was considered and not used**: the six interactive pages need a small amount of client behaviour (a `fetch` and a re-render); Leptos would add a WASM toolchain (`cargo-leptos`, `wasm32` target), a hydration layer and minutes of build time for that. The interactive behaviour is inline vanilla JavaScript shipped in the page (no Node at runtime), which is what the brief permits. Result markup is rendered by the server (`/_ui/fragments/*`, below) so the view logic and legal wording stay in Rust. |
| CSS | Tailwind standalone CLI v4.3.3 | Required by the brief. `globals.css` is ported verbatim (it is 98% plain CSS with an `@import "tailwindcss"` line); the utility classes used by the NavBar/Badge/Button/Card are compiled from the maud sources and inline scripts by the standalone CLI (`@source "../src"`). The built `static/app.css` is committed and embedded with `include_str!`, so a fresh clone builds with no download. |
| HTTP client | `reqwest` 0.12 (`rustls-tls`, no default features) | Needed for TNA, Anthropic, Resend. Wrapped behind a `HttpClient` trait so tests inject canned responses (mirrors the TypeScript tests stubbing `globalThis.fetch`). Redirects are disabled at the client level (`Policy::none()`) so the SSRF-guarded manual redirect logic can be ported exactly. |
| JSON | `serde` + `serde_json` (`preserve_order`) | `preserve_order` keeps object key order identical to the TypeScript output, which the fixture diffs rely on. |
| Regex | `regex` | Same patterns as the TypeScript source, translated literally. |
| Dates | hand-rolled `dates` module (Howard Hinnant's `days_from_civil`) | The calculator needs exactly the semantics of `Date.UTC` arithmetic: UTC-only civil dates, weekday, month overflow. A 120-line module with fixture coverage of every day 2024–2029 is smaller and easier to audit than pulling `chrono`/`time`. Formatting is en-GB only. |
| Hashing | `sha2`, `hmac`, `hex` | Consent audit hash and webhook HMAC with a constant-time compare. |
| UUID | `uuid` v4 | `request_id` in 500 responses. |
| PDF text | `pdf-extract` 0.9 (+ `lopdf` for the page count) | Pure-Rust text extraction; no system dependency (poppler was rejected). Output differs from `pdf-parse` (pdf.js) in whitespace/line breaks — recorded as `[partial]` in PARITY. |
| DOCX text | `zip` 4 + `quick-xml` 0.38 | `mammoth.extractRawText` emits each paragraph followed by `\n\n` (tabs and breaks preserved); reimplemented directly and verified byte-equal on the fixture document. |
| Multipart | `axum` `multipart` feature | Triage upload. |
| Env | `dotenvy` | Reads `.env.local` like Next does. |
| Logging | `tracing` + `tracing-subscriber` | The TypeScript app `console.log`s a cost line per call; kept as `tracing::info`. |
| Formatting | `rustfmt.toml` (`max_width = 180`, `use_small_heuristics = "Max"`) | Keeps the long literal-heavy lines (schemas, prompts, markup) readable; `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets -- -D warnings` are clean. |

## Assumptions and ambiguities (implemented the reading the TypeScript code supports)

1. **Branch name.** The brief says "work only on a new branch (`rust-rebuild`)"; the
   session harness mandates the branch `claude/dreamy-maxwell-k5ycj6` and forbids
   pushing anywhere else. The harness constraint wins; all work is on
   `claude/dreamy-maxwell-k5ycj6` and nothing touches `main`. A maintainer can
   `git branch rust-rebuild claude/dreamy-maxwell-k5ycj6` if the name matters.
2. **`process.env` is read at call time** in `claude-client.ts` and
   `legal-writing-refinement.ts`, but `TIME_LIMIT_CONFIG.COMMENCEMENT_DATE` and
   the request-access data directory are fixed at module load. The Rust port
   reads all of them once into an `AppConfig` at start-up (the deadline
   commencement override is validated at start-up exactly like `constants.ts`
   throws at load). Tests pass explicit config.
3. **`NODE_ENV`.** `_debug` payloads are attached only when `NODE_ENV=development`;
   the agent stand-in is refused when `NODE_ENV=production`. The Rust server
   honours the same variable name and values rather than inventing a new flag.
4. **"Today" for deadlines.** `computeOne` uses UTC midnight of the current date.
   The port takes a `Clock` (default: system UTC) so fixture tests can pin the
   generation date; behaviour is otherwise identical.
5. **JSON key order** in responses follows the TypeScript object literal order
   (`serde_json` `preserve_order`), including the spread order in
   `/api/analyse`'s authority enrichment (`...auth` first, then the enrichment
   keys, `original_citation` only when corrected, an `undefined` enrichment
   value removing a key the model had supplied).
6. **JavaScript value semantics** are reproduced where the routes depend on
   them (`th-server/src/jsval.rs`): truthiness (`""`, `0`, `null` falsy),
   template-literal stringification (`${12345}`, `[object Object]`, arrays
   joined with commas, `Mode: undefined` when `mode` is absent), UTF-16
   `length`/`substring`, `Number.parseInt` on query params (`"2abc"` → 2,
   `"1.9"` → 1, `"abc"` → NaN → default), `JSON.stringify(value)` inside error
   messages, `for…of` over a string (a `claim_types: "unfair_dismissal"` body
   yields one deadline per character — the recorded behaviour).
7. **Redirect routes** (`/analysis`, `/case-law`, `/docs`) use Next's `redirect()`
   which emits 307 in App Router; the port returns 307 with the same `Location`.
8. **Multipart `document` that is a text field** must 400 with the same message;
   a field without a filename is treated as "not a file". Uploads up to 64 MB are
   accepted at the transport so the > 10 MB case is rejected with the same 413.
9. **Fonts.** `next/font/google` self-hosts Playfair Display, Outfit and Fira
   Code with the same weights/styles and exposes them as `--font-serif`,
   `--font-sans`, `--font-mono`. The port self-hosts the same four latin
   variable faces (`static/fonts/*.woff2`, 146 KB, fetched once from Google Fonts
   at port time) and sets the three variables on `<html>`; no request leaves the
   visitor's browser for a font CDN, as with `next/font`.
10. **`console.warn` fall-back in `getEndpointConfig`** becomes `tracing::warn`.
11. **Request-access persistence path** is `<cwd>/data/access-requests.jsonl`
    exactly as in TypeScript (relative to the process working directory).
12. **Result fragments.** The React pages rendered analysis/debate results
    client-side from JSON. The port keeps the JSON API calls identical (same
    URLs, bodies and headers — the browser check confirms the same 400s are
    produced in the same situations) and adds four server-only endpoints the
    Next app does not have, `POST /_ui/fragments/analysis-results`,
    `POST /_ui/fragments/debate-results`, `GET /_ui/fragments/schema/{id}`,
    `GET /_ui/fragments/case-law-results`, which return the rendered HTML of the
    corresponding React components (`AnalysisResultsPanel`, `Timeline`,
    `DebateResults`, the schema card, the search results). They are internal to
    the pages, carry no legal logic of their own (they call `th_core::ui_view`)
    and are covered by `tests/pages.rs`.
13. **Page state.** Where React re-mounted a component (the home input panel
    after "New Analysis") the port resets the same fields; where React kept
    state (the debate form after "New Debate") the port keeps it.
14. **Timeline dates** (`toLocaleDateString("en-GB", { day: "numeric", month:
    "short", year: "numeric" })`) are rendered server-side from the deadline's
    UTC date with the en-GB CLDR abbreviations (`Sept` for September); the
    browser would have used the visitor's local time zone.
15. **Smoke report shape.** `smoke-report.json` keeps the TypeScript keys
    (`environment.node_version` carries the Rust build id) so the two reports
    diff cleanly; sections run sequentially rather than with `Promise.all`.
16. **Webhook replay fixture.** The generator recorded `now_seconds` as a whole
    second and handled the requests a few hundred ms later, so its ±300 s edge
    cases fell mid-second; the replay pins the clock at +500 ms and reproduces
    every recorded verdict with the same `<= REPLAY_WINDOW_MS` rule.
17. **`/api/case-law/search` empty strings.** `?claim_type=` and `?tier=` behave
    as "not supplied" (JS truthiness) while `claim_type` is echoed back as `""`
    — matched to the recorded responses.
18. **`/api/schema/` with an empty segment** returns the JSON 404
    (`Unknown claim type: `) that the handler produces; Next's router would have
    served its HTML 404 page for that URL. Both are 404.
19. **Static assets** are served from `/static/*` (embedded), not `/_next/static/*`
    hashed chunks; no page references those URLs.
20. **Stylesheet additions** (`tailwind/ui-port.css`, appended after the verbatim
    `globals.css`): the state classes the inline scripts toggle (React set inline
    styles) and the `spin`/`pulse`/`pourDown` keyframes the React markup
    referenced by name. Tailwind v4 has no `border-opacity-*` utilities, so those
    classes on the Timeline card are no-ops in both apps; kept verbatim.
21. **Favicon**: neither app ships one (404 in both).

## Conflicts with repository docs (brief wins, logged here)

- Root `CLAUDE.md`, inner `CLAUDE.md`, `HANDOFF.md`, `STACK-DECISION-*.md`,
  `_AGENT_BRIEFINGS/*` describe a TypeScript/Next.js/Supabase/Temporal stack and
  instruct "TypeScript strict mode throughout". This port is Rust by instruction
  of the brief; those files are treated as context only.
- Inner `CLAUDE.md` "Coding Standards" require tests in `src/services/*.test.ts`
  for new routes; Rust tests live beside the Rust modules and in
  `crates/*/tests/`.
- `HANDOFF.md` §3 still names `claude-sonnet-4-20250514`; the code
  (`claude-config.ts`) uses `claude-opus-4-8` / `claude-sonnet-5` /
  `claude-haiku-4-5-20251001`. The **code** values are ported (the brief says port
  model IDs as they are). See follow-ups.
- The existing `.github/workflows/ci.yml` was not edited; the Rust workflow is
  a separate file, `.github/workflows/rust-ci.yml` (adopted on request; it was
  first delivered as a proposal under `ci/`).

## Follow-ups noticed but deliberately not changed (ported as-is)

- `corpus/authorities/MANIFEST.md` documents six neutral citations in
  `verified-authorities.ts` that BAILII contradicts (Chagger, Robertson v Bexley,
  Environment Agency v Rowan, Cavendish Munro, Iceland Frozen Foods, Richmond
  Pharmacology). Ported verbatim; owner review needed.
- `case-law/search` seed data lists "British Columbia v O'Brien [2013] EWCA Civ
  1482" and "Capita Hartshead Ltd v McLean [2023] EAT 2" whose names/citations
  look doubtful; ported verbatim.
- The seed-search scorer awards tier/year points without any text match, so any
  query (even `zzzz`) returns the binding/statutory cases ranked below real
  matches (10 results for `q=Polkey`); ported verbatim.
- `UK_BANK_HOLIDAYS_EW` ends in 2028; the calculator already warns past 2028.
- `deadline-calculator.ts` header comment says wrongful dismissal in the ET is
  "capped at £25,000"; only the warning string is user-facing and it is ported.
- `HANDOFF.md`/`CLAUDE.md` model names are stale relative to `claude-config.ts`.
- `ENDPOINT_CONFIG.effort` is metadata only (not sent on the wire); the
  `thinking` block is sent as `{type:"enabled", budget_tokens}` exactly as the
  SDK call does today, with the comment in the source acknowledging current
  models may reject it. Ported as-is.
- The `catch` in `/api/triage` and `/api/request-access` leaks
  `details: String(error)` to the client (unlike the other routes). Ported as-is.
- `/api/analyse` builds the model prompt with `Mode: undefined` when the request
  omits `mode`; the home page always sends `"narrative"`. Ported as-is.
- `pdf-extract` should be evaluated on real TNA judgment PDFs (columns, scanned
  pages) before the Rust build is relied on for triage; pdf.js is more tolerant.
- The React `Timeline` formats deadlines in the visitor's time zone; the port
  uses the UTC date (see assumption 14). For UK visitors the dates coincide.
