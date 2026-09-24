# coffeecup (repository: Tribunal-Harness)

[![CI](https://github.com/MoonKnight1997/Tribunal-Harness/actions/workflows/ci.yml/badge.svg)](https://github.com/MoonKnight1997/Tribunal-Harness/actions/workflows/ci.yml)

This repository now contains **coffeecup**, a UK workplace-problem
case-management and decision-support application for workers in England,
Wales and Scotland. It is the rebuild of the earlier Tribunal Harness
prototype, whose reusable legal core (deadline calculation, Employment Rights
Act 2025 commencement logic, claim definitions, citation validation, document
extraction) was retained and whose product architecture was inverted: the
fundamental object is a **Case**, the journey starts from a problem at work,
and tribunal claim preparation is a late, feature-flagged stage.

The application lives in [`coffeecup/`](coffeecup/). Start with
[`coffeecup/README.md`](coffeecup/README.md) and the documents in
[`coffeecup/docs/`](coffeecup/docs/):

- PRODUCT · ARCHITECTURE · DATA_MODEL
- LEGAL_SOURCE_GOVERNANCE · AI_PROVIDER_ARCHITECTURE · PRIVACY_SECURITY
- REGULATORY_FEATURE_FLAGS · TESTING · DEPLOYMENT
- MIGRATION_FROM_TRIBUNAL_HARNESS

```bash
cd coffeecup
npm install
cp .env.example .env.local
npm run dev
```

The public product name is not decided; "coffeecup" is an internal codename
configured centrally in `coffeecup/src/brand/config.ts`.

This software provides legal information and organisational tools, not legal
advice. Licence: MIT (see `LICENSE`).
