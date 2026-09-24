# coffeecup

A low-cost digital case companion for UK workers dealing with a problem at work —
from organising the facts, through grievance/disciplinary and Acas, to (possibly) ET1
preparation. The core object is a **case**, not a chat and not a tribunal claim.

**Status: planning only — no code yet.** The running app in this repo is still
Tribunal Harness (`../tribunal-harness/`).

| Doc | What it covers |
|---|---|
| [`PRODUCT-PLAN.md`](./PRODUCT-PLAN.md) | Product thesis, all 27 screens, Muse Spark 1.3 runtime design, data model, cost model, feature flags, safety model, build phases A–J, acceptance test |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Target Rust backend (Axum/SQLx/Tokio), typed domain, schema-derived Muse output, pure deadline engine, workflow transitions, source layout |
| [`RECONCILIATION.md`](./RECONCILIATION.md) | What carries over from Tribunal Harness, conflicts with current decisions, founder decisions required, suggested first slice |

**Product invariant:** no important conclusion exists only inside Muse's prose. Every
material conclusion resolves to confirmed facts + applicable rules/sources + structured
analysis + validation.
