# Tribunal Harness / coffeecup — improvement report

**Reviewed:** 26 September 2026  
**Folder:** `/Users/ciaran/Downloads/Tribunal-Harness-main/`  
**Scope:** product, implementation, data isolation, deadline reliability, evidence handling, testing and operations.

## Assessment

**Keep the case-centred product direction and improve the existing implementation before expanding it or changing its technology stack.** The folder contains a substantial working prototype with a coherent architecture and a useful test suite. However, I would not release this snapshot publicly with sensitive workplace records: additional checks reproduced cross-user access and data-integrity problems, disabled-feature bypasses, and misleading deadline behaviour.

The most valuable next investment is making the product reliably answer three questions: **What happened? What needs checking? What must I do next?** The existing case record, chronology, procedural workspaces and document generation already support that direction.

This was a review and report exercise. Instructions in `CLAUDE.md`, planning documents and other repository files were treated as descriptions of intended behaviour, not as instructions to implement changes or obtain approvals. No changes were made to the supplied folder. Tests and review probes ran in a separate copy using synthetic records and mock providers.

### What I would preserve

- **One continuous case record.** The user can move from a workplace problem through an internal process and Acas without rebuilding their history.
- **A service layer separate from the web framework.** This made meaningful checks possible without running a browser or contacting live providers.
- **Deterministic deadline calculations and a source registry.** The architecture is appropriate; the problems are in inputs, rule maintenance and state handling.
- **Explicit confirmation of extracted facts and events.** Proposed information is generally kept separate from confirmed records.
- **No outcome scores, and claim features disabled by default.** These are useful product boundaries, although their enforcement needs strengthening.
- **Offline testability.** The mock provider and embedded test database make regression testing practical.

### Priorities at a glance

P0 means a blocker before exposing this snapshot to real users with sensitive records. P1 means fix before a relevant feature enters a pilot or takes payment. P2 means a planned product or operational improvement. These are review priorities, not formal vulnerability scores.

| Order | Improvement | Priority | Evidence |
|---|---|---|---|
| 1 | Close cross-user reads, writes and incorrectly linked records | P0 | Three reproduced service-level defects |
| 2 | Preserve uncertainty and use the correct trigger for each deadline | P0 | Missing dates and approximate dates reproduced |
| 3 | Correct Acas date handling and pending-conciliation status | P0 | Reproduced status defect; source/UI mismatch |
| 4 | Recalculate dates after every relevant change and as time passes | P0 | Three reproduced stale-state defects |
| 5 | Enforce feature switches inside every generation path | P1 | ET1 generation reproduced with switch absent |
| 6 | Reconcile legal rules with current primary sources | P1, before legal reliance | Current official timetable differs from constants |
| 7 | Make document extraction complete, traceable and recoverable | P1 | Email-body loss and silent output coercion reproduced |
| 8 | Recover interrupted jobs and make payment processing resilient | P1 | Job and payment failure cases reproduced |
| 9 | Add HTTP, browser and adversarial regression coverage | P1 | Existing tests pass despite these defects |
| 10 | Simplify intake, improve evidence review and offer usable exports | P2 | Source/UI review; usability testing still needed |

## 1. Close the data-isolation gaps

### F01 — A claim-detail request can return another user's reasoning

**P0 · Reproduced, probe R01**

`listClaimElements` checks that the caller owns the supplied case, then queries claim elements using only the candidate ID. It does not require that candidate or its elements to belong to the authorised case. In the review probe, Alice supplied her own case ID and Bob's candidate ID and received Bob's private claim reasoning.

The HTTP router exposes this lookup when claim identification is enabled. Exploitation requires knowing another candidate ID; the review did not establish an ID-discovery mechanism or evidence of a deployed breach.

**Change:** require both the candidate ID and case ID in the query, validate the candidate's ownership, and apply the same pattern to every nested resource. Test Alice's case with Bob's resource ID, not just Bob's case ID.

