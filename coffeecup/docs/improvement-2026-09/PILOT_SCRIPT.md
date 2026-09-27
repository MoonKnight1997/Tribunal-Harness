# Pilot script — one complete journey, synthetic data only

Purpose: a deliberately limited, observed session with representative workers
and advisers, run by a human facilitator. This script is the runnable plan; it
is not evidence that a pilot has happened. Nothing here uses real case material.

## Set-up (facilitator, before the session)

1. Deployment with `PAYMENTS_ENABLED=0`, every `ENABLE_*` flag unset (off),
   `LLM_PROVIDER=mock` or a configured provider with a signed DPA, `JOBS_INLINE=1`
   for a single instance (or a worker running).
2. Synthetic participant account: `pilot-<n>@example.invalid`.
3. Synthetic documents in `coffeecup/src/documents/extract/fixtures/` (emails) and
   the sample invitation text below saved as `invite.txt`:

   > Dear Sam, You are invited to attend a disciplinary hearing on 3 March 2026.
   > The allegation: that you were absent without authorisation on 14 January 2026.
   > It is alleged that you failed to follow the absence procedure.

4. Screen recording only with consent; no personal data typed into the product.

## Persona (fictional)

Sam, a warehouse operative in England, employed since 9 May 2022, still
employed, invited to a disciplinary hearing about an absence. Sam does not know
any legal terms and uses a phone.

## Tasks (say them to the participant; do not help unless stuck > 2 minutes)

| # | Task | What we watch for | Success signal |
|---|---|---|---|
| T1 | "Describe what is happening at work and find out if there is anything urgent." | Can they complete the short intake without choosing a legal category? Do they understand the urgency message? Is the time-limit information shown *before* any model summary? | Case saved; urgency line read aloud correctly; "I don't know" used for at least one date without error |
| T2 | "Add the hearing invitation letter (`invite.txt`) and check what the tool found." | Evidence inbox: original excerpt beside each proposal; confirm/correct/reject; remaining count; keyboard (j/k/c/r/e) if they use a keyboard | At least one event confirmed, one corrected, one rejected; the allegation is recognised as the employer's claim, not a fact |
| T3 | "Record the hearing date and prepare for it." | Dashboard: is the primary next action obvious? Are reasons shown? Can they dismiss an irrelevant suggestion? | Hearing preparation document generated from confirmed material; review flags (if any) understood |
| T4 | "Make a mistake on purpose: change the hearing date, then check the dates page." | Stale handling: do old deadlines/tasks disappear or update? Is the change visible? | Dates and tasks reflect the new date; nothing stale silently remains |
| T5 | "Export what you have to take to an adviser." | DOCX opens in Word/LibreOffice; PDF prints; handover pack has chronology, document index, disputed matters, questions | Participant can open and read both files |
| T6 | "Delete the letter you uploaded." | Confirmed events stay; the file is gone; the export archive no longer contains it | Correct explanation in the UI |

## Recovery probes (facilitator triggers)

- Submit the intake with an invalid date → entered text must survive.
- Reload during upload processing → status keeps updating; "Try again" available if it failed.
- Keyboard only for T2; zoom 200 % and 375 px width for T1 and T3.

## Measures (record per participant)

- Time to a saved case with one confirmed next step (target: under 10 minutes).
- Number of facilitator interventions.
- Misunderstandings of urgency wording (verbatim).
- Any place a model-proposed item was accepted without reading the excerpt.
- Any legal wording the participant found alarming or unclear.

## Debrief questions

1. What do you think happens next?
2. Which date matters most, and why do you think that?
3. Was anything presented as certain that you did not feel was certain?
4. What would you take to an adviser from the export?

## What this pilot does not establish

Legal correctness of any output, regulatory approval, or accessibility
compliance. Those are separate reviews. The pilot tests whether a worker can
complete and recover from the journey.
