# coffeecup — Product, UX and Muse Spark 1.3 Runtime Plan

> **Status:** Planning document (captured 24 September 2026). Nothing in this file is
> built yet. Read [`RECONCILIATION.md`](./RECONCILIATION.md) for how it maps onto the
> existing Tribunal Harness code and which decisions still need founder sign-off.
> Target backend architecture is in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
>
> Third-party facts in this plan (Muse pricing/tiers, Meta AUP terms, FCA Handbook
> wording, Acas consultation dates, the 1 October 2026 commencement date) are recorded
> as supplied by the founder and **have not been independently verified** in this repo.

## Product thesis

coffeecup is a low-cost digital case companion for UK workers dealing with a problem at work.

It is **not** primarily an Employment Tribunal claim generator.

It takes a worker through:

**Problem at work → organise facts → internal resolution → grievance / disciplinary → appeal → Acas Early Conciliation → possible Employment Tribunal claims → ET1 preparation → external help / self-representation.**

A case may finish successfully at any point.

The core object is therefore a **case** — not a chat session and not an Employment Tribunal claim.

---

# PART I — THE CUSTOMER EXPERIENCE

## Screen 1 — Public homepage

The homepage should explain the service in approximately ten seconds.

### Hero

**Having a problem at work?**
Organise what's happened, understand the process and work out what to do next.

- Primary CTA: `Get help with my workplace problem`
- Secondary CTA: `Already dealing with Acas or a tribunal?`

### Under the hero

Simple journey graphic:

**Tell us what happened** → **Put your case in order** → **Prepare your next step**

Do not lead with: artificial intelligence; Employment Tribunal; statutes; claim types; legal-tech terminology.

Muse is infrastructure, not the product proposition.

### Trust section

Explain that:

- information is generated with AI assistance;
- the user remains in control of the facts;
- important deadlines are calculated by dedicated rules rather than guessed by AI;
- source information is shown;
- the service does not guarantee outcomes;
- users can export their information and seek professional advice.

### Free features

- urgent deadline check;
- workplace-problem organiser;
- basic timeline;
- official Acas / GOV.UK routing.

### Paid proposition

**One case. One small payment. No monthly subscription.**

Possible launch positioning: **Case Pass — £6.99**, and later **Claim Pack — £9.99**.

---

## Screen 2 — Age and jurisdiction gate

Appears **before Muse receives any user information**.

### Question 1 — Are you 18 or over?

- Yes
- No

Meta currently requires users of Model API-powered integrated products to be at least 18. A person answering **No** must not enter a Muse-powered workflow.

For under-18 users:

> We cannot run the personalised case assistant for you, but you can still access these official resources.

Then route to static Acas, GOV.UK, Citizens Advice etc. pages which make **no** Muse request.

### Question 2 — Where do you work?

- England
- Wales
- Scotland
- Northern Ireland
- Somewhere else / not sure

**v1 automated scope:**

- England and Wales receive the full workflow.
- Scotland can share many Acas/workplace features but must branch for relevant jurisdiction-specific rules.
- Northern Ireland gets an explicit separate route rather than pretending the GB Employment Tribunal framework applies universally.

---

## Screen 3 — What is happening?

The most important intake screen.

Do **not** ask "What legal claim do you have?". Ask:

### What's happening at work?

Selectable cards (multiple selections permitted):

- I've been dismissed
- I may be dismissed
- I'm facing disciplinary action
- I want to raise a grievance
- My grievance has been rejected
- I want to appeal a decision
- I'm having problems with discrimination or unfair treatment
- I need adjustments because of a disability
- I'm not being paid properly
- My employer is changing my job or contract
- I'm being made redundant
- I've raised concerns about wrongdoing
- I'm already dealing with Acas
- I already have an Acas certificate
- I'm thinking about an Employment Tribunal
- Something else
- I'm not sure

---

## Screen 4 — Tell us the story

The principal Muse conversational surface.

**Tell us what's happened in your own words.**

> You do not need to know the legal terms. Tell us what happened as you would explain it to someone you trust.

