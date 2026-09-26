/**
 * Per-task synthesisers for the mock backend. Each returns a JSON string (or
 * plain text for drafting tasks) that satisfies the task's Zod schema.
 *
 * The extraction synthesiser does real, if simple, work: it finds dates in
 * the text and proposes one event per dated sentence, so tests can assert
 * that proposals reach the review queue and that user corrections propagate.
 */

import { isIsoDate } from "@/lib/dates";

const MONTHS: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

/** Find dates in common UK formats; returns ISO strings with their offsets. */
export function findDates(text: string): Array<{ iso: string; index: number; raw: string }> {
    const out: Array<{ iso: string; index: number; raw: string }> = [];
    const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    let m: RegExpExecArray | null;
    while ((m = isoRe.exec(text)) !== null) {
        const iso = `${m[1]}-${m[2]}-${m[3]}`;
        if (isIsoDate(iso)) out.push({ iso, index: m.index, raw: m[0] });
    }
    const longRe = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{4})\b/gi;
    while ((m = longRe.exec(text)) !== null) {
        const iso = `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
        if (isIsoDate(iso)) out.push({ iso, index: m.index, raw: m[0] });
    }
    const slashRe = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;
    while ((m = slashRe.exec(text)) !== null) {
        const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
        if (isIsoDate(iso)) out.push({ iso, index: m.index, raw: m[0] });
    }
    return out.sort((a, b) => a.index - b.index);
}

function sentenceAround(text: string, index: number): string {
    const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("\n", index)) + 1;
    let end = text.indexOf(".", index);
    const nl = text.indexOf("\n", index);
    if (end === -1 || (nl !== -1 && nl < end)) end = nl;
    if (end === -1) end = Math.min(text.length, index + 200);
    return text.slice(start, end + 1).trim().replace(/\s+/g, " ");
}

function categoryFor(sentence: string): string {
    const s = sentence.toLowerCase();
    if (/dismiss|terminat|sacked|summary dismissal|p45|notice of termination/.test(s)) return "dismissal";
    if (/grievance/.test(s)) return "grievance";
    if (/appeal/.test(s)) return "appeal";
    if (/disciplinary|investigation|hearing|allegation|misconduct/.test(s)) return "disciplinary";
    if (/acas|conciliation|certificate/.test(s)) return "acas";
    if (/meeting|1:1|one-to-one|call/.test(s)) return "meeting";
    if (/email|letter|wrote|message|text/.test(s)) return "communication";
    if (/pay|wage|salary|holiday|deduct|payslip/.test(s)) return "pay";
    if (/sick|absen|gp|doctor|medical|fit note/.test(s)) return "medical";
    if (/start(ed)? (work|employment)|joined|contract/.test(s)) return "employment";
    return "other";
}

export function classifyDocument(text: string, filename = ""): string {
    const s = `${filename} ${text.slice(0, 4000)}`.toLowerCase();
    if (/early conciliation certificate|certificate number|r\d{6}\/\d{2}\/\d{2}/.test(s)) return "acas_certificate";
    if (/acas/.test(s)) return "acas_correspondence";
    if (/grievance outcome|outcome of your grievance/.test(s)) return "grievance_outcome";
    if (/appeal outcome|outcome of your appeal/.test(s)) return "appeal_outcome";
    if (/notice of appeal|i wish to appeal|grounds of appeal/.test(s)) return "appeal";
    if (/disciplinary hearing|invited to attend|invitation to.*hearing|allegation/.test(s)) return "disciplinary_invite";
    if (/outcome of the disciplinary|disciplinary outcome|summarily dismissed|dismissed with immediate effect/.test(s)) return "disciplinary_outcome";
    if (/grievance/.test(s)) return "grievance";
    if (/contract of employment|terms and conditions of employment|statement of particulars/.test(s)) return "contract";
    if (/payslip|net pay|gross pay|paye/.test(s)) return "payslip";
    if (/witness statement/.test(s)) return "witness_statement";
    if (/policy|handbook|procedure/.test(s)) return "policy";
    if (/fit note|gp|occupational health|medical/.test(s)) return "medical";
    if (/minutes|notes of (the )?meeting/.test(s)) return "meeting_notes";
    if (/^from:|subject:|^to:/m.test(s) || /@/.test(s)) return "email";
    if (/dear /.test(s)) return "letter";
    return "unknown";
}

function extractDocument(inputJson: string): string {
    let payload: { text?: string; filename?: string } = {};
    try {
        payload = JSON.parse(inputJson);
    } catch {
        payload = { text: inputJson };
    }
    const text = payload.text ?? "";
    const dates = findDates(text);
    const seen = new Set<string>();
    const events = [];
    for (const d of dates) {
        const sentence = sentenceAround(text, d.index);
        const key = `${d.iso}|${sentence.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({
            date: d.iso,
            dateEnd: null,
            approximate: false,
            title: sentence.length > 80 ? `${sentence.slice(0, 77)}…` : sentence || `Event on ${d.iso}`,
            description: sentence,
            category: categoryFor(sentence),
            confidence: 70,
            quote: sentence.slice(0, 200),
        });
        if (events.length >= 25) break;
    }
    const docType = classifyDocument(text, payload.filename);
    const facts = [];
    const dismissal = events.find((e) => e.category === "dismissal");
    if (dismissal) {
        facts.push({ statement: `The document refers to a dismissal on ${dismissal.date}.`, key: "dismissal_date", value: dismissal.date, provenance: "DOCUMENT_EXTRACTED", confidence: 60, quote: dismissal.quote });
    }
    const allegations = [];
    const allegationRe = /(?:allegation|alleged that|it is alleged)[:\s]+([^.\n]{10,200})/gi;
    let am: RegExpExecArray | null;
    while ((am = allegationRe.exec(text)) !== null && allegations.length < 10) {
        allegations.push({ allegation: am[1].trim(), evidence: null });
    }
    const documentDate = dates[0]?.iso ?? null;
    return JSON.stringify({
        documentType: docType,
        documentDate,
        author: null,
        recipients: [],
        summary: text.trim() ? `${text.trim().slice(0, 240).replace(/\s+/g, " ")}${text.length > 240 ? "…" : ""}` : "No readable text was found.",
        events,
        facts,
        allegations,
    });
}

