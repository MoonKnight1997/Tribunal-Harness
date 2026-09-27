# Legal source governance

## Registry

`src/legal/sources/registry.ts` holds every legal source the product applies
or cites, separately from model prompts. Each entry records title, publisher,
URL/reference, jurisdiction, source type, evidential `strength` (for
commencement purposes a GOV.UK policy timetable is `secondary`), published
date, `effectiveFrom`, `effectiveTo`, `supersededBy`, applicability notes, a
version, and two verification fields:

- `lastVerifiedAt` — the date a reviewer last actually read the source, or
  `null` if it has never been read (a lead, or an instrument that could not be
  retrieved). It is set to today's date **only** for a source fetched today.
- `verification` — `{ method, retrievedFrom, attemptedAt, note }` where
  `method` is `fetched` | `not_rechecked` | `unreachable` | `not_attempted`.
  A source may not carry `method: "fetched"` without an `attemptedAt`.

Changing a source is a reviewed code change.

Hierarchy for citation: legislation.gov.uk → GOV.UK → Acas → HMCTS/tribunal
procedure → curated case law → secondary material (only where explicitly
labelled). Hierarchy for **commencement**: only a made instrument (Act
commencement section or commencement regulations/order), read in full, can
mark a rule as commenced. Announcements, timetables, explanatory bulletins and
search-index snippets are leads.

`applicableSource(key, eventDate)` distinguishes the newest source from the
source legally applicable to the user's event.

## Source-to-rule register

`src/legal/rules/register.ts` (`LEGAL_RULE_REGISTER`) links every rule the
engine relies on to its provision and instrument. Each entry has:

| Field | Meaning |
|---|---|
| `ruleId` | matches `TIME_LIMIT_RULES[].id`, or a tracker key (`QUALIFYING_PERIOD_6_MONTHS`, `HARASSMENT_ALL_REASONABLE_STEPS`, …) |
| `provision`, `instrument` | exact section/article and the Act/SI |
| `jurisdiction[]`, `effectiveFrom`, `effectiveTo` | the window the rule covers (must equal the rule's window) |
| `transition` | plain-English predicate, e.g. "applies where the effective date of termination is on or after 1 October 2026" |
| `status` | `commenced` \| `made_not_yet_commenced` \| `announced` \| `assumed` |
| `commencementInstrument` | `{ title, siNumber, url, regulation }` — **mandatory** for `commenced`, forbidden for `announced`/`assumed` |
| `verification` | `{ retrievedAt, url, method, note }` — the retrieval attempt the entry rests on |
| `tests[]` | the test names that prove the boundary |
| `unverifiedLeads[]` | snippets/bulletins noted for follow-up; never used to change behaviour |

Derivations (there is no blanket flag anywhere):

- `TIME_LIMIT_RULES[].commencement.confirmedBySI` = `isRuleCommenced(ruleId)`
  = `status === "commenced" && commencementInstrument !== undefined`, per rule.
- `TIME_LIMIT_CONFIG.TIME_LIMIT_SI_CONFIRMED` (read by the retained
  calculator) = every GB ERA 2025 six-month rule is commenced
  (`allGbEra2025TimeLimitRulesCommenced()`). It is not an environment variable.
- Registry `commencementConfirmed` on ERA 2025 sources = the matching
  register status.
- `ERA_2025_TRACKER[].sourceStatus` (`commenced` \| `made_not_yet_commenced`
  \| `announced` \| `assumed` \| `unresolved`), `sourceUrl`, `verifiedAt`,
  `unresolved`. `unresolved` means the reported government timetable differs
  from the stored date (or the stored date was never sourced) and the
  instrument could not be read: the stored date is **not** moved and the label
  reads "Date under review — see source register".

`src/legal/rules/register.test.ts` enforces all of the above.

## Versioned rules

`src/legal/rules/time-limits.ts` registers time-limit rules with jurisdiction,
claim family, effective window, triggering event, months, Acas applicability,
extension discretion, source keys and commencement metadata. There is no
universal tribunal limitation period: `selectTimeLimitRule` picks the rule in
force on the triggering date. Where the selected rule is not confirmed by a
commencement instrument, the engine leads with the shorter pre-commencement
rule and shows the longer one as secondary. Adding a commencement is a **new
row** (never an edit of a historical row), plus a register entry, plus tests
at the boundary dates.

Breach-of-contract claims are modelled per jurisdiction from 1 October 2026
because the reported amending instruments differ: the England and Wales
(Amendment) Order 2026 is reported not to extend to Scotland, where the 1994
Order is a matter for the Scottish Ministers (reported change 9 November 2026).
Until either instrument has been read, the three-month rule leads in both.

`src/legal/rules/acas-code.ts` versions the Acas Code of Practice. A process
is governed by the Code in force when it started; drafts are never selected.

`src/legal/era-2025.ts` is the single source of truth for Employment Rights
Act 2025 commencement dates. `ERA_2025_TIME_LIMIT_COMMENCEMENT` (validated
`YYYY-MM-DD`) overrides the **assumed** GB six-month commencement date only; it
never confirms a rule.

## How to add or confirm a commencement

1. Retrieve the made instrument from legislation.gov.uk (the `/made` text, or
   `/data.xml`), read the commencement regulation and every transitional or
   saving provision. Note the retrieval time.
2. Add a registry source for the instrument (`lastVerifiedAt` = today,
   `verification.method: "fetched"`, `retrievedFrom`, `attemptedAt`).
3. In `register.ts`, set the rule's `status` to `commenced` (or
   `made_not_yet_commenced`), fill `commencementInstrument`, rewrite
   `transition` from the instrument's own words, and update `verification`.
   If the instrument gives a different date from the stored one, add a **new**
   rule row in `time-limits.ts` with the instrument's date and close the
   previous row's `effectiveTo`; then update the constant in `era-2025.ts` and
   the tracker entry (`sourceStatus`, `verifiedAt`, `unresolved: false`).