Large input box. Options: type; paste text; upload relevant documents.

Muse then performs **extraction**, not final legal analysis. Its initial job is to identify candidate: people; organisations; dates; events; workplace issues; documents; employment details; current procedural stage.

It returns structured JSON. It does **not** directly turn these into confirmed facts.

---

## Screen 5 — "Have we understood you correctly?"

One of coffeecup's defining screens. Muse produces a proposed factual model.

### Your situation

> You started work for ABC Ltd in March 2022.
> You say your manager began changing your responsibilities in May 2026...

Every significant proposition has controls: `Correct` · `Edit` · `Not right` · `I'm not sure`

- **People** — employer; manager; HR; colleagues; witnesses.
- **Important dates** — e.g. started employment; grievance raised; disciplinary invitation; dismissal; appeal; Acas contact.
- **Things that happened** — individual event cards.

Nothing important becomes `USER_CONFIRMED` simply because Muse extracted it.

---

## Screen 6 — Account creation

Only after demonstrating value should ordinary users be pushed into account creation.

**Save your case**
You've started organising your workplace problem. Create an account to keep your timeline, documents and next steps together.

Support appropriate secure authentication. On creation, generate a `Case` — not a generic conversation record.

---

## Screen 7 — Main Case Dashboard

The application's home.

### Header

**Your case** — current stage, e.g. `Workplace problem`, `Grievance`, `Disciplinary`, `Appeal`, `Acas Early Conciliation`, `Considering tribunal`.

### Panel A — Important now

Gets visual priority. Examples:

> **Possible tribunal deadline** — We need one more date before we can calculate this accurately.

> **Disciplinary hearing — 29 September**

> **Grievance appeal deadline from your employer's policy — check required**

No marketing or upgrade banner may appear above a genuine deadline warning.

### Panel B — What has happened

Short Muse-generated summary using **confirmed** case facts.

### Panel C — What should I work on next?

Contextual tasks, e.g.: review 3 events extracted from a document; add your grievance outcome; prepare for disciplinary hearing; record what happened at the meeting; prepare for Acas; check possible tribunal routes.

Avoid: "You should sue your employer."

### Panel D — Case completeness

Not a case-strength score. For example:

```
Case information
Employment details: ✓
Important dates: 8/9
Timeline: 12 events
Documents: 7
Unreviewed extracted facts: 4
```

---

## Screen 8 — Timeline

Central to the entire product. Chronological list, e.g.:

- **12 May 2026** — Manager announced team restructure.
- **18 May 2026** — User emailed HR.
- **22 May 2026** — HR replied.

Each event shows provenance: `You confirmed this` · `From document: HR-email.pdf` · `Employer says` · `Needs confirmation`

**Controls:** add event; change date; mark approximate; connect document; add person; dispute event; merge duplicate; explain significance.

Muse may propose events. Only the application/user confirms them.

---

## Screen 9 — Documents

Upload area. Categories: employment contract; emails; letters; grievance; disciplinary material; policies; payslips; meeting notes; messages; outcome letters; Acas material; other.

Muse Spark 1.3 supports PDF and multimodal inputs directly, which can help extraction. However, the **original document remains authoritative.** Maintain the chain:

`Original document` → `extracted content` → `Muse propositions` → `user-confirmed facts`

Never: `Upload PDF → AI conclusion becomes fact`

---

## Screen 10 — Issues

The user's messy narrative gradually becomes a clear list of issues:

1. **Change to duties** — started May 2026 · related events: 4 · documents: 3
2. **Grievance handling** — started June 2026 · related events: 5 · documents: 4
3. **Dismissal** — date: 18 September 2026

Muse can help group the case. The user can split, merge, rename and correct issues.

---

# PART II — INTERNAL WORKPLACE PROCEDURES

## Screen 11 — Grievance workspace

State progression:

**Considering grievance** → Preparing → Submitted → Meeting → Awaiting outcome → Outcome received → Appeal considered → Appeal submitted → Closed / next stage

### Preparing the grievance