function classifyOnly(inputJson: string): string {
    let payload: { text?: string; filename?: string } = {};
    try {
        payload = JSON.parse(inputJson);
    } catch {
        payload = { text: inputJson };
    }
    return JSON.stringify({ documentType: classifyDocument(payload.text ?? "", payload.filename), confidence: 60, reason: "keyword match (mock)" });
}

function inferRoutes(inputJson: string): string {
    let payload: { description?: string } = {};
    try {
        payload = JSON.parse(inputJson);
    } catch {
        payload = { description: inputJson };
    }
    const s = (payload.description ?? "").toLowerCase();
    const routes: string[] = [];
    if (/dismiss|sacked|fired|let go|terminat/.test(s)) routes.push("dismissal");
    if (/redundan/.test(s)) routes.push("redundancy");
    if (/discriminat|\brace\b|\bsex\b|\bage\b|religion|pregnan|maternity|harass|bull(y|ied)|\bdisab/.test(s)) routes.push("discrimination");
    if (/disab|adjustment|reasonable adjust/.test(s)) routes.push("disability_adjustments");
    if (/whistle|wrongdoing|raised concerns|health and safety|reported/.test(s)) routes.push("whistleblowing");
    if (/pay|wage|salary|holiday|overtime|deduct/.test(s)) routes.push("pay");
    if (/contract|hours changed|chang(e|ed|ing) my (role|shifts|hours)|shifts? (changed|changing)|\brota\b|new terms/.test(s)) routes.push("contract_change");
    if (/disciplinary|investigation|hearing|allegation|misconduct/.test(s)) routes.push("disciplinary");
    if (/grievance|complain/.test(s)) routes.push("grievance");
    if (/appeal/.test(s)) routes.push("appeal");
    if (/acas|conciliation/.test(s)) routes.push("acas_early_conciliation");
    if (/tribunal|et1/.test(s)) routes.push("considering_tribunal");
    if (routes.length === 0) routes.push("problem_at_work");
    return JSON.stringify({
        routes: routes.map((r) => ({ route: r, reason: `The description mentions something related to ${r.replace(/_/g, " ")}.` })),
        summary: (payload.description ?? "").trim().slice(0, 300),
        clarifyingQuestions: [
            "When did the most recent thing you are concerned about happen?",
            "Are you still employed there?",
            "Has your employer started any formal process, or have you raised one?",
        ],
    });
}