**Acceptance:** cross-user and cross-case combinations return the same not-found response as missing resources, with no data returned.

**Evidence:** [src/claims/service.ts:109](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/claims/service.ts:109>); [src/app/api/cases/[caseId]/[[...path]]/route.ts:257](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/app/api/cases/[caseId]/[[...path]]/route.ts:257>).

### F02 — Editing an artifact can change its case ownership

**P0 · Reproduced, probe R03**

The artifact edit function accepts a TypeScript-shaped patch, but the HTTP body is not validated against an allow-list. It spreads the supplied patch into a database update. A synthetic request adding `caseId` moved Alice's artifact into Bob's case. The service then threw an error when it tried to read the artifact from Alice's original case, but the database change had already happened. Bob could read the injected content.

**Change:** validate the request at runtime with a strict schema allowing only `content`, `title` and permitted status values. Build the update explicitly, and include the authorised case in the update condition. Ownership, provenance, basis hashes and generation metadata must be server-controlled.

**Acceptance:** unexpected keys are rejected before any write; attempts to alter `caseId`, `generatedBy`, `basis` or `stale` have no effect.

**Evidence:** [src/artifacts/service.ts:169](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/artifacts/service.ts:169>); [src/app/api/cases/[caseId]/[[...path]]/route.ts:250](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/app/api/cases/[caseId]/[[...path]]/route.ts:250>).

### F03 — An uploaded document can be attached to another case's process

**P0 · Reproduced, probe R11**

Document upload checks access to the case but accepts `processId` without checking that the process belongs to it. Extraction subsequently inserts allegations against that process ID. The database checks that the case and process exist separately; it does not enforce their relationship. The probe placed an allegation from Alice's document into Bob's disciplinary process, and Bob's process listing returned it.

**Change:** validate all referenced objects before enqueueing work, then revalidate ownership in the worker. Add database constraints tying child records to their parent case where feasible. Apply this to document, event, issue, person and process references, not just the reproduced path.

**Acceptance:** a foreign process ID cannot create a job or allegation; background processing cannot create inconsistent case/process pairs.

**Evidence:** [src/documents/service.ts:41](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/documents/service.ts:41>); [src/documents/service.ts:230](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/documents/service.ts:230>); [src/processes/service.ts:175](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/processes/service.ts:175>); [src/db/schema.ts:405](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/db/schema.ts:405>).

## 2. Make deadlines trustworthy throughout the journey

### F04 — Missing trigger dates are replaced with a different event

**P0 · Reproduced, probes R04 and R07**

At case level, the last-act date falls back to the employment end date. The deduction date can then fall back to that result. These events are not interchangeable. In a discrimination case with only an employment end date of 1 September 2026, the app calculated 30 November 2026 and reported no missing input for the discrimination trigger, even though no discriminatory-act date had been supplied.

Approximation also gets lost: intake records “approximate” in the fact's prose, but the persisted deadline calculation does not pass `triggerApproximate`. The probe confirmed that the final explanation no longer carried that warning.

**Change:** give each claim family an explicit, typed trigger record containing its date, precision, source and confirmation status. Ask the user to link a dismissal to a discrimination allegation where relevant; do not infer the relationship merely because a dismissal exists. Missing or contested triggers should produce a visible uncertainty state. Preserve approximation as structured data through intake, storage, calculation and export.

**Acceptance:** missing deduction/act dates remain missing; an approximate input cannot become an exact-looking deadline after saving the case.

**Evidence:** [src/legal/deadlines/case-deadlines.ts:46](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/deadlines/case-deadlines.ts:46>); [src/intake/service.ts:127](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/intake/service.ts:127>); [src/legal/deadlines/engine.ts:166](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/deadlines/engine.ts:166>).

### F05 — Pending Acas conciliation can be labelled expired; Day B uses issue date

**P0 · Reproduced status defect, probe R05; verified source/UI mismatch**

