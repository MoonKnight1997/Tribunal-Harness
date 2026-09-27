# Regulatory feature flags

All flags are read server-side from the environment (`src/flags/index.ts`) and
enforced in services and route handlers with `requireFlag`. A disabled feature
has no reachable endpoint; the UI merely reflects the same state. Defaults are
off. Unrecognised values fail closed.

| Flag | Gates | Default |
|---|---|---|
| `ENABLE_PERSONALISED_CLAIM_IDENTIFICATION` | `POST/GET /api/cases/:id/claims`, `identifyClaims`, claim categories in the ET1 pack, Claims page content, the model-drafted `potential_claims_summary` artifact | off |
| `ENABLE_PERSONALISED_ET1_DRAFTING` | Model-drafted ET1 wording (`generateArtifact(…, "et1_readiness_pack")`). The structured readiness pack (`buildEt1ReadinessPack` / `saveEt1PackArtifact`) is assembled deterministically and is **not** gated by this flag | off |
| `ENABLE_CASELAW_LLM_ANALYSIS` | Any model processing of Find Case Law judgment text; bulk/multi-judgment analysis | off |
| `ENABLE_EXTERNAL_CASE_REFERRAL` | Any future flow that sends case information to a third party | off |
| `ENABLE_PAID_CLAIM_FEATURES` | Offering the Claim Pack for sale: `startCheckout(…, "claim_pack")` throws `FeatureDisabledError` when off; the Claim Pack is omitted from `offeredPricing()`, the pricing page, the upgrade page and `GET /api/capabilities` | off |

Related but not regulatory: `PAYMENTS_ENABLED` (entitlement checks on/off).

## Artifact policy table

`src/artifacts/policy.ts` is the single source of truth for what each
generated document needs. `assertArtifactAllowed(actor, caseId, type)` runs
first thing in `generateArtifact` — before usage counting, before any model
call, before any write — and applies, in order: type validity → whether the
generic drafting path may produce the type → flags (`requireFlag`, 404
`feature_disabled`) → entitlement (402 `entitlement_required`).
`tierForArtifact` in `src/entitlements/service.ts` reads the same table.

| Artifact type | Tier | Flags required | Model-drafted | Via `generateArtifact` |
|---|---|---|---|---|
| `grievance_letter`, `grievance_appeal`, `disciplinary_response`, `disciplinary_appeal`, `case_summary`, `acas_preparation`, `meeting_preparation` | `case_pass` | none | yes | yes |
| `chronology` | `case_pass` | none | no (deterministic render) | yes |
| `potential_claims_summary` | `claim_pack` | `ENABLE_PERSONALISED_CLAIM_IDENTIFICATION` | yes | yes |
| `et1_readiness_pack` | `claim_pack` | `ENABLE_PERSONALISED_ET1_DRAFTING` | yes | yes — the deterministic pack in `src/et1/service.ts` is a separate, ungated path |
| `case_pack` | `claim_pack` | none | never | **no** — `ValidationError` pointing to `GET /api/cases/:id/export` |

Caller-supplied input to a drafting request is validated against the strict
`SupplementaryInput` allow-list (preparation notes and short instructions
only) and is passed to the model under `supplementary`, never merged into the
authoritative record. Every model draft is stored with a `generation`
snapshot (task id, prompt version, provider, model, sha256 of the exact
payload, supplementary keys, rule and source versions) and with
`reviewFlags` from the deterministic checks in `src/artifacts/checks.ts`
(unsupported dates, names, quotations, citations, percentages, strength
language). The checks flag wording for a human to review; they never certify
a draft.

## Checkout rule

`startCheckout` refuses `claim_pack` unless `ENABLE_PAID_CLAIM_FEATURES` is on.
`offeredPricing()` in `src/payments/pricing.ts` lists the Claim Pack only when
that flag is on and, within each tier, lists only features whose flags are on
(for example "Possible-claim analysis" only when claim identification is on);
switched-off features are shown as "not yet available" rather than promised.

## Behaviour when off

- Claim identification: the Claims page explains the feature is not enabled and
  routes to free advice; the API returns 404; the ET1 pack lists "not enabled"
  under claim categories; `generateArtifact(…, "potential_claims_summary")`
  throws `FeatureDisabledError` with no usage counted and no model call.
- ET1 drafting: `generateArtifact(…, "et1_readiness_pack")` throws
  `FeatureDisabledError`; the deterministic readiness pack still works.
- Case-law analysis: only single-citation verification remains available.
- External referral: the resource directory lists organisations; nothing is sent.
- Paid claim features: the Claim Pack cannot be bought and is not advertised.

## Tests

`src/claims/service.test.ts` asserts the service-layer refusal when the flag is
off and the behaviour when on. `src/artifacts/service.test.ts` covers the
artifact policy (flags off/on, `case_pack` refusal, entitlement) and the
checkout rule. `src/test/setup.ts` strips all flags before every test so each
test sets what it needs.
