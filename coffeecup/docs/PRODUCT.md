# Product

## Purpose

Help an ordinary UK worker (England, Wales, Scotland) move a real problem at
work forward: understand it, preserve the facts and documents, build an
accurate chronology, navigate the internal process they are in, prepare for
Acas Early Conciliation, and, only where it comes to it, prepare the
information an ET1 needs and find the right people to help.

A journey that ends after an informal conversation, a grievance, an appeal or
an Acas settlement is a success. Litigation is never assumed.

## Principle

The fundamental data object is the **Case**. Chat and model output are inputs
to, or derived from, structured case state. They are never the record.

## Entry

The primary call to action is "Get help with a problem at work". The intake
never asks for a legal cause of action. It establishes jurisdiction, situation,
employment relationship, key dates, procedural stage and urgency, offers the
entry routes (including "I'm not sure"), and suggests routes from a plain
description. Anonymous triage persists nothing; saving a case needs an account.

## What the worker can do

| Area | Capability |
|---|---|
| Home | "What should I pay attention to now": situation, important dates, where you are, next steps, recent activity, missing information, links |
| My case | Employment details, people, issues and desired outcomes, facts with provenance and correction |
| Timeline | Add/edit/delete/merge events; confirm or reject events proposed from documents; approximate and disputed flags; document and people links |
| Documents | Upload PDF/DOCX/TXT/EML/images (≤10 MB); extraction with explicit status; reclassify; re-run; download; delete |
| Workplace process | Grievance, disciplinary (allegation by allegation), informal, grievance/disciplinary appeals (grounds by category); state machines; Acas Code version by start date |
| Acas | Notification date, reference, conciliator, communications, offers, certificate; preparation note; time limits update automatically |
| Important dates | Every deadline with trigger date, assumptions, Acas effect, source and rule version; uncertainty stated when data is missing |
| Claims / Tribunal | Behind `ENABLE_PERSONALISED_CLAIM_IDENTIFICATION`: element-by-element status of possible claims from confirmed facts; no scores |
| Tasks | System-suggested and user tasks |
| Exports | Editable generated documents (letters, preparation, chronology, summary, Acas note, ET1 readiness pack); case pack export (Markdown/JSON) |
| Help | Guides with jurisdiction and review dates; resource directory by category, no referral fees |

## What it does not do

- Give legal advice, predict outcomes, or produce strength scores or percentages.
- Submit an ET1 or contact an employer, Acas or a tribunal.
- Present model output as fact: everything extracted or inferred is a proposal until confirmed.
- Invent a deadline when a date is missing.
- Send case data to third parties or sell leads.
- Assume a human legal reviewer: safety comes from deterministic rules, provenance, gating flags and independent review of the model's own output.

## Pricing model (experiment)

Free triage, urgent deadline warnings, limited timeline and official resources;
Case Pass (≈£6.99) for the persistent workspace; Claim Pack (≈£9.99) for the
claim analysis and ET1 pack once enabled. One-off per case, configurable,
never per message. Deadline information is never paywalled.

## The core invariant

Every material legal output is traceable to
`confirmed case facts + applicable legal rule/source + recorded reasoning result`.

## The final test

At every decision: does this help an ordinary worker move their real workplace
problem forward? If a feature mostly makes the product look like sophisticated
legal AI, simplify or remove it.
