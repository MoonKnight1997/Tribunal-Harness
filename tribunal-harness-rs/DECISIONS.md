# DECISIONS.md — choices, assumptions and conflicts logged during the port

## Crate choices

| Need | Crate | Why (and what was rejected) |
|---|---|---|
| HTTP server | `axum` 0.8 + `tokio` | The brief names Axum; mature, tower-based, first-class multipart via `axum` `multipart` feature. |
| HTML rendering | `maud` 0.27 | Compile-time-checked templates, zero runtime templating cost, no build step. **Leptos was considered and not used**: the six interactive pages need a small amount of client behaviour (a `fetch` and a re-render); Leptos would add a WASM toolchain (`cargo-leptos`, `wasm32` target), a hydration layer and minutes of build time for that. The interactive behaviour is inline vanilla JavaScript shipped in the page (no Node at runtime), which is what the brief permits. |
| CSS | Tailwind standalone CLI v4.3.3 | Required by the brief. `globals.css` is ported verbatim (it is 98% plain CSS with an `@import "tailwindcss"` line); the utility classes used by the NavBar/Badge/Button/Card are compiled from the maud sources by the standalone CLI. The built `static/app.css` is committed so a fresh clone builds with no download. |
| HTTP client | `reqwest` 0.12 (`rustls-tls`, no default features) | Needed for TNA, Anthropic, Resend. Wrapped behind a `HttpClient` trait so tests inject canned responses (mirrors the TypeScript tests stubbing `globalThis.fetch`). Redirects are disabled at the client level (`Policy::none()`) so the SSRF-guarded manual redirect logic can be ported exactly. |
| JSON | `serde` + `serde_json` (`preserve_order`) | `preserve_order` keeps object key order identical to the TypeScript output, which the fixture diffs rely on. |
| Regex | `regex` | Same patterns as the TypeScript source, translated literally. |
| Dates | hand-rolled `dates` module (Howard Hinnant's `days_from_civil`) | The calculator needs exactly the semantics of `Date.UTC` arithmetic: UTC-only civil dates, weekday, month overflow. A 120-line module with fixture coverage of every day 2024–2029 is smaller and easier to audit than pulling `chrono`/`time`. Formatting is en-GB only (`1 January 2027`). |
| Hashing | `sha2`, `hmac`, `hex`, `subtle` (via `hmac`'s `verify_slice`) | Consent audit hash and webhook HMAC with constant-time compare. |
| UUID | `uuid` v4 | `request_id` in 500 responses. |
| PDF text | `pdf-extract` 0.9 | Pure-Rust text extraction; no system dependency (poppler was rejected). Output differs from `pdf-parse` (pdf.js) in whitespace/line breaks — recorded as `[partial]` in PARITY with measured differences. |
| DOCX text | `zip` 4 + `quick-xml` 0.38 | `mammoth.extractRawText` concatenates `w:t` runs with `\n\n` between paragraphs; reimplemented directly (mammoth has no Rust port). |
| Multipart | `axum` `multipart` feature | Triage upload. |
| Env | `dotenvy` | Reads `.env.local` like Next does. |
| Logging | `tracing` + `tracing-subscriber` | The TypeScript app `console.log`s a cost line per call; kept as `tracing::info`. |

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
   keys, `original_citation` only when corrected).
6. **`Number` coercions.** Where TypeScript does `Number.parseInt` on query
   params, the port parses a leading integer the same way (`"2abc"` → 2,
   `"1.9"` → 1, `"abc"` → NaN → default). `JSON.stringify(value)` inside error
   messages is reproduced with `serde_json::to_string`.
7. **Redirect routes** (`/analysis`, `/case-law`, `/docs`) use Next's `redirect()`
   which emits 307 in App Router; the port returns 307.
8. **Multipart `document` that is a text field** must 400 with the same message;
   Axum exposes a field's `file_name()`; a field without a filename is treated
   as "not a file".
9. **Fonts.** `next/font/google` self-hosts Playfair Display, Outfit and Fira
   Code. The port links the same families from Google Fonts with the same
   weights and CSS variables (`--font-serif`, `--font-sans`, `--font-mono`).
   Self-hosting would require downloading font binaries into the repo.
10. **`console.warn` fall-back in `getEndpointConfig`** becomes `tracing::warn`.
11. **Request-access persistence path** is `<cwd>/data/access-requests.jsonl`
    exactly as in TypeScript (relative to the process working directory).

## Conflicts with repository docs (brief wins, logged here)

- Root `CLAUDE.md`, inner `CLAUDE.md`, `HANDOFF.md`, `STACK-DECISION-*.md`,
  `_AGENT_BRIEFINGS/*` describe a TypeScript/Next.js/Supabase/Temporal stack and
  instruct "TypeScript strict mode throughout". This port is Rust by instruction
  of the brief; those files are treated as context only.
- Inner `CLAUDE.md` "Coding Standards" require tests in `src/services/*.test.ts`
  for new routes; Rust tests live beside the Rust modules and in
  `crates/th-server/tests/`.
- `HANDOFF.md` §3 still names `claude-sonnet-4-20250514`; the code
  (`claude-config.ts`) uses `claude-opus-4-8` / `claude-sonnet-5` /
  `claude-haiku-4-5-20251001`. The **code** values are ported (the brief says port
  model IDs as they are). See follow-ups.

## Follow-ups noticed but deliberately not changed (ported as-is)

- `corpus/authorities/MANIFEST.md` documents six neutral citations in
  `verified-authorities.ts` that BAILII contradicts (Chagger, Robertson v Bexley,
  Environment Agency v Rowan, Cavendish Munro, Iceland Frozen Foods, Richmond
  Pharmacology). Ported verbatim; owner review needed.
- `case-law/search` seed data lists "British Columbia v O'Brien [2013] EWCA Civ
  1482" and "Capita Hartshead Ltd v McLean [2023] EAT 2" whose names/citations
  look doubtful; ported verbatim.
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