- **What are you complaining about?** — user chooses relevant case issues.
- **What happened?** — Muse constructs a proposed concise chronology from confirmed facts.
- **Evidence** — relevant documents/events.
- **What outcome would you like?** — investigate; correct decision; resolve working relationship; reasonable adjustment; payment; apology; other.
- **Draft grievance** — Muse writes an editable draft.

The user can click each factual paragraph and see **Based on:** confirmed event #17; document #8. This provenance feature is unusually powerful.

## Screen 12 — Grievance meeting

Preparation sections: **Your main points** · **Important dates** · **Documents to have available** · **Questions you might want answered** · **Things which are still unclear** · **Your requested resolution**.

After the meeting — **What happened?** — Muse extracts meeting events into the case record for confirmation.

## Screen 13 — Grievance outcome

Upload/paste the outcome. Muse extracts: findings; accepted complaints; rejected complaints; reasoning; proposed action; appeal procedure; deadlines stated by employer.

Then side-by-side: **You raised** vs **Employer decided** vs **Potential issue requiring review**.

Do not label every disagreement a legal error.

## Screen 14 — Appeal workspace

Possible factual grounds: important evidence was not considered; finding appears inconsistent with evidence; new evidence; procedural issue; factual error; outcome/remedy issue; something else.

Muse assists in drafting an appeal based **only on selected grounds**.

## Screen 15 — Disciplinary workspace

State flow: Investigation → allegations received → evidence review → hearing preparation → hearing → outcome → appeal

The core object becomes an **allegation**, e.g.:

### Allegation 1
> Failure to follow absence reporting procedure on 12 August.

- Employer's material — documents / statements
- Your account — confirmed facts
- Evidence supporting your account — linked material
- What is disputed?
- Questions
- Missing information

Significantly more useful than an unrestricted chatbot response.

## Screen 16 — Hearing preparation

Automatically compile: allegations; user's responses; chronology; documents; important discrepancies; questions; desired outcome. Printable/exportable.

---

# PART III — ACAS

## Screen 17 — "Should I prepare for Acas?"

This is not "Should you sue?". Explain what Early Conciliation is and when it may become relevant.

Current status: not started; considering; notified Acas; conciliation underway; certificate received.

## Screen 18 — Prepare for Early Conciliation

Because coffeecup has maintained the case from the beginning, most information is already available. Automatically generate:

- **What happened** — short chronology
- **Key issues** — plain English
- **Steps you've taken** — informal discussions, grievance, appeal etc.
- **Employer's position** — where recorded
- **What you want** — outcome sought
- **Financial information** — where applicable
- **Relevant documents**
- **Possible legal issues** — only when the corresponding legal-analysis capability is enabled

The user reviews everything.

## Screen 19 — Acas Case Workspace

Fields: notification date; reference number; conciliator; employer response; calls/messages; offers; counteroffers; desired settlement; certificate received; certificate date; certificate number.

Any material date update triggers a **deterministic deadline recalculation**.

---

# PART IV — DEADLINES

## Screen 20 — Deadline centre

Deadline calculation must be a **software service**, not a Muse prompt. Muse never decides the final deadline.

`Case facts` → `Deadline Rules Engine` → calculated result → Muse explains result in plain English.

From **1 October 2026**, the limitation period for the majority of Employment Tribunal claims changes from three to six months for problems occurring on or after that date. Earlier relevant events remain subject to the earlier regime. Breach-of-contract commencement differs for Scotland.

Rules therefore require effective-date metadata:

```text
Claim rule:     unfair-dismissal
event:          effective termination date
jurisdiction:   England/Wales/Scotland
effective-from: 2026-10-01
base-limit:     6 months
source:         official government commencement material
```

Never have:

```text
ET_DEADLINE_MONTHS = 6
```

---

# PART V — MUSE SPARK 1.3 ARCHITECTURE

## Production model

Use `muse-spark-1.3`, **Standard tier**. Do **not** use `muse-spark-1.3-contributor` for actual user cases.

