# Improvement ledger — coffeecup remediation (September 2026)

Maps every finding in `coffeecup/docs/improvement-2026-09/review-report.md`
(F01–F14), the four section-6 product areas and the section-7 testing/
architecture work to what was changed and the evidence for it.

Status vocabulary: **implemented-and-verified** (code + passing test or
recorded check), **implemented-but-unverified** (code without a check that
proves it), **already-resolved-with-evidence**, **blocked-with-specific-dependency**.

Baseline: commit `ea6d5bf` (381 files fingerprinted in
`baseline-fingerprints.txt`, see integrity section); 18 test files, 239 tests
passing, 2 skipped; typecheck and lint clean; `npm audit --omit=dev` 2
advisories.

_This file is rewritten at the end of the work with final status and evidence.
Intermediate state is tracked in the working notes._

| Item | Status | Change | Evidence |
|---|---|---|---|
| F01 claim elements cross-user read | in progress | | |
| F02 artifact patch changes ownership | in progress | | |
| F03 document attached to foreign process | in progress | | |
| F04 missing trigger substituted; approximation lost | in progress | | |
| F05 pending Acas labelled expired; Day B issue date | in progress | | |
| F06 stale deadlines after corrections / time | in progress | | |
| F07 generic generation bypasses flags | in progress | | |
| F08 legal-source governance | in progress | | |
| F09 drafting provenance / extra override / sanitiser | in progress | | |
| F10 email body lost | in progress | | |
| F11 extraction coverage / diagnostics / quotes / OCR | in progress | | |
| F12 stuck jobs / retry / reprocess context | in progress | | |
| F13 webhook replay & ordering | in progress | | |
| F14 production controls | in progress | | |
| §6 intake | pending tranche 2 | | |
| §6 evidence review | pending tranche 2 | | |
| §6 dashboard | pending tranche 2 | | |
| §6 exports | pending tranche 2 | | |
| §7 HTTP integration tests | in progress | | |
| §7 browser journeys | pending tranche 2 | | |
| §7 legal regression corpus | in progress | | |
| §7 concurrency & failure | in progress | | |
| §7 model-output evaluation | in progress | | |
| §7 deployment checks (real Postgres, restore, config, advisories) | in progress | | |
| §7 one active implementation / repo coherence | implemented (commit 51eba6d) | banners on Rust README/PARITY and historical plans; `docs/DECISIONS.md`, `docs/LAUNCH_SCOPE.md` | files present |
