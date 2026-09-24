/**
 * Public informational content. Separate from case data. Each article
 * carries a jurisdiction label, a last-reviewed date, an effective date
 * where the law is changing, and its authoritative sources from the registry.
 * These are a small number of substantive pages, not generated SEO filler.
 */

import { ERA_2025, TIME_LIMIT_CONFIG, formatCommencementLabel, isCommencementTbc } from "@/legal/era-2025";

export interface Article {
    slug: string;
    title: string;
    summary: string;
    jurisdiction: string;
    lastReviewed: string;
    effectiveNote?: string;
    sourceKeys: string[];
    /** Markdown body. */
    body: string;
    relatedRoutes: string[];
}

const REVIEWED = "2026-09-24";
const SIX_MONTHS = formatCommencementLabel(TIME_LIMIT_CONFIG.COMMENCEMENT_DATE, isCommencementTbc("ET_TIME_LIMIT_6_MONTHS"));

export const ARTICLES: Article[] = [
    {
        slug: "grievance",
        title: "Raising a grievance",
        summary: "What a grievance is, when to raise one, and how to write it so it gets taken seriously.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["acas_code_2015"],
        relatedRoutes: ["grievance", "problem_at_work"],
        body: `## What a grievance is
A grievance is a formal complaint to your employer about something at work: how you have been treated, your pay, your hours, a change to your job, or a colleague's behaviour. Most employers have a written grievance procedure; ask HR or check the staff handbook.

## Before you raise one
- Try to resolve it informally first if it is safe and sensible to do so. Note when you spoke to whom and what was said.
- Gather the facts: dates, what happened, who was there, and any messages or letters.
- Decide what you want to happen. Be specific.

## Writing the grievance
- Put it in writing and keep a copy.
- Set out each issue separately, in date order, sticking to facts you can support.
- Say what outcome you are asking for.
- Ask for a meeting. You have the right to be accompanied by a colleague or a trade union representative.

## What should happen next
Under the Acas Code of Practice your employer should hold a meeting without unreasonable delay, decide, tell you the outcome in writing, and offer an appeal. If the Code is not followed and you later bring a tribunal claim, compensation can be adjusted by up to 25%.

## Time limits still run
Raising a grievance does not pause the time limit for a tribunal claim. If you may need to claim, keep an eye on the date and consider contacting Acas Early Conciliation, which does pause it.`,
    },
    {
        slug: "disciplinary",
        title: "Facing a disciplinary or investigation",
        summary: "Your rights during an investigation and hearing, and how to prepare your response to each allegation.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["acas_code_2015", "era1996_s94_98"],
        relatedRoutes: ["disciplinary"],
        body: `## The stages
Most disciplinary processes follow this shape: investigation, a letter setting out the allegations and evidence, an invitation to a hearing, the hearing, an outcome letter, and a right of appeal.

## Your rights
- To know what is alleged, in enough detail to respond, and to see the evidence before the hearing.
- To be accompanied at the hearing by a colleague or union representative.
- To put your case, call witnesses where relevant, and appeal the decision.

## Preparing
Deal with each allegation separately. For each one write down: what the employer says, what evidence they rely on, your response, the evidence that supports you, and anything you still need to see. Prepare questions to ask at the hearing.

## Suspension
Suspension should be brief, on full pay, and is not itself a punishment. Ask for the reason in writing.

## If you are dismissed
You can appeal internally. If you have enough service (currently two years; ${formatCommencementLabel(ERA_2025.QUALIFYING_PERIOD_6_MONTHS, false)} onwards six months) you may be able to claim unfair dismissal. Time limits run from the date your employment ends.`,
    },
    {
        slug: "appeals",
        title: "Appealing a decision at work",
        summary: "How to appeal a grievance or disciplinary outcome, and the kinds of grounds that make sense.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["acas_code_2015"],
        relatedRoutes: ["appeal"],
        body: `## Check the deadline
Appeal deadlines are set by your employer's policy, often five or ten working days from the outcome letter. Check the letter. If you need more time, ask in writing.

## Kinds of grounds
Appeals usually rest on one or more of these:
- the findings of fact were wrong;
- relevant evidence was missing or was not considered;
- evidence was misunderstood;
- the process was unfair (for example, you were not shown the evidence);
- inconsistent treatment compared with others;
- new evidence that was not available before;
- the outcome or sanction was too severe.

None of these automatically wins an appeal; they are ways of organising what went wrong.

## Writing the appeal
State that you are appealing, list each ground with the facts that support it, and say what outcome you want. Keep it factual and calm.`,
    },
    {
        slug: "acas-early-conciliation",
        title: "Acas Early Conciliation",
        summary: "What Acas Early Conciliation is, what it does to time limits, and how to prepare.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["acas_early_conciliation_guidance", "era1996_s207b"],
        relatedRoutes: ["acas_early_conciliation", "acas_certificate_received", "considering_tribunal"],
        body: `## What it is
Before most tribunal claims you must tell Acas. A conciliator will offer to talk to you and your employer to see if the dispute can be settled. It is free and voluntary for both sides.

## Day A and Day B
The day Acas receives your notification is "Day A". The day the certificate is issued is "Day B". The time between them does not count towards the tribunal time limit, and if the limit would end within a month of Day B, you get until one month after Day B. Conciliation started after the time limit has already passed does not revive it.

## Preparing
Have ready: who the employer is, a short chronology, the main issues, what has been tried, any money in dispute, and what you want. You do not have to name legal claims.

## The certificate
Keep the certificate. Its number goes on the ET1 claim form.`,
    },
    {
        slug: "tribunal-time-limits",
        title: "Tribunal time limits",
        summary: "How the time limit for an Employment Tribunal claim is worked out, and what changes under the Employment Rights Act 2025.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        effectiveNote: `Six-month limit expected from ${SIX_MONTHS}.`,
        sourceKeys: ["era1996_s111", "ea2010_s123", "era1996_s207b", "era2025_time_limits", "swainston_hetton"],
        relatedRoutes: ["considering_tribunal", "dismissal", "discrimination"],
        body: `## The usual rule
For most claims you must present the claim within three months less one day of the event: the date your employment ended, the last act of discrimination, or the payday of a deduction. For example, a dismissal on 15 January means 14 April.

## The Employment Rights Act 2025
The Act extends the limit to six months for events on or after commencement, expected from ${SIX_MONTHS}. Until the exact date is confirmed by Statutory Instrument, work to the shorter limit.

## Acas pauses the clock
Notifying Acas pauses the limit between Day A and Day B, with a minimum of one month after Day B.

## Weekends and bank holidays
If the last day falls on a weekend or bank holiday, the limit is not extended. File before it.

## Late claims
Tribunals can accept a late discrimination claim if it is just and equitable, and a late unfair-dismissal claim only if it was not reasonably practicable to claim in time. Both are discretionary. Do not rely on them.`,
    },
    {
        slug: "et1-claim-form",
        title: "Completing the ET1 claim form",
        summary: "What the ET1 asks for, what to have ready, and where to file it.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["govuk_et1", "et_rules_2024"],
        relatedRoutes: ["et1_preparation"],
        body: `## What you need
- Your details and the employer's legal name and address.
- Your Acas Early Conciliation certificate number.
- Employment dates, job title, pay and hours.
- The type(s) of claim you are making.
- A clear account of what happened, in date order.
- What you want the tribunal to do.

## Where to file
Use the official online service on GOV.UK. There is no fee. Keep a copy of everything you submit.

## After filing
The tribunal sends the claim to the employer, who has 28 days to respond on an ET3. You will then receive directions about the next steps.`,
    },
    {
        slug: "unfair-dismissal",
        title: "Unfair dismissal",
        summary: "When a dismissal can be unfair, the qualifying period, and what a tribunal looks at.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        effectiveNote: `Qualifying period reduces to six months from ${formatCommencementLabel(ERA_2025.QUALIFYING_PERIOD_6_MONTHS, false)}.`,
        sourceKeys: ["era1996_s94_98", "era1996_s108", "era2025_qualifying_period"],
        relatedRoutes: ["dismissal"],
        body: `## The basics
Employees with enough continuous service have the right not to be unfairly dismissed. The employer must show a potentially fair reason (capability, conduct, redundancy, illegality or some other substantial reason) and the tribunal decides whether dismissal for that reason was reasonable, including whether a fair procedure was followed.

## Qualifying service
Two years for dismissals before the Employment Rights Act 2025 change; six months for dismissals on or after ${formatCommencementLabel(ERA_2025.QUALIFYING_PERIOD_6_MONTHS, false)}. No service is needed where the reason is automatically unfair, such as whistleblowing, pregnancy, or asserting a statutory right.

## Constructive dismissal
If you resigned because of a fundamental breach of contract by your employer, that can count as a dismissal. Act promptly; delay can be taken as accepting the breach.

## Notice pay
Separately from unfair dismissal, if you were dismissed without notice or pay in lieu, you may have a wrongful dismissal (breach of contract) claim.`,
    },
    {
        slug: "discrimination",
        title: "Discrimination and harassment at work",
        summary: "The protected characteristics, the main types of discrimination, and how the burden of proof works.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["ea2010_s4", "ea2010_s13", "ea2010_s19", "ea2010_s26", "ea2010_s27", "ea2010_s136"],
        relatedRoutes: ["discrimination"],
        body: `## Protected characteristics
Age, disability, gender reassignment, marriage and civil partnership, pregnancy and maternity, race, religion or belief, sex, and sexual orientation.

## Types
- Direct discrimination: treated worse because of a characteristic.
- Indirect discrimination: a rule that disadvantages a group and you, without justification.
- Harassment: unwanted conduct related to a characteristic that violates dignity or creates a hostile environment.
- Victimisation: treated badly because you complained about discrimination.

## Proving it
If you show facts from which discrimination could be concluded, the employer must show it did not discriminate. Keep a record of what happened, when, who was there, and how others were treated.

## Time limits
Three months less one day from the act (or the end of continuing conduct), extended by Acas Early Conciliation.`,
    },
    {
        slug: "disability-adjustments",
        title: "Disability and reasonable adjustments",
        summary: "When the duty to make reasonable adjustments applies and how to ask for them.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["ea2010_s6", "ea2010_s20_21"],
        relatedRoutes: ["disability_adjustments"],
        body: `## The duty
Where a rule, a physical feature or the lack of an aid puts a disabled worker at a substantial disadvantage, the employer must take reasonable steps to remove it. The duty applies once the employer knows, or should know, about the disability and the disadvantage.

## Asking
Put the request in writing: what the difficulty is, what would help, and any medical or occupational-health support. Keep a record of the response.

## If refused
Ask for the reasons in writing. You can raise a grievance, and a failure to make reasonable adjustments can be a tribunal claim.`,
    },
    {
        slug: "whistleblowing",
        title: "Raising wrongdoing (whistleblowing)",
        summary: "What counts as a protected disclosure and the protection against detriment and dismissal.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        effectiveNote: `Sexual harassment is a qualifying disclosure from ${formatCommencementLabel(ERA_2025.SEXUAL_HARASSMENT_WHISTLEBLOWING, false)}.`,
        sourceKeys: ["era1996_part_iva"],
        relatedRoutes: ["whistleblowing"],
        body: `## Protected disclosures
You are protected if you disclose information which you reasonably believe shows wrongdoing (a crime, a breach of a legal obligation, a danger to health and safety, a miscarriage of justice, environmental damage, a cover-up, or sexual harassment) and that the disclosure is in the public interest. It normally needs to be made to your employer or a prescribed body.

## Protection
Workers must not be subjected to a detriment because of a protected disclosure, and dismissal for that reason is automatically unfair with no qualifying period.

## Keep records
Note what you disclosed, to whom, when, and what happened afterwards.`,
    },
    {
        slug: "wages-and-pay",
        title: "Wages, holiday pay and deductions",
        summary: "Unpaid wages, unlawful deductions and how to claim.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["era1996_s13", "era1996_s23"],
        relatedRoutes: ["pay"],
        body: `## Unlawful deductions
Your employer may only deduct from your wages if the law requires it, your written contract allows it, or you agreed in writing beforehand. Being paid less than you are owed counts as a deduction.

## What to do
Check your contract and payslips, raise it in writing, and keep the reply. A tribunal claim must be made within three months less one day of the payday concerned (or the last in a series).`,
    },
    {
        slug: "redundancy",
        title: "Redundancy",
        summary: "Fair redundancy process, consultation, selection and redundancy pay.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: ["era1996_s94_98", "era1996_s164"],
        relatedRoutes: ["redundancy"],
        body: `## A fair process
Genuine redundancy is a potentially fair reason for dismissal, but the employer must still act reasonably: warn and consult, use fair selection criteria applied objectively, and consider alternative work.

## Redundancy pay
Employees with two years' service are entitled to a statutory redundancy payment based on age, service and a week's pay. Claims for a redundancy payment have a six-month time limit.

## Records
Keep the consultation letters, the selection criteria and your scores, and any alternatives you were or were not offered.`,
    },
    {
        slug: "evidence-and-chronologies",
        title: "Keeping evidence and building a chronology",
        summary: "How to keep a clear record that helps at every stage, from a first conversation to a hearing.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        sourceKeys: [],
        relatedRoutes: ["problem_at_work", "not_sure"],
        body: `## Why it matters
Decisions at work, at Acas and at a tribunal turn on what can be shown to have happened. A dated chronology with the documents behind it is the single most useful thing you can build.

## What to keep
- Contracts, payslips, policies and handbooks.
- Letters, emails and messages, with dates.
- Notes of meetings and conversations, written as soon as possible afterwards.
- Medical or occupational-health documents where relevant.

## Do
- Record what happened, when, and who was there.
- Mark anything you are unsure of as approximate or disputed.
- Keep originals safe; work from copies.

## Do not
- Take confidential documents you are not entitled to.
- Record people covertly without considering the risks.`,
    },
    {
        slug: "law-changes",
        title: "Employment Rights Act 2025: what is changing and when",
        summary: "The main changes and their commencement dates, including which are still to be confirmed.",
        jurisdiction: "England, Wales and Scotland",
        lastReviewed: REVIEWED,
        effectiveNote: "Dates marked TBC are to be confirmed by Statutory Instrument.",
        sourceKeys: ["era2025_time_limits", "era2025_qualifying_period", "era2025_fire_and_rehire", "era2025_zero_hours"],
        relatedRoutes: [],
        body: `## Key changes
- Tribunal time limits: three months to six months, expected from ${SIX_MONTHS}.
- Unfair dismissal qualifying period: two years to six months from ${formatCommencementLabel(ERA_2025.QUALIFYING_PERIOD_6_MONTHS, false)}.
- Dismissal for refusing a contract variation (fire and rehire): automatically unfair from ${formatCommencementLabel(ERA_2025.FIRE_AND_REHIRE_AUTO_UNFAIR, false)}.
- Harassment: employers must take all reasonable steps, and are liable for third-party harassment, expected from ${formatCommencementLabel(ERA_2025.HARASSMENT_ALL_REASONABLE_STEPS, isCommencementTbc("HARASSMENT_ALL_REASONABLE_STEPS"))}.
- Sexual harassment as a protected disclosure from ${formatCommencementLabel(ERA_2025.SEXUAL_HARASSMENT_WHISTLEBLOWING, false)}.
- Zero-hours workers: guaranteed hours, shift notice and cancellation pay. Date TBC.

## Which version applies to you
The rule in force on the date of the event applies, not the newest rule. This tool selects the rule by your dates and tells you which version it used.`,
    },
];

export function articleBySlug(slug: string): Article | undefined {
    return ARTICLES.find((a) => a.slug === slug);
}