function draft(task: string, inputJson: string): string {
    let payload: Record<string, unknown> = {};
    try {
        payload = JSON.parse(inputJson);
    } catch {
        payload = { text: inputJson };
    }
    const lines: string[] = [];
    const title = String(payload.title ?? task.replace(/_/g, " "));
    lines.push(`# ${title}`);
    lines.push("");
    if (payload.recipient) lines.push(`To: ${String(payload.recipient)}`);
    if (payload.date) lines.push(`Date: ${String(payload.date)}`);
    lines.push("");
    if (Array.isArray(payload.issues) && payload.issues.length) {
        lines.push("## What this is about");
        for (const i of payload.issues as Array<{ title?: string; description?: string }>) lines.push(`- ${i.title ?? ""}${i.description ? `: ${i.description}` : ""}`);
        lines.push("");
    }
    if (Array.isArray(payload.events) && payload.events.length) {
        lines.push("## What happened (confirmed facts)");
        for (const e of payload.events as Array<{ date?: string; title?: string; description?: string }>) lines.push(`- ${e.date ?? ""}: ${e.title ?? ""}${e.description && e.description !== e.title ? ` — ${e.description}` : ""}`);
        lines.push("");
    }
    if (Array.isArray(payload.facts) && payload.facts.length) {
        lines.push("## Facts relied on");
        for (const f of payload.facts as Array<{ statement?: string }>) lines.push(`- ${f.statement ?? ""}`);
        lines.push("");
    }
    if (Array.isArray(payload.grounds) && payload.grounds.length) {
        lines.push("## Grounds");
        for (const g of payload.grounds as Array<{ category?: string; summary?: string; detail?: string }>) lines.push(`- ${(g.category ?? "").replace(/_/g, " ")}: ${g.summary ?? ""}${g.detail ? ` ${g.detail}` : ""}`);
        lines.push("");
    }
    if (Array.isArray(payload.allegations) && payload.allegations.length) {
        lines.push("## Allegations and responses");
        for (const a of payload.allegations as Array<{ employerAllegation?: string; workerResponse?: string; missingInformation?: string }>) {
            lines.push(`- Allegation: ${a.employerAllegation ?? ""}`);
            lines.push(`  - My response: ${a.workerResponse ?? "(not yet recorded)"}`);
            if (a.missingInformation) lines.push(`  - Information I still need: ${a.missingInformation}`);
        }
        lines.push("");
    }
    if (payload.desiredResolution) {
        lines.push("## What I am asking for");
        lines.push(String(payload.desiredResolution));
        lines.push("");
    }
    if (Array.isArray(payload.uncertainties) && payload.uncertainties.length) {
        lines.push("## Points still to confirm");
        for (const u of payload.uncertainties as string[]) lines.push(`- ${u}`);
        lines.push("");
    }
    lines.push("_Generated from the confirmed case record. Please read and edit before sending._");
    return lines.join("\n");
}