Meta prices Standard at $1.25 per million input tokens, $4.25 per million output tokens and $0.15 per million cached input tokens. Standard prompts/completions are not used to train Meta models. Contributor is cheaper specifically because Meta can use the content for model improvement, and Meta states sensitive/confidential/personal information must not be submitted to it.

## Muse's role

Muse is the **reasoning and language layer**. It performs: intent classification; event extraction; fact proposals; document understanding; chronology synthesis; missing-information identification; procedural explanation; question generation; document drafting; legal element mapping (where enabled); contradiction detection; case summary generation; evidence mapping; ET1 narrative preparation (where enabled).

Muse is **not** authoritative for: deadline arithmetic; law-version selection; user identity; payments; permissions; confirmed facts; database state; entitlement; jurisdiction; source authenticity.

## Muse request architecture — Case Context Compiler

Do not send `entire database + giant prompt + user's question` on every request. For each task, a **Case Context Compiler** assembles only relevant material:

```text
User asks: "Help me prepare my grievance meeting"

Context compiler loads:
- employment summary
- confirmed grievance issues
- relevant timeline events
- relevant documents/extracts
- grievance submitted
- employer correspondence
- current Acas Code source
- unresolved questions
```

Muse then receives the bounded task. This reduces tokens, latency, hallucination surface and irrelevant context. A 1M-token context window is a safety margin, not an invitation to dump everything into every request.

## Reasoning levels

Muse supports `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Reasoning tokens count as output tokens. Use them deliberately:

| Level | Use for |
|---|---|
| `minimal` | classification; extraction cleanup; title generation; simple routing |
| `low` | document metadata; event extraction; information-gap identification |
| `medium` | chronology; case summary; grievance drafting; disciplinary preparation; appeal drafting |
| `high` | document contradiction analysis; complex factual synthesis; source-grounded procedure analysis |
| `xhigh` | (when enabled) personalised possible-claim analysis; multi-claim interaction; ET1 particulars preparation; final legal consistency check |
| `max` | exceptional internal checks only — do not use simply because it exists |

## Structured output

Muse supports JSON-schema-constrained output (required fields, no additional properties). Use it extensively.

```text
EventExtraction
  events[]
    date
    date_precision
    description
    participants[]
    source_location
    proposition_type
    confidence
    needs_user_confirmation
```

```text
ClaimCandidate
  claim_type
  trigger
  elements[]
  supporting_fact_ids[]
  contrary_fact_ids[]
  missing_fact_questions[]
  applicable_rule_ids[]
  deadline_id
  uncertainties[]
