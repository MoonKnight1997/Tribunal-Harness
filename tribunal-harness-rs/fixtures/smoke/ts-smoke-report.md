# Tribunal Harness — Smoke Run Report
_2026-09-23T22:17:26.501Z_

**Overall status: ✅ PASS**
Sections OK: 7/7 — Failures: 0 — Total duration: 306 ms

## Environment
- **node_version**: v22.22.2
- **platform**: linux x64
- **llm_provider**: agent
- **anthropic_api_key_present**: false
- **cwd**: /home/user/Tribunal-Harness/tribunal-harness
- **timestamp**: 2026-09-23T22:17:26.501Z

## ✅ Schema lookup — GET /api/schema/unfair_dismissal
- **status**: OK (HTTP 200)
- **duration**: 294 ms

**Checks**
- [x] HTTP 200  _(got 200)_
- [x] schema.label present  _(label=Unfair Dismissal)_
- [x] schema.statute present  _(statute=ERA 1996 s98)_

**Extract**
- **label**: Unfair Dismissal
- **statute**: ERA 1996 s98
- **description**: A claim that an employer dismissed an employee without a fair reason or without following a fair procedure.
- **field_count**: 9

## ✅ Triage — POST /api/triage
- **status**: OK (HTTP 200)
- **duration**: 192 ms

**Checks**
- [x] HTTP 200  _(got 200)_
- [x] updated_fields present
- [x] query_array is array
- [x] document_summary present
- [x] potential_claim_types is array  _(len=2)_
- [x] refinement applied  _(applied=true source=agent-stand-in reason=undefined)_

**Extract**
- **document_summary**: Synthetic narrative: a warehouse employee with approximately four years' service was dismissed on 3 March 2026 for 'gross misconduct' shortly after raising written health and safety concerns. The narr…
- **potential_claim_types**: [2 items]: ["unfair_dismissal","whistleblowing"]
- **query_array_len**: 2
- **updated_field_keys**: [3 items]: ["edt","employment_start_date","dismissal_reason"]
- **refinement_applied**: true
- **refinement_source**: agent-stand-in
- **refinement_changes**: 0

## ✅ Analyse — POST /api/analyse
- **status**: OK (HTTP 200)
- **duration**: 305 ms

**Checks**
- [x] HTTP 200  _(got 200)_
- [x] claims present  _(len=1)_
- [x] authorities present  _(len=3)_
- [x] statutory_provisions present
- [x] procedural_notes present
- [x] era_2025_flags present
- [x] authority has trust_level  _(trust_level=VERIFIED)_
- [x] refinement applied  _(applied=true source=agent-stand-in reason=undefined)_

**Extract**
- **claim_count**: 1
- **authority_count**: 3
- **first_authority**: ```
{
  "name": "British Home Stores Ltd v Burchell",
  "citation": "BHS v Burchell [1978] UKEAT 0108_78_2007",
  "trust_level": "VERIFIED",
  "verification_source": "verified_db"
}
```
- **statutory_provisions_count**: 2
- **era_2025_flag_count**: 2
- **quarantine_summary**: ```
{
  "total": 3,
  "verified": 3,
  "check": 0,
  "quarantined": 0,
  "verifiedPercentage": 100,
  "liveChecks": 0
}
```
- **refinement_applied**: true
- **refinement_source**: agent-stand-in
- **refinement_changes**: 0

## ✅ Deadlines — POST /api/deadlines
- **status**: OK (HTTP 200)
- **duration**: 304 ms

**Checks**
- [x] HTTP 200  _(got 200)_
- [x] at least one deadline returned  _(count=1)_
- [x] deadline has deadline_date / original_deadline  _(original_deadline=2026-06-02)_
- [x] regime is 'pre' or 'post'  _(raw=pre_era_2025 normalised=pre)_
- [x] claim_type present  _(claim_type=unfair_dismissal)_

**Extract**
- **time_limit_regime**: pre_era_2025
- **deadline_count**: 1
- **first_deadline**: ```
{
  "claim_type": "unfair_dismissal",
  "deadline_date": "2026-06-02",
  "regime": "pre",
  "raw_regime": "pre_era_2025",
  "days_remaining": -113,
  "is_expired": true
}
```
- **warnings_count**: 1

## ✅ Case Law search — GET /api/case-law/search
- **status**: OK (HTTP 200)
- **duration**: 292 ms

**Checks**
- [x] HTTP 200  _(got 200)_
- [x] results is array
- [x] search returns at least one result (q=burchell, fallback q=polkey)  _(len=10)_

**Extract**
- **query**: burchell
- **total**: 10
- **data_source**: seed_v1
- **fallback_query_used**: false
- **first_result_name**: Various Claimants v Wm Morrison Supermarkets plc

## ✅ ERA 2025 tracker — GET /api/era-2025/tracker
- **status**: OK (HTTP 200)
- **duration**: 292 ms

**Checks**
- [x] HTTP 200  _(got 200)_
- [x] tracker/changes array present  _(len=21)_
- [x] at least one provision  _(len=21)_

**Extract**
- **tracker_count**: 21
- **sample_provision**: Trade union ballot mandate & notice periods
- **statuses_seen**: [3 items]: ["in_force","upcoming","awaiting_si"]

## ✅ Debate — POST /api/debate
- **status**: OK (HTTP 200)
- **duration**: 304 ms

**Checks**
- [x] HTTP 200  _(got 200)_
- [x] drafter present
- [x] critic present
- [x] judge present
- [x] viable is boolean  _(viable=true)_
- [x] refinement applied  _(applied=true source=agent-stand-in reason=undefined)_

**Extract**
- **viable**: true
- **judge_score**: 79
- **judge_synthesis**: The unfair dismissal claim is viable. The strongest ground is procedural unfairness (no investigation, contrary to Burchell), with the principal contest being the true reason for dismissal and the siz…
- **drafter_keys**: [5 items]: ["factual_summary","legal_framework","application","remedies","overall_assessment"]
- **critic_keys**: [4 items]: ["attacks","factual_gaps","procedural_risks","overall_vulnerability_assessment"]
- **judge_keys**: [7 items]: ["score","score_breakdown","synthesis","key_vulnerabilities","evidentiary_requirements","procedural_recommendations","viable"]
- **refinement_applied**: true
- **refinement_source**: agent-stand-in
- **refinement_changes**: 0

## Summary
- **ok**: 7
- **fail**: 0
- **total**: 7
- **duration_ms**: 306
- **overall_status**: PASS

---
_This is an automated smoke run. The agent stand-in (LLM_PROVIDER=agent) was used for LLM-backed routes; no Anthropic API calls were made._