4. Add or update boundary tests (day before / day of commencement, and for
   transitional predicates the relevant trigger on each side) and name them
   for the instrument.
5. Record the change in `docs/improvement-2026-09/SOURCE_VERIFICATION_REGISTER.md`.
6. Run `npm run legal:check-sources -- --update` to seed the hash for the new
   source.

## Refresh procedure (stale-source check)

`npm run legal:check-sources` (`scripts/check-legal-sources.ts`) performs a
HEAD and GET for every registry URL and every register verification and
commencement URL, reports HTTP status, `Last-Modified` and a SHA-256 of the
body, compares the hash with `legal-corpus/source-hashes.json`, lists entries
whose `lastVerifiedAt` (or register `verification.retrievedAt`) is older than
`LEGAL_SOURCE_MAX_AGE_DAYS` (default 90), and exits non-zero on any change,
staleness, unreachable URL or register entry whose verification was not a
fetch. `--update` records hashes **only** for URLs fetched successfully in that
run. `LEGAL_SOURCE_FETCH_TIMEOUT_MS` (default 20000) bounds each request.

- **Who:** the legal-content owner (or the on-call engineer if none is
  assigned), from a network that can reach legislation.gov.uk, gov.uk and
  acas.org.uk. The build environment used for the September 2026 review could
  not (egress blocked), so `source-hashes.json` is empty and every register
  entry is `unreachable`.
- **When:** weekly by CI/cron; on every government timetable update; whenever
  a commencement instrument is expected; before any release that touches
  `src/legal/`.
- **When it fails:** `CHANGED` — open the URL, read the change, decide whether
  a rule, date or applicability note must change; make the reviewed code
  change, then re-run with `--update`. `STALE` — re-read the source; if
  unchanged, set `lastVerifiedAt`/`retrievedAt` to today and re-run with
  `--update`. `UNREACH`/`UNREAD` — do not claim a review date; investigate the
  network or the URL; if the source has moved, update the URL in a reviewed
  change. Never edit `source-hashes.json` by hand.

## Deadline outputs

Every deadline shows the calculated date (or that none can be calculated),
the assumptions, the triggering date used, the Acas effect, the source and
rule version, and the information still missing. Deadline information is
never paywalled and never produced by a model.

## Case law

Curated authorities (`verified-authorities.ts`) and the citation validator are
retained from Tribunal Harness for verifying any citation a model emits. The
live Find Case Law client (`find-case-law.ts`) is retained for single-citation
verification only.

Computational analysis of Find Case Law judgment text by a model is gated by
`ENABLE_CASELAW_LLM_ANALYSIS` (default off). Until the licensing position for
computational analysis of The National Archives corpus is confirmed, the
product does not:

- process judgment text with a model;
- retain or index judgment text;
- analyse multiple judgments computationally.

What the retained lookup does when used: it sends a search query (a neutral
citation or case name) to the public Find Case Law Atom feed, per request,
not user-specific beyond the citation itself; results are held in an
in-memory cache for one hour and are not persisted. The client is isolated
behind one module so it can be replaced.

## Public content

Public guides (`src/content/articles.ts`) carry a jurisdiction label, a
last-reviewed date, an effective-date note where the law is changing, and
the registry sources they rest on. They are few and substantive; no generated
thin pages.

## Review cadence

Sources and rules are reviewed whenever a commencement Statutory Instrument is
made, when the Acas Code is revised, when the government implementation
timetable is updated, and at least quarterly; the stale-source check runs
weekly. `lastVerifiedAt` is updated only for sources actually re-read.
