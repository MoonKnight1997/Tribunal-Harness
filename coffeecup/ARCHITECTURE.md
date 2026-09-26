# coffeecup — Target Backend Architecture (Rust)

> **Status:** Target design, not built. The live app today is the Next.js/TypeScript
> Tribunal Harness in `../tribunal-harness/`. Moving to Rust is an open founder
> decision — see [`RECONCILIATION.md`](./RECONCILIATION.md) § Decisions.

## System shape

```
Browser UI
    ↓
Rust API / application server
    ↓
Case domain services
    ├── Case state
    ├── Timeline / facts
    ├── Documents
    ├── Grievance / disciplinary workflows
    ├── Acas workflow
    ├── Deadline engine
    ├── Claim engine
    ├── ET1 builder
    └── Entitlements / payments
    ↓
Case Context Compiler
    ↓
Muse Spark 1.3
    ↓
Structured JSON
    ↓
Rust validation + legal-rule validation
    ↓
PostgreSQL
```

## Crates

| Concern | Crate |
|---|---|
| HTTP/API server | `axum` |
| Async runtime | `tokio` |
| Muse structured inputs/outputs | `serde` / `serde_json` |
| Persistent case state, compile-time query checking | `sqlx` + PostgreSQL |
| Muse API, Stripe, official-source fetching | `reqwest` |
| Middleware, auth layers, tracing, rate limits | `tower` / `tower-http` |
| Observability | `tracing` + `tracing-subscriber` |
| Entity IDs | `uuid` |
| Temporal data | `time` (or `chrono`) |
| Money / pay / remedy calculations — never floats | `rust_decimal` |
| Typed domain errors / application plumbing | `thiserror` / `anyhow` |
| JSON Schema from Rust structs, for Muse | `schemars` |
| Optional second validation pass | `jsonschema` |
| OpenAPI for typed frontend clients | `utoipa` |
| Documents | S3-compatible object storage abstraction |

## One type, end to end, for Muse output

Instead of hand-maintaining a JSON schema alongside separate Rust types, derive the
schema from the type, give that exact schema to Muse, and deserialize the answer back
into the same type:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProposedEvent {
    pub date: Option<Date>,
    pub date_precision: DatePrecision,
    pub description: String,
    pub participant_ids: Vec<Uuid>,
    pub source_refs: Vec<SourceRef>,
    pub proposition_type: PropositionType,
    pub confidence: Confidence,
    pub needs_user_confirmation: bool,
}
```

```
Rust type → JSON Schema → Muse constrained output → serde_json → Rust type → domain validation
```

## Strongly typed legal domain

No provenance or stage as arbitrary strings:

```rust
enum FactStatus {
    UserConfirmed,
    UserAllegation,
    EmployerAllegation,
    DocumentExtracted,
    DocumentConfirmed,
    MuseInference,
    Disputed,
    Unknown,
}

enum Jurisdiction {
    EnglandWales,
    Scotland,
    NorthernIreland,
}

enum CaseStage {
    WorkplaceProblem,
    InformalResolution,
    Grievance,
    GrievanceAppeal,
    Disciplinary,
    DisciplinaryAppeal,
    AcasEarlyConciliation,
    TribunalAssessment,
    Et1Preparation,
    Closed,
}
```

### Proposed vs confirmed facts are different types

```rust
struct ProposedFact { /* ... */ }
struct ConfirmedFact { /* ... */ }
```

— rather than `Fact { confirmed: bool }`. Muse returns `ProposedFact`. **Only application
logic following user confirmation can construct a `ConfirmedFact`** (private constructor,
built only inside the confirmation command handler). The type system enforces the
`MUSE_INFERENCE` ≠ `USER_CONFIRMED` invariant.

## Deadline engine — pure Rust

```rust
pub fn calculate_deadline(
    case: &EmploymentCase,
    claim: ClaimType,
    rules: &RuleSet,
) -> Result<DeadlineCalculation, DeadlineError>;

pub struct DeadlineCalculation {
    pub trigger_date: Date,
    pub base_deadline: Date,
    pub acas_adjustment: Option<AcasAdjustment>,
    pub final_deadline: Date,
    pub applicable_rule_id: RuleId,
    pub assumptions: Vec<Assumption>,
    pub warnings: Vec<DeadlineWarning>,
}
```

Muse receives the result, never responsibility for the calculation. Deterministic
regression tests cover every commencement/date boundary. The existing TypeScript
calculator's test suite is the golden master for the port (see RECONCILIATION.md).

## Workflow engine — Rust-native transitions

Muse does not decide "the user is now at grievance appeal stage". Proper transitions:

```
GrievanceDraft
    ↓ submit
GrievanceSubmitted
    ↓ record_meeting
GrievanceMeetingCompleted
    ↓ record_outcome
GrievanceOutcomeReceived
    ↓ start_appeal
GrievanceAppealPreparing
```

Muse may return `SuggestedAction::RecordGrievanceOutcome`; it can never do
`case.stage = CaseStage::GrievanceAppeal`. The domain service decides whether a
transition is valid.

## Source layout

```
src/
├── ai/
│   ├── mod.rs
│   ├── muse.rs
│   ├── context.rs          # Case Context Compiler
│   ├── schemas/
│   ├── prompts/
│   └── validation.rs
├── domain/
│   ├── case/
│   ├── facts/
│   ├── timeline/
│   ├── documents/
│   ├── grievance/
│   ├── disciplinary/
│   ├── acas/
│   ├── claims/
│   ├── deadlines/
│   └── et1/
├── legal/
│   ├── sources/
│   ├── rules/
│   ├── commencement/
│   └── citations/
├── application/
│   ├── commands/
│   ├── queries/
│   └── services/
├── infrastructure/
│   ├── postgres/
│   ├── storage/
│   ├── payments/
│   ├── auth/
│   └── external/
├── api/
│   ├── routes/
│   ├── middleware/
│   └── dto/
└── main.rs
```

**Rule:** `domain/` stays free of HTTP concerns, SQL, Muse API types, Stripe and
frontend DTOs, so the legal core is testable without the internet or an LLM.
