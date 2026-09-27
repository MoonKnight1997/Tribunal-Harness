# Launch scope (single current statement)

Last updated 27 September 2026. Supersedes the launch statements in the
historical planning documents.

## What a first pilot covers

One complete journey, done well, for workers in England, Wales and Scotland:

1. describe a problem at work (short, stepwise intake; urgent deadline
   information without waiting for, or using, a model);
2. save evidence (upload; original preserved; extraction proposals with
   source excerpts and locations; nothing confirmed without the user);
3. verify a chronology (evidence inbox: confirm, correct, reject; conflicts
   visible);
4. prepare a useful internal-process document (grievance letter, hearing
   preparation, appeal) from confirmed material, with review flags;
5. export the record (Markdown/JSON always; DOCX/PDF/adviser handover pack;
   archive of originals with manifest).

## Explicitly out of scope until their gates are met

| Capability | Gate |
|---|---|
| Personalised claim identification (`ENABLE_PERSONALISED_CLAIM_IDENTIFICATION`) | Regulatory review of the Legal Services Act boundary; source-to-rule register approved |
| Model-drafted ET1 wording (`ENABLE_PERSONALISED_ET1_DRAFTING`) | As above; the deterministic ET1 readiness pack is in scope |
| Case-law text analysis (`ENABLE_CASELAW_LLM_ANALYSIS`) | Licensing confirmation for Find Case Law judgment text |
| Paid claim features / Claim Pack sale (`ENABLE_PAID_CLAIM_FEATURES`, `PAYMENTS_ENABLED`) | Payment provider go-live decision; webhook reconciliation verified against the provider's test mode |
| Northern Ireland | Separate tribunal system not modelled |

## Dates

- The reviewed six-month time-limit commencement and the Scottish contract-claim
  date are recorded in `docs/improvement-2026-09/SOURCE_VERIFICATION_REGISTER.md`
  with their verification status. The engine leads with the shorter limit
  wherever an instrument is not verified.
- No public launch date is set in this file. The historical "not before
  February 2027" statement in `../PRODUCT-PLAN.md` is not a current commitment
  either way; the pilot gate is the evidence in `IMPROVEMENT_LEDGER.md`
  (repository root), not a calendar date.
