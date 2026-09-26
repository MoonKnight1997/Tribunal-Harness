# Regulatory feature flags

All flags are read server-side from the environment (`src/flags/index.ts`) and
enforced in services and route handlers with `requireFlag`. A disabled feature
has no reachable endpoint; the UI merely reflects the same state. Defaults are
off. Unrecognised values fail closed.

| Flag | Gates | Default |
|---|---|---|
| `ENABLE_PERSONALISED_CLAIM_IDENTIFICATION` | `POST/GET /api/cases/:id/claims`, `identifyClaims`, claim categories in the ET1 pack, Claims page content | off |
| `ENABLE_PERSONALISED_ET1_DRAFTING` | Model-drafted ET1 wording (the structured readiness pack is assembled deterministically and is not gated by this flag) | off |
| `ENABLE_CASELAW_LLM_ANALYSIS` | Any model processing of Find Case Law judgment text; bulk/multi-judgment analysis | off |
| `ENABLE_EXTERNAL_CASE_REFERRAL` | Any future flow that sends case information to a third party | off |
| `ENABLE_PAID_CLAIM_FEATURES` | Marketing/offering of paid claim features (pricing page copy); actual gating of paid features is by entitlement | off |

Related but not regulatory: `PAYMENTS_ENABLED` (entitlement checks on/off).

## Behaviour when off

- Claim identification: the Claims page explains the feature is not enabled and
  routes to free advice; the API returns 404; the ET1 pack lists "not enabled"
  under claim categories.
- Case-law analysis: only single-citation verification remains available.
- External referral: the resource directory lists organisations; nothing is sent.

## Tests

`src/claims/service.test.ts` asserts the service-layer refusal when the flag is
off and the behaviour when on. `src/test/setup.ts` strips all flags before every
test so each test sets what it needs.