function summariseCase(inputJson: string): string {
    let payload: Record<string, unknown> = {};
    try {
        payload = JSON.parse(inputJson);
    } catch {
        payload = {};
    }
    const events = (payload.events as Array<{ date: string; title: string }> | undefined) ?? [];
    const facts = (payload.facts as Array<{ statement: string }> | undefined) ?? [];
    const employer = (payload.employer as string | undefined) ?? "your employer";
    const first = events[0];
    const last = events[events.length - 1];
    const summary = [
        `This case concerns a problem at work with ${employer}.`,
        first && last && first !== last ? `The confirmed events run from ${first.date} (${first.title}) to ${last.date} (${last.title}).` : first ? `The main confirmed event is on ${first.date}: ${first.title}.` : "No events have been confirmed yet.",
        facts.length ? `${facts.length} fact${facts.length === 1 ? " has" : "s have"} been confirmed.` : "No facts have been confirmed yet.",
    ].join(" ");
    return JSON.stringify({
        summary,
        whatIsHappening: summary,
        stillUnclear: facts.length === 0 ? ["What outcome you want.", "The key dates."] : ["Whether any documents are still missing."],
    });
}

function analyseClaim(inputJson: string): string {
    let payload: { claimType?: string; elements?: Array<{ key: string; label: string }>; facts?: Array<{ id: string; statement: string; key?: string | null }> } = {};
    try {
        payload = JSON.parse(inputJson);
    } catch {
        payload = {};
    }
    const facts = payload.facts ?? [];
    const elements = (payload.elements ?? []).map((el) => {
        const relevant = facts.filter((f) => f.statement.toLowerCase().includes(el.key.replace(/_/g, " ").split(" ")[0]));
        return {
            elementKey: el.key,
            status: relevant.length > 0 ? "potentially_supported" : "information_missing",
            reasoning: relevant.length > 0 ? `Confirmed fact(s) mention this element: ${relevant.map((f) => f.statement).join("; ")}` : `No confirmed fact currently addresses "${el.label}".`,
            supportingFactIds: relevant.map((f) => f.id),
            contraryFactIds: [],
            missingInformation: relevant.length > 0 ? [] : [`Information about: ${el.label}`],
        };
    });
    return JSON.stringify({
        elements,
        contraryFactIds: [],
        missingFacts: elements.filter((e) => e.status === "information_missing").map((e) => e.missingInformation[0]),
        uncertainties: ["This analysis is based only on the facts you have confirmed so far."],
        alternatives: [],
    });
}

function review(inputJson: string): string {
    let payload: { conclusions?: Array<{ id: string; supportingFactIds: string[] }>; confirmedFactIds?: string[] } = {};
    try {
        payload = JSON.parse(inputJson);
    } catch {
        payload = {};
    }
    const confirmed = new Set(payload.confirmedFactIds ?? []);
    const findings = [];
    for (const c of payload.conclusions ?? []) {
        const unsupported = c.supportingFactIds.filter((id) => !confirmed.has(id));
        if (unsupported.length > 0) {
            findings.push({ conclusionId: c.id, question: "supported_by_confirmed_facts", passed: false, note: `Relies on unconfirmed fact(s): ${unsupported.join(", ")}` });
        }
    }
    return JSON.stringify({
        passed: findings.length === 0,
        findings,
        checks: {
            supported_by_confirmed_facts: findings.length === 0,
            contrary_facts_included: true,
            legal_rules_sourced: true,
            correct_temporal_version: true,
            allegation_not_treated_as_evidence: true,
            inference_not_presented_as_fact: true,
            missing_facts_identified: true,
            claim_available_in_jurisdiction: true,
            deadline_deterministic: true,
            output_within_evidence: findings.length === 0,
        },
    });
}

export function synthesise(task: string, input: string): string {
    switch (task) {
        case "extract_document_v1":
            return extractDocument(input);
        case "classify_document_v1":
            return classifyOnly(input);
        case "infer_routes_v1":
            return inferRoutes(input);
        case "summarise_case_v1":
            return summariseCase(input);
        case "analyse_claim_v1":
            return analyseClaim(input);
        case "review_analysis_v1":
            return review(input);
        default:
            if (task.startsWith("draft_")) return draft(task, input);
            return JSON.stringify({ note: `mock backend has no synthesiser for task '${task}'` });
    }
}
