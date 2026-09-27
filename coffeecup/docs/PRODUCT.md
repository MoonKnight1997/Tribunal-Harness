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
| Review | The evidence inbox (below): every proposed event, fact and employer allegation read from documents, with the source passage beside it, until the worker decides |
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

## The evidence inbox

Everything a document or the model proposes — timeline events, structured and
narrative facts, and the employer's allegations from disciplinary material —
waits in one queue at **Review** (`/app/cases/:id/review`, `GET /review`).
The nav shows a count of items left at every stage.

- **The passage is beside the proposal.** The server computes a short excerpt
  of the document's extracted text around the recorded source location (or,
  failing that, around the quoted or proposed wording) and the page highlights
  it. The worker never has to download the file and search for a sentence.
- **Three voices are kept apart.** Each item carries a plain label: *The
  document says*, *The employer alleges*, *The model inferred*, *You said*.
  Recording an allegation notes what the employer says; it never becomes a
  confirmed fact and the page says so.
- **Trust signals, not scores.** Provenance and whether the quoted passage was
  actually found in the document are shown. Numeric model confidence is never
  sent to the client: it is not a calibrated reliability measure.
- **Conflicts are explicit.** A structured fact whose value differs from the
  confirmed one offers *Keep the confirmed date* or *Use this date instead*
  (which supersedes the old value). A proposed event on the same date as a
  similar confirmed event offers *Merge with the event on the timeline*. A
  quote the pipeline could not verify is flagged.
- **Correction keeps the original.** Editing a proposal confirms the corrected
  version; the source quote, location and the superseded row are kept.
- **Keyboard and touch.** `j`/`k` or arrows move, `c` confirms, `e` edits,
  `r` rejects, `?` lists shortcuts; every action is also a button. A polite
  live region announces the remaining count after each decision.

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