When Day A is present but Day B is missing, the engine explains that the clock is paused, yet returns the original deadline as a calculated or expired date. In the probe, an event on 1 January 2026, timely Acas notification on 1 March, and no Day B produced an “expired” deadline of 31 March when evaluated on 1 April. The explanation and headline contradict each other.

The app also asks for a certificate **issue** date and mirrors it to `acas_day_b`. Acas guidance ties the post-conciliation minimum period to receipt of the certificate. Issue and receipt must not be silently treated as identical. [Acas: how early conciliation works](https://www.acas.org.uk/early-conciliation/how-early-conciliation-works).

**Change:** store notification, certificate issue and receipt/deemed-receipt information separately, with an explicit basis for Day B. Represent pending conciliation as “extension not yet calculable”, retaining the unadjusted date only as clearly labelled background information. Reject inconsistent dates rather than silently clamping Day B up to Day A. Check the applicable statutory provision and any relevant service rules before finalising the implementation.

**Acceptance:** pending timely conciliation never produces an unqualified expired headline; issue/receipt differences, missing dates and reversed dates have explicit tests and explanations.

**Evidence:** [src/legal/deadlines/engine.ts:72](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/deadlines/engine.ts:72>); [src/legal/deadlines/engine.ts:213](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/deadlines/engine.ts:213>); [src/processes/service.ts:125](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/processes/service.ts:125>); [src/components/case/Acas.tsx:85](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/components/case/Acas.tsx:85>).

### F06 — Corrected dates can leave old deadlines in place

**P0 · Reproduced, probes R06, R15 and R16**

Three separate paths leave persisted dates or statuses stale:

- `date_of_deduction` is absent from the fact-to-deadline invalidation map. Changing it from 1 August to 1 September left the wage deadline at 31 October.
- Changing a grievance appeal window from five to ten days marked artifacts stale, but left the saved appeal deadline at five days.
- `listDeadlines` returns saved rows unless missing or explicitly stale. Moving the clock beyond a deadline did not change its saved status from `calculated` to `expired`.

**Change:** centralise deadline dependencies, including process dates and appeal windows. Keep the legal calculation separately from time-sensitive presentation: “days remaining” and expiry should be evaluated against today's date. Use a transaction when replacing deadline rows, and reconcile generated tasks so obsolete instructions do not remain open.

**Acceptance:** changing any consumed input updates the displayed date and tasks; crossing midnight updates urgency without requiring an unrelated case edit.

**Evidence:** [src/cases/staleness.ts:42](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/cases/staleness.ts:42>); [src/processes/service.ts:111](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/processes/service.ts:111>); [src/legal/deadlines/case-deadlines.ts:150](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/deadlines/case-deadlines.ts:150>).

## 3. Enforce the product's legal and AI boundaries

### F07 — The generic generation route bypasses feature switches

**P1 · Reproduced, probe R02**

The claim-identification endpoint has a server-side switch, but generic artifact generation accepts every declared artifact type and checks payment entitlement only. With `ENABLE_PERSONALISED_ET1_DRAFTING` absent, the probe still generated an ET1 artifact through the mock model. This differs from the separate, deterministic readiness-pack path, which the documentation intentionally allows without that drafting switch.

**Change:** centralise a policy mapping each artifact type to required feature switches and entitlements. Enforce it inside the generation service. Apply the equivalent check to possible-claims summaries, and reconcile selling a Claim Pack with the paid-claim feature switch and the features actually available.

**Acceptance:** every route and direct service entry point refuses model-drafted ET1 output when disabled, while permitted deterministic preparation remains available.

**Evidence:** [src/artifacts/service.ts:94](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/artifacts/service.ts:94>); [src/entitlements/service.ts:48](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/entitlements/service.ts:48>); [src/et1/service.ts:189](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/et1/service.ts:189>); [coffeecup/docs/REGULATORY_FEATURE_FLAGS.md:7](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/docs/REGULATORY_FEATURE_FLAGS.md:7>).

### F08 — Legal-source governance needs executable change control

**P1 before relying on the legal outputs · Source comparison**

The code contains specific commencement assumptions which now diverge from the government's timetable updated on 25 September 2026:

| Area | Stored position | Current official timetable |
|---|---|---|
| Harassment measures | 1 October, marked TBC | 30 October 2026 |
| Duty to inform workers about trade-union membership | October 2026 | January 2027 |
| NDA reforms | October 2026 | 2027 |
| Longer tribunal limits | Assumed October date; confirmation hard-coded false | 1 October 2026, with Scottish employment-contract claims on 9 November |

These are verified differences from the official timetable, **not a completed audit of every commencement instrument or transitional provision**. The timetable itself cautions that future dates remain subject to parliamentary processes. [Government implementation timetable](https://www.gov.uk/government/publications/implementing-the-plan-to-make-work-pay-and-employment-rights-act/plan-to-make-work-pay-and-employment-rights-act-timeline-update).

There is also a configuration inconsistency: deployment guidance describes setting `TIME_LIMIT_SI_CONFIRMED`, while the implementation fixes it as `false`. The contract rules use the same commencement window for England/Wales and Scotland. Merely flipping one global switch would not resolve those differences.

**Change:** make each legal change a reviewed record containing instrument, exact provision, jurisdiction, commencement, transition conditions, reviewer and verification date. Distinguish announced, made and commenced changes. Add boundary tests for each jurisdiction and transitional cohort. Record source verification per entry rather than assigning one blanket review date. Trigger re-review when official sources change.

**Acceptance:** the release includes an approved source-to-rule matrix and tests that prove which version applies before and after each relevant transition. Until then, uncertainty should be explicit rather than presented as current certainty.

**Evidence:** [src/legal/era-2025.ts:21](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/era-2025.ts:21>); [src/legal/era-2025.ts:278](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/era-2025.ts:278>); [src/legal/rules/time-limits.ts:189](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/rules/time-limits.ts:189>); [src/legal/sources/registry.ts:43](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/sources/registry.ts:43>); [coffeecup/docs/DEPLOYMENT.md:97](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/docs/DEPLOYMENT.md:97>).

### F09 — Drafting provenance is weaker than the product promise

**P1 · Source-confirmed design gap; sanitiser defect reproduced in R14**

The system stores a useful list of source IDs and an input hash. However, generic drafting accepts unchecked free text from the model, with no sentence-level source mapping or factual validation before saving it. The `extra` object supplied by an API caller is spread after authoritative fields, so it can overwrite the facts, events or people sent to the model without those replacements being represented in the saved basis hash. This undermines the stated promise that drafts derive from the confirmed case record.

The claim-review word filter is also insufficient: it replaces only the first match, and the probe retained “weak” and “90%” in reasoning after removing “strong”. This is a demonstrated output-control gap, not evidence that a live model produced those words in use.

**Change:** allow-list supplementary drafting instructions and prevent them replacing authoritative context. Record a versioned generation snapshot with task, prompt, model, source versions and precise inputs. Require substantive draft propositions to refer to supplied facts, and flag additions or unsupported assertions for review. Treat document text as untrusted evidence, with prompt-injection and conflicting-evidence evaluation cases. Use deterministic checks as part of this process, not a claim that wording filters can prove legal correctness.

**Acceptance:** callers cannot rewrite authoritative context through `extra`; saved provenance matches actual generation inputs; unsupported names, dates, quotations and outcome assertions are caught by the evaluation set.

**Evidence:** [src/artifacts/service.ts:108](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/artifacts/service.ts:108>); [src/ai/tasks/draft.ts:43](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/ai/tasks/draft.ts:43>); [src/ai/structured.ts:71](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/ai/structured.ts:71>); [src/legal/claims/review.ts:38](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/legal/claims/review.ts:38>).

## 4. Improve document accuracy and recovery

### F10 — Standard email files can lose their body

**P1 · Reproduced, probe R08**

`parseEml` searches for a line-feed-only header/body separator. A normal email using CRLF line endings did not match, and its body disappeared from the returned text. Headers remained, so extraction could still appear successful.

**Change:** use a maintained MIME parser, or implement and test line endings, folded headers, multipart messages, encoded content and attachments explicitly. Preserve the original and identify exactly which parts were extracted.

**Acceptance:** a representative email corpus produces the expected body and attachment inventory. An unreadable body must produce a partial/failed status, not a successful empty interpretation.

**Evidence:** [src/documents/extract/index.ts:43](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/documents/extract/index.ts:43>).

### F11 — Extraction success does not reliably mean the document was covered

**P1 · Reproduced schema behaviour, R10; additional source findings**

The extraction schema uses `.catch([])` on arrays. An invalid event caused the event array to become empty while validation reported success. Separately, extraction sends only the first 60,000 characters to the model without a visible coverage record. Quotes requested for facts are discarded during persistence; an event's quote is kept only as a fallback description. There is no durable page/paragraph location supporting the review screen.

**Change:** distinguish complete, partial and failed extraction. Preserve validation failures with item-level diagnostics, chunk long documents with a coverage manifest, retain verified source quotes and page/span anchors, and deduplicate proposals across retries. Add OCR as an explicit later capability for scans and images, with quality checks and a manual fallback.

**Acceptance:** malformed output or a partially processed document cannot receive an unqualified completed status; every proposed fact can be checked against the original location; retrying does not multiply equivalent facts.

**Evidence:** [src/ai/tasks/extract-document.ts:22](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/ai/tasks/extract-document.ts:22>); [src/ai/tasks/extract-document.ts:81](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/ai/tasks/extract-document.ts:81>); [src/documents/service.ts:209](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/documents/service.ts:209>).

### F12 — Interrupted work can remain stuck indefinitely

**P1 · Reproduced worker defect, R09; source/UI findings**

The worker picks queued jobs but has no lease expiry for jobs already marked processing. A simulated abandoned processing job remained stuck when the queue ran again. Retries after ordinary exceptions can also happen immediately in the same run, without backoff.

The document screen refreshes after the upload request, but does not poll while a production worker processes it. Its “Try again” button requires extracted text, so a failed document with no text can lack the recovery action. Reprocessing also creates a new job without carrying forward the original `processId`.

**Change:** add expiring leases, bounded retry/backoff, cancellation and idempotency. Preserve extraction context and prevent reprocessing deleted cases. Show live status while work is pending, and allow retry based on the failure type rather than whether text exists.

**Acceptance:** killing a worker mid-job does not require a database edit to recover; retry retains the disciplinary-process link; partial writes do not cause duplicate proposals.

**Evidence:** [src/jobs/service.ts:68](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/jobs/service.ts:68>); [src/jobs/service.ts:100](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/jobs/service.ts:100>); [src/documents/service.ts:139](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/documents/service.ts:139>); [src/components/case/Documents.tsx:22](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/components/case/Documents.tsx:22>); [src/components/case/Documents.tsx:82](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/components/case/Documents.tsx:82>).

## 5. Make paid and production operations dependable

### F13 — Webhook replay protection can prevent recovery

**P1 before accepting payments · Reproduced, probes R12 and R13**

An event is inserted before its entitlement change, outside a shared transaction. If the entitlement write fails, retry sees the inserted event and returns “duplicate”, even though processing never completed. The review induced a foreign-key failure to demonstrate this control flow; it did not simulate a real payment-provider outage.

The second probe delivered a refund before checkout completion. The refund was ignored because there was no entitlement yet, and the later completion granted active access. Delivery order cannot safely be assumed: Stripe documents retries, duplicate events and out-of-order delivery. [Stripe webhook guidance](https://docs.stripe.com/webhooks#event-ordering).

**Change:** persist receipt separately from successful processing, make entitlement changes atomic with processing status, and reconcile current payment state rather than trusting arrival order. Add a unique purchase/entitlement identity, retryable failure handling and tests for delayed success, refund, dispute and duplicate delivery. Do not classify internal storage failures as invalid signatures.

**Acceptance:** interrupted processing is recoverable; out-of-order refunds cannot leave paid access incorrectly active; concurrent delivery cannot duplicate grants.

**Evidence:** [src/payments/service.ts:65](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/payments/service.ts:65>); [src/payments/providers/stripe.ts:47](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/payments/providers/stripe.ts:47>); [src/app/api/payments/webhook/route.ts:21](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/app/api/payments/webhook/route.ts:21>).

### F14 — Production controls need stronger defaults and observable failure

**P1/P2 depending on deployment · Source review**

Several limitations are already documented but should become enforced operating constraints:

- The rate limiter is per process and assumes a specific trusted proxy arrangement. Make the deployment topology explicit and use a shared limiter for multiple instances, with account-level protection as well as trusted client identity.
- Fair-use counters perform a read followed by an update, allowing races. Situation-summary generation bypasses that counter entirely. Reserve usage atomically and apply the policy to all paid model calls.
- JSON and file bodies are fully read before application size checks. Bound request streaming and extraction resource use; a small compressed document may also expand substantially.
- Production can fall back to embedded storage when the database URL is absent. Validate production configuration at startup and refuse unintended fallback, placeholder operator/contact details and incomplete recovery-email configuration.
- The health endpoint retrieves the cached database handle without necessarily checking a live query, and returns raw error messages on failure. Separate minimal public liveness from internal readiness and dependency diagnostics.
- Account creation, recovery, source corrections and derived-record replacement use multiple writes. Use transactions where a partial operation would leave an inconsistent record, and test recovery after failure.

**Acceptance:** startup failures are actionable; database and worker failures are observable without exposing case content; limits work across instances; restore and deletion procedures are exercised against the intended production infrastructure.

**Evidence:** [src/lib/rate-limit.ts:15](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/lib/rate-limit.ts:15>); [src/entitlements/fair-use.ts:35](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/entitlements/fair-use.ts:35>); [src/cases/dashboard.ts:107](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/cases/dashboard.ts:107>); [src/lib/http.ts:37](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/lib/http.ts:37>); [src/db/client.ts:73](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/db/client.ts:73>); [src/app/api/health/route.ts:6](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/app/api/health/route.ts:6>).

The production dependency audit reported **two affected package entries: one high and one moderate**, associated with PostCSS and Next's dependency chain. This is advisory evidence, not proof that these paths are remotely exploitable in this application. Review the dependency paths and update to compatible fixed versions with regression checks. The full audit, including advisory URLs, is included in the evidence archive. Do not apply an unreviewed major-version upgrade simply to clear an audit count.

## 6. Product improvements I would make next

These are recommendations from the implementation and UI source, not findings from user interviews or a completed browser accessibility audit.

### A shorter, safer first session

Break intake into a few short steps: immediate concern and jurisdiction; the user's account; important dates; review and save. Show urgent deterministic guidance before waiting for optional model classification. Give “I don't know” and approximate-date answers proper support, and keep the narrative available after recoverable errors. Explain third-party model processing before anonymous free text is sent; “not saved in our database” is a different claim from “not processed elsewhere”.

Measure whether a new user can save a useful case record and identify one next step without understanding legal categories. The current intake's many fields and the wait for route inference are candidates for usability testing, not grounds for an arbitrary redesign.

**Evidence:** [src/components/intake/TriageForm.tsx:21](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/components/intake/TriageForm.tsx:21>); [src/intake/service.ts:67](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/intake/service.ts:67>).

### A proper evidence-review workspace

Put the original document beside each proposed fact or event, with the relevant passage highlighted. Separate “the document says this”, “I confirm this happened” and “the employer alleges this”. Provide keyboard navigation, correction, rejection, conflict resolution and a clear remaining-items count. Avoid treating model confidence percentages as calibrated reliability scores.

Make one evidence inbox cover proposed facts, events and allegations. Preserve originals and source locations after correction; a user should not have to download a file, search for a sentence and return to another tab to confirm a proposal.

**Evidence:** [src/components/case/Timeline.tsx:101](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/components/case/Timeline.tsx:101>); [src/documents/service.ts:209](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/documents/service.ts:209>); [src/facts/service.ts:161](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/facts/service.ts:161>).

### A dashboard that makes the next action obvious

Keep urgent dates, waiting-on-someone states and one primary next action near the top. Rank tasks by urgency and dependency rather than simply taking the first open rows. Resolve obsolete system tasks after corrections. Explain why a next step is suggested and let the user dismiss irrelevant suggestions.

Use progressive disclosure for the detailed case record. Test keyboard-only operation, screen-reader announcements, mobile layouts, zoom and interrupted form submission. The shared `Field` component needs explicit input/hint/error associations, especially where it wraps groups of controls.

**Evidence:** [src/cases/dashboard.ts:66](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/cases/dashboard.ts:66>); [src/cases/dashboard.ts:91](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/cases/dashboard.ts:91>); [src/components/ui.tsx:65](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/components/ui.tsx:65>).

### Exports people can actually use

Add editable Word and printable PDF exports alongside Markdown/JSON. Build an adviser handover pack with chronology, indexed documents, source references, disputed matters, outstanding questions and a concise change history. Offer a complete archive of originals with a manifest rather than only a document list.

Keep generated, user-edited and superseded versions distinct. Warn visibly about stale material on export, and make the user's review status separate from any claim of legal approval. Keep a basic user-data export available independently of paid document-generation features; the current case-pack export is entitlement-gated.

**Evidence:** [src/exports/service.ts:30](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/exports/service.ts:30>); [src/exports/service.ts:76](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/exports/service.ts:76>); [src/components/case/Exports.tsx:64](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/src/components/case/Exports.tsx:64>).

## 7. Testing and architecture

### Replace broad assurances with tests at the actual boundaries

The existing service tests are worth keeping. Add these layers:

| Layer | What it should establish |
|---|---|
| HTTP integration | Session handling, runtime input validation, nested-resource ownership, disabled features, uploads and error responses |
| Browser journeys | Account-to-case persistence, extraction progress, review/correction, recovery, export and accessible navigation |
| Legal regression corpus | Independently checked dates, uncertainties, event/jurisdiction distinctions and commencement transitions |
| Concurrency and failure | Interrupted jobs, duplicate work, simultaneous corrections, payment reordering and partial writes |
| Model evaluation | Unsupported facts, prompt injection, conflicting documents, missing information, truncation and source fidelity |
| Deployment checks | Real PostgreSQL migrations, backup restore, production configuration and dependency advisories |

The review probes should become regression tests asserting the **corrected** behaviour. Their current passing results mean the defects were reproduced, not that the application is safe.

### Keep one active implementation

The root README clearly identifies coffeecup as active and the Rust application as a reference. The Rust README still describes a missing `../tribunal-harness/` application as the unchanged reference. Older architecture and reconciliation files also describe decisions predating the current rebuild.

**My recommendation:** retain the Next.js/service-layer product as the implementation to improve. Mark historical plans and the Rust reference with an explicit status and source snapshot. Keep one current decision log and one launch-scope document. Do not treat the historical February 2027 launch statement or proposed model/backend choice as a fresh instruction from you.

Rust fixture parity is useful evidence of matching an earlier implementation; it does not establish independent legal correctness or parity with today's coffeecup. If the Rust build remains supported, add its checks to CI and share an independently verified legal test corpus. Otherwise label it clearly as an archived reference. Consider a port only for a measured need after the current defects are resolved.

**Evidence:** [README.md:25](</Users/ciaran/Downloads/Tribunal-Harness-main/README.md:25>); [tribunal-harness-rs/README.md:3](</Users/ciaran/Downloads/Tribunal-Harness-main/tribunal-harness-rs/README.md:3>); [tribunal-harness-rs/PARITY.md:1](</Users/ciaran/Downloads/Tribunal-Harness-main/tribunal-harness-rs/PARITY.md:1>); [coffeecup/README.md:46](</Users/ciaran/Downloads/Tribunal-Harness-main/coffeecup/README.md:46>); [.github/workflows/ci.yml:11](</Users/ciaran/Downloads/Tribunal-Harness-main/.github/workflows/ci.yml:11>).

## 8. Suggested implementation sequence

| Stage | Work | Exit condition |
|---|---|---|
| A — protect records | F01–F03; strict patch schemas; case-aware child references | Cross-user and cross-case tests fail closed without partial writes |
| B — make dates dependable | F04–F06; correct Acas inputs; F08 source review | Verified calculation and uncertainty corpus passes across UI, API and exports |
| C — contain generated output | F07 and F09; authoritative context; generation snapshots | Disabled features cannot run; generation basis matches actual inputs |
| D — reliable operations | F10–F14; extraction, job leases, payments, atomic writes | Failure/retry tests pass and recovery procedures work |
| E — focused user pilot | Evidence review, short intake, live progress, useful exports | Users complete representative journeys and recover from mistakes |

A–C are the first engineering tranche. D is required before the corresponding production features are enabled. E should use a deliberately limited scope with feedback from representative workers and advisers. Effort estimates need the maintainer's deployment assumptions and staffing; assigning calendar dates from this review alone would be misleading.

The pilot should demonstrate one complete journey well: describe a workplace problem, save evidence, verify a chronology, prepare a useful internal-process document and export the record. Expand claim features after their source governance and access controls have been verified.

## 9. Verification record and limits

| Check | Result |
|---|---|
| Supplied folder inventory | 381 files fingerprinted before review |
| Existing test suite | 18 test files passed; 239 tests passed, two skipped |
| Type checking | Passed |
| Lint | Passed |
| Production build | Passed |
| Additional review probes | 16/16 reproduced the behaviours described above |
| Production dependency audit | Two affected package entries: one high, one moderate; exit status 1 because findings exist |
| Rust compilation/tests | Not run: Cargo was unavailable in this environment |
| Browser/accessibility audit | Not performed; UI conclusions are source-based |
| Live AI, payment and email integrations | Not exercised; no user data sent to those providers |
| Legal-source check | Targeted Acas and government-timetable checks; not a full audit of every authority, statute or transition |
| Original folder | All 381 file fingerprints unchanged at completion |

The execution environment used Node 23.11.0, whereas CI specifies Node 22. Dependency installation emitted an engine warning for a lint dependency. All reported application checks completed successfully nevertheless; repeat the release gate on the intended supported Node version. Dependencies were installed from the lockfile into the review copy, with package install scripts disabled.

The review used separate passes for architecture, critical source paths, executable probes and final evidence verification. The decisive finding was that passing happy-path and service tests did not establish isolation across nested resources or consistency across the deadline lifecycle.

The report samples important implementation paths across both applications; it is not a line-by-line audit of every file, a penetration test of a deployed service or a certification of legal compliance. Fetches of some legislation.gov.uk pages failed because of content-type/rate-limit responses, so the report does not claim to have verified the complete commencement instruments.

**Supporting material:** [Review evidence archive](/Users/ciaran/Documents/Codex/2026-09-26/wha/outputs/Tribunal-Harness-Review-Evidence.zip) contains the synthetic reproduction tests, check logs, dependency audit and source-integrity result. No changes or fixes were applied to the supplied code.