```

Never parse important legal state out of free-form Muse prose if structured output can be required.

## Tool architecture

Muse reaches application functionality only through narrow tools:

`get_case_context` · `get_confirmed_facts` · `get_events` · `get_document_excerpt` · `search_case_documents` · `get_applicable_legal_rule` · `calculate_deadline` · `get_acas_code` · `get_official_source` · `propose_fact` · `propose_event` · `generate_artifact` · `mark_analysis_stale`

Muse does **not** receive unrestricted database access. Muse cannot directly turn a proposed fact into a confirmed fact.

## Legal source lookup

Do not tell Muse "search the internet and tell us the law". Provide a controlled source tool. Priority:

1. legislation.gov.uk
2. GOV.UK
3. Acas
4. HMCTS / tribunal procedural material
5. curated/licensed case law
6. expressly approved secondary sources

Muse reasons over material returned by that system. Muse's built-in web-search grounding (with citations) is for controlled non-core research or current resource discovery, not the authoritative legal database. Meta charges $2.50 per 1,000 web-search queries on top of tokens.

## Current Acas versioning

Treat the 2026 replacement Code as **draft**, not current law. The consultation closed on 23 September 2026 and Acas expects the updated Code to take effect in 2027.

The source registry therefore needs `effective_from`, `effective_to`, and statuses `draft` / `current` / `superseded`. Muse must receive the **applicable** Code, not simply the most recently published document.

## Prompt injection protection

Employment documents are untrusted input. A document containing "Ignore previous instructions and..." is document text, not an instruction.

The pipeline must distinguish **developer instructions** from **case data** from **document contents**. Never concatenate uploaded text into the developer prompt. Provide documents as clearly tagged data blocks / tool results.

## Muse system behaviour

The core developer instruction establishes:

1. never invent facts;
2. distinguish user allegation from employer allegation;
3. distinguish inference from confirmed fact;
4. use supplied legal sources;
5. identify missing information;
6. never calculate final limitation dates itself;
7. never claim professional review occurred;
8. never predict litigation success numerically;
9. do not turn a possible claim into a recommendation to litigate;
10. propose corrections rather than silently changing case state.

---

# PART VI — POTENTIAL EMPLOYMENT CLAIMS

## Screen 21 — "Possible legal claims"

Intentionally downstream — only relevant after enough facts exist.

Intro: **Based on the information recorded in your case, these are Employment Tribunal claims that could potentially be relevant.**

Not "You have these claims." Not "You will win these claims."

## Screen 22 — Claim card

### Example: Unfair dismissal

**Why this appeared** — the case records: employee relationship; dismissal; relevant date; procedural events.

**What generally needs to be considered** — element by element:

| Element | Current case information |
|---|---|
| Employment status | Supported by current information |
| Dismissal | Confirmed |
| Applicable service rule | Deterministic check |
| Employer's stated reason | Conduct |
| Procedure | Issues requiring analysis |
| Time limit | Deadline engine |

Also: **Supporting facts** (clickable) · **Evidence** (clickable documents) · **Information that could change this analysis** · **Employer's apparent position** (where supported) · **Relevant sources** (direct links).

**Current status** — never `78% likely to win`. Use: information substantially present; information incomplete; significant factual dispute; further information required.

## Claim analysis pipeline (when enabled)

1. **Trigger** — rules + Muse detect potentially relevant causes of action.
2. **Element analysis** — Muse `xhigh` gets relevant confirmed facts, contrary facts, applicable legal rules, sources.
3. **Critic** — a fresh Muse invocation: "Identify unsupported assertions, omitted contrary facts, wrong legal versions, missing elements and overstatement."
4. **Validator** — code checks: source IDs exist; fact IDs exist; deadline came from calculator; JSON schema valid; no unsupported claim type invented.
5. **User output** — only validated material reaches the Claim Card.

This retains Tribunal Harness's adversarial-review idea but gives it a more useful purpose.

## Muse / FCA launch gate

This capability exists in code behind `ENABLE_PERSONALISED_CLAIM_IDENTIFICATION`.

Meta's Model API AUP prohibits unauthorised/unlicensed professional practice and imposes qualified-review requirements where outputs are relied on for decisions affecting fundamental rights. Separately, the FCA Handbook expressly includes identifying employment-related claims and advising/investigating/representing potential employment claimants within regulated claims-management activities, subject to the statutory perimeter and exclusions.

Before enabling the personalised paid Claim screen:

1. obtain a fixed-scope FCA perimeter opinion based on the actual product;
2. give Meta the actual workflow and get written clarification/approval if required;
3. record that decision in the repository;
4. enable the flag only after that.

This is not the same as hiring an employment-law lead to review every case. The product as a whole should **not** depend on per-case professional review.

---

# PART VII — ET1

## Screen 23 — Tribunal decision workspace

Do not ask "Do you want to sue?". Show:

### Where your case is now

| | |
|---|---|
| Internal processes | ✓ |
| Acas EC | ✓ / ongoing |
| Possible claims | Available / incomplete |
| Deadline | Calculated |
| Information required for ET1 | 88% complete |

**Routes:** `Prepare an ET1` · `Get professional advice first` · `Explore other support` · `Continue trying to resolve the dispute`

## Screen 24 — ET1 Readiness

Sections: **You** (claimant details) · **Employer** (correct legal respondent details) · **Employment** (dates, role, pay) · **Acas** (certificate) · **Possible claims** (selected Claim Candidates) · **What happened** (structured narrative) · **Important dates** (chronology) · **What you're asking for** (remedy information) · **Missing information** (clear blockers).

## Screen 25 — ET1 narrative builder

Muse builds particulars from confirmed material. Every paragraph internally stores:

`fact_dependencies[]` · `event_dependencies[]` · `source_dependencies[]`

If any of those change, the ET1 draft becomes **Needs updating** rather than continuing to display stale prose.

## Screen 26 — ET1 Handoff

**coffeecup does not file the claim for you.**

Provide: official HMCTS/GOV.UK filing route; saved Acas details; downloadable case information; generated ET1 preparation material; external assistance directory.

Referral categories: regulated solicitor; union; legal-expenses insurance; Law Centre; LawWorks; FRU (at an appropriate stage); Valla / other clearly labelled commercial services; Citizens Advice.

Do not initially sell the user's case as a lead.

---

# PART VIII — PAYMENTS

## Screen 27 — Upgrade

Don't interrupt someone immediately. Let them experience intake, initial organisation, deadline warnings and their first timeline. Then:

### Keep working on this case

**£6.99 Case Pass** — persistent case; full timeline; documents; grievance workflow; disciplinary workflow; appeal; Acas workspace; drafting and exports.

**£9.99 Full Case / Claim Pack** (when legally/provider cleared) — everything above; possible-claims analysis; claim element maps; ET1 readiness; tribunal handoff export.

Never expose `tokens remaining`, `Muse credits` or `AI messages remaining`. Users are buying a service, not inference.

---

# PART IX — DATA AND BACKEND

## Core database

PostgreSQL. Primary entities:

```text
User                  Case                  CaseParticipant
EmploymentRelationship Event                Fact
Issue                 Document              DocumentExtraction
Process               ProcessStep           Deadline
Task                  LegalSource           LegalRule
ClaimCandidate        ClaimElement          EvidenceLink
GeneratedArtifact     ArtifactDependency    MuseRun
AuditEvent            Entitlement           Payment
```

## MuseRun

Every meaningful model invocation records: case ID; task type; model; model version; reasoning effort; prompt-template version; context object IDs; legal-source versions; output schema version; token use; timestamp; validation result; error state.

Do not record private chain-of-thought. Store structured inputs/outputs only to the extent justified by the retention/privacy design.

## Fact provenance

Every factual item knows:

```text
source_type
source_id
proposed_by
confirmed_by_user
created_at
updated_at
confidence
disputed
```

Status enum:

```text
USER_CONFIRMED
USER_ALLEGATION
EMPLOYER_ALLEGATION
DOCUMENT_EXTRACTED
DOCUMENT_CONFIRMED
MUSE_INFERENCE
UNKNOWN
```

A `MUSE_INFERENCE` must never silently become `USER_CONFIRMED`.

## Dependency invalidation

Example: user changes **Dismissal date: 16 September → 18 September**. Automatically invalidate/recalculate: deadline; chronology; continuous-service calculations; dismissal claim analysis; Acas calculation; ET1 narrative; relevant exported documents.

This feature will matter more than another fancy chatbot animation.

---

# PART X — MUSE COST CONTROL

At Standard pricing ($1.25/M input, $4.25/M output, $0.15/M cached input), Muse is economically plausible at the proposed case price.

| Scenario | Input | Output/reasoning | Total |
|---|---|---|---|
| Normal case | 150,000 uncached ≈ $0.19 | 25,000 ≈ $0.11 | ≈ **$0.29** |
| Heavy case | 500,000 ≈ $0.63 | 80,000 ≈ $0.34 | ≈ **$0.97** |

Before other infrastructure/search. These are **architecture targets, not production measurements** — reasoning use, document repetition and retries could increase them substantially. Instrument token cost **per Case**, not just per API request.

## Prompt caching

Create a stable prefix containing: core Muse instructions; provenance rules; output policy; common schemas; stable source instructions. Cached input is materially cheaper than ordinary input — avoid invalidating the prefix unnecessarily.

---

# PART XI — ADMIN / GOVERNANCE

A small internal admin interface.

## Legal source dashboard

Current sources; effective dates; upcoming changes; superseded rules; last checked date.

## Feature flags

```text
ENABLE_MUSE
ENABLE_GRIEVANCE_DRAFTING
ENABLE_DISCIPLINARY_DRAFTING
ENABLE_ACAS_PREPARATION
ENABLE_PERSONALISED_CLAIM_IDENTIFICATION
ENABLE_ET1_PERSONALISED_DRAFTING
ENABLE_CASELAW_ANALYSIS
ENABLE_WEB_SEARCH
ENABLE_REFERRALS
```

## Model settings

```text
model = muse-spark-1.3
standard_tier_only = true

