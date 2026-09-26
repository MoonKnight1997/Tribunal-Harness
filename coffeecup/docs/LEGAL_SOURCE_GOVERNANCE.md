# Legal source governance

## Registry

`src/legal/sources/registry.ts` holds every legal source the product applies
or cites, separately from model prompts. Each entry records title, publisher,
URL/reference, jurisdiction, source type, published date, `effectiveFrom`,
`effectiveTo`, `lastVerifiedAt`, `supersededBy`, applicability notes and a
version. Changing a source is a reviewed code change.

Hierarchy: legislation.gov.uk → GOV.UK → Acas → HMCTS/tribunal procedure →
curated case law → secondary material (only where explicitly labelled).

`applicableSource(key, eventDate)` distinguishes the newest source from the
source legally applicable to the user's event.

## Versioned rules

`src/legal/rules/time-limits.ts` registers time-limit rules with jurisdiction,
claim family, effective window, triggering event, months, Acas applicability,
extension discretion, source keys and commencement metadata. There is no
universal tribunal limitation period: `selectTimeLimitRule` picks the rule in
force on the triggering date. Where a rule's commencement is not yet confirmed
by Statutory Instrument (the Employment Rights Act 2025 six-month limit), the
engine leads with the shorter pre-commencement rule and shows the longer one
as secondary.

`src/legal/rules/acas-code.ts` versions the Acas Code of Practice. A process
is governed by the Code in force when it started; drafts are never selected.

`src/legal/era-2025.ts` is the single source of truth for Employment Rights
Act 2025 commencement dates. `ERA_2025_TIME_LIMIT_COMMENCEMENT` overrides the
assumed six-month commencement once confirmed.

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

Sources and rules should be reviewed whenever a commencement Statutory
Instrument is made, when the Acas Code is revised, and at least quarterly.
Update `lastVerifiedAt` when checked.