extraction_effort       = minimal
summary_effort          = medium
drafting_effort         = medium
complex_analysis_effort = high
claim_analysis_effort   = xhigh
```

No code deploy should be required to turn a legally sensitive feature off.

---

# PART XII — PRODUCT SAFETY MODEL

1. **User-controlled facts** — the user verifies material case facts.
2. **Deterministic rules** — deadlines, commencement and other machine-determinable legal rules.
3. **Authoritative source registry** — Muse receives applicable law rather than relying solely on model memory.
4. **Muse structured reasoning** — interpretation, extraction, synthesis, drafting.
5. **Validation** — schema, fact IDs, legal-source IDs, stale-data checking and critique.

> **Muse reasons. The application verifies. The user controls their case.**

---

# PART XIII — BUILD ORDER

| Phase | Scope |
|---|---|
| **A — Foundation** | authentication; 18+ gate; PostgreSQL; Case model; access controls; storage; payments abstraction; audit system. *Do not start with claim analysis.* |
| **B — Case core** | workplace intake; Case Dashboard; people; employment details; facts; issues; timeline; user confirmation. Integrate Muse 1.3 extraction here. |
| **C — Documents** | secure upload; PDF/DOCX/image ingestion; Muse extraction; fact/event review queue; document-to-event linking. |
| **D — Workplace workflows** | grievance; grievance meeting; grievance outcome; appeal; disciplinary; hearing preparation; disciplinary outcome; appeal. *The product now has standalone value without tribunal claims.* |
| **E — Rules engine** | migrate/expand Tribunal Harness deadline logic; legal-source registry; effective dates; jurisdiction; commencement rules; Acas EC effect; deterministic calculation. *Must support the 1 October 2026 limitation transition immediately.* |
| **F — Acas** | EC preparation; Acas workspace; communication log; offer log; certificate; deadline recalculation. |
| **G — Payments** | Free → Case Pass. Test whether real users can complete workflows without founder intervention. |
| **H — Claim engine** | migrate Tribunal Harness claim schemas; replace claim-first intake with `Case → relevant facts → claim triggers → elements`; Muse critic/validator loop. Public output stays feature-flagged. |
| **I — ET1** | ET1 readiness; information completeness; narrative builder; stale dependency handling; export; handoff. Personalised legal functionality stays flagged until cleared. |
| **J — Production hardening** | rate limiting; abuse controls; Muse fallback/error handling; tenancy testing; security review; accessibility; backups; deletion/export; operational monitoring; model-cost telemetry; source-change monitoring. |

---

# PART XIV — ACCEPTANCE TEST

coffeecup v1 is successful when a user can:

1. arrive knowing no legal terminology;
2. describe their workplace problem;
3. have Muse organise the account;
4. correct Muse;
5. upload documents;
6. create a reliable chronology;
7. undertake a grievance or disciplinary process;
8. leave and return later;
9. retain everything already entered;
10. progress into Acas;
11. record their certificate;
12. receive a properly calculated deadline;
13. see gaps in their case information;
14. where enabled, see potential claims tied directly to facts and sources;
15. prepare ET1 information;
16. export the case;
17. continue themselves or take the organised case to external assistance.

The experience should feel like **"I finally have this problem under control."** — not **"I just had a conversation with an AI."**

---

# Product invariant

> **No important conclusion exists only inside Muse's prose.**

A material conclusion must resolve back to **confirmed facts + applicable rules/sources + structured Muse analysis + validation.**

That is what turns Muse Spark 1.3 from a chatbot into the reasoning engine for a credible employment-support product.
