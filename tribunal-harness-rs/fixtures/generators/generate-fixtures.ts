/**
 * Golden-fixture generator — runs the TypeScript (Next.js) app's own modules
 * in-process and records their outputs so the Rust port can be diffed against
 * them. Everything here is hermetic: LLM_PROVIDER=agent, no ANTHROPIC_API_KEY,
 * global fetch replaced by canned responders (no network).
 *
 * Run from the Next.js app directory so `@/…` aliases and node_modules resolve:
 *
 *   cd tribunal-harness
 *   LLM_PROVIDER=agent npx tsx --tsconfig tsconfig.json \
 *       ../tribunal-harness-rs/fixtures/generators/generate-fixtures.ts
 *
 * Output: ../tribunal-harness-rs/fixtures/** (see fixtures/README.md).
 */

process.env.LLM_PROVIDER = "agent";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ERA_2025_TIME_LIMIT_COMMENCEMENT;
delete process.env.RESEND_API_KEY;
delete process.env.NOTIFY_EMAIL;
delete process.env.REFINEMENT_DISABLED;
delete process.env.WEBHOOK_SECRET;
delete process.env.NODE_ENV;

import { mkdirSync, writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..");
// Bare packages (mammoth, pdf-parse) live in the Next app's node_modules, not
// next to this generator — resolve them from the app directory (the cwd).
const appRequire = createRequire(join(process.cwd(), "package.json"));

function write(rel: string, data: unknown): void {
    const p = join(OUT, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`[fixtures] wrote ${rel}`);
}
function writeRaw(rel: string, data: string | Buffer): void {
    const p = join(OUT, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    console.log(`[fixtures] wrote ${rel}`);
}

// Today (UTC calendar date) at generation — deadline days_remaining / is_expired
// are relative to this. The Rust comparison tests inject the same "today".
const TODAY = new Date().toISOString().slice(0, 10);

function isoAddDays(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return t.toISOString().slice(0, 10);
}
function* dateRange(from: string, to: string, step = 1): Generator<string> {
    let cur = from;
    while (cur <= to) {
        yield cur;
        cur = isoAddDays(cur, step);
    }
}

// Plain Request stand-in for NextRequest (routes only use the WHATWG surface).
function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Request {
    return new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}
function postRaw(url: string, body: string, headers: Record<string, string> = {}): Request {
    return new Request(url, { method: "POST", headers, body });
}
function get(url: string): Request {
    return new Request(url, { method: "GET" });
}
async function capture(res: Response): Promise<{ status: number; body: unknown }> {
    return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Canned fetch responders (no network ever).
// ---------------------------------------------------------------------------
const FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:tna="https://caselaw.nationalarchives.gov.uk">
<entry><title>Essop &amp; Ors v Home Office (UK Border Agency)</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2017/27" rel="alternate"/><published>2017-04-05T00:00:00+00:00</published><updated>2017-04-05T00:00:00+00:00</updated><author><name>United Kingdom Supreme Court</name></author><tna:identifier slug="uksc/2017/27" type="ukncn">[2017] UKSC 27</tna:identifier></entry>
<entry><title>G Laffy v Wkcic Group T/A Capital City College Group</title><link href="https://caselaw.nationalarchives.gov.uk/eat/2026/90" rel="alternate"/><published>2026-06-19T00:00:00+00:00</published><updated>2026-06-19T09:37:47+00:00</updated><author><name>Employment Appeal Tribunal</name></author><tna:identifier slug="eat/2026/90" type="ukncn">[2026] EAT 90</tna:identifier></entry>
</feed>`;
const EMPTY_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:tna="https://caselaw.nationalarchives.gov.uk"></feed>`;
const FMX_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:tna="https://caselaw.nationalarchives.gov.uk">
<entry><title>FMX Food Merchants Import Export Co Ltd v HMRC</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2020/1" rel="alternate"/><published>2020-01-29T00:00:00+00:00</published><updated>2020-01-29T00:00:00+00:00</updated><author><name>United Kingdom Supreme Court</name></author><tna:identifier slug="uksc/2020/1" type="ukncn">[2020] UKSC 1</tna:identifier></entry>
</feed>`;
// Attribute order swapped + bare alternate link fallback + numeric/hex entities + totalResults.
const FEED_VARIANT = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:tna="https://caselaw.nationalarchives.gov.uk" xmlns:openSearch="http://a9.com/-/spec/opensearch/1.1/">
<openSearch:totalResults>42</openSearch:totalResults>
<entry><title>Smith &#38; Jones v Acme &#x26; Co &lt;Ltd&gt; &quot;Q&quot; &apos;A&apos; &#39;B&#39;</title><link rel="alternate" href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2019/123/"/><published>2019-03-01T10:00:00+00:00</published><author><name>Court of Appeal (Civil Division)</name></author><tna:identifier type="ukncn" slug="ewca/civ/2019/123">[2019] EWCA Civ 123</tna:identifier></entry>
<entry><title>No Citation Case</title><link rel="alternate" href="https://caselaw.nationalarchives.gov.uk/eat/2021/7"/><link rel="alternate" type="application/pdf" href="https://caselaw.nationalarchives.gov.uk/eat/2021/7/data.pdf"/><author><name>Employment Appeal Tribunal</name></author></entry>
<entry><title>Untitled Slugless</title><published>2020-01-01T00:00:00+00:00</published></entry>
</feed>`;
const FEEDS: Record<string, string> = { FEED, EMPTY_FEED, FMX_FEED, FEED_VARIANT };

type FetchMode =
    | { kind: "ok"; body: string }
    | { kind: "status"; status: number }
    | { kind: "abort" }
    | { kind: "reject" }
    | { kind: "pdf"; bytes: Buffer; contentLength?: string }
    | { kind: "redirect"; location: string; then?: FetchMode };

const fetchCalls: string[] = [];
let fetchMode: FetchMode = { kind: "reject" };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push(url);
    const mode = fetchMode;
    if (mode.kind === "ok") {
        return { ok: true, status: 200, text: async () => mode.body, headers: { get: () => null } } as unknown as Response;
    }
    if (mode.kind === "status") {
        return { ok: false, status: mode.status, text: async () => "", headers: { get: () => null } } as unknown as Response;
    }
    if (mode.kind === "abort") {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    if (mode.kind === "pdf") {
        const b = mode.bytes;
        return {
            ok: true,
            status: 200,
            headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? mode.contentLength ?? null : null) },
            arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as unknown as Response;
    }
    if (mode.kind === "redirect") {
        if (mode.then) fetchMode = mode.then;
        return {
            ok: false,
            status: 302,
            headers: { get: (k: string) => (k.toLowerCase() === "location" ? mode.location : null) },
        } as unknown as Response;
    }
    throw new Error("network disabled in fixture generation");
}) as typeof fetch;
void realFetch;

// ---------------------------------------------------------------------------
// Tiny valid PDF + DOCX documents (hand-built, no extra deps).
// ---------------------------------------------------------------------------
function crc32(buf: Buffer): number {
    let c: number;
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function buildZip(files: Array<{ name: string; data: string }>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
        const name = Buffer.from(f.name, "utf8");
        const raw = Buffer.from(f.data, "utf8");
        const comp = deflateRawSync(raw);
        const crc = crc32(raw);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(0, 6);
        lh.writeUInt16LE(8, 8); // deflate
        lh.writeUInt16LE(0, 10);
        lh.writeUInt16LE(0, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(comp.length, 18);
        lh.writeUInt32LE(raw.length, 22);
        lh.writeUInt16LE(name.length, 26);
        lh.writeUInt16LE(0, 28);
        const local = Buffer.concat([lh, name, comp]);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0, 8);
        ch.writeUInt16LE(8, 10);
        ch.writeUInt16LE(0, 12);
        ch.writeUInt16LE(0, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(comp.length, 20);
        ch.writeUInt32LE(raw.length, 24);
        ch.writeUInt16LE(name.length, 28);
        ch.writeUInt16LE(0, 30);
        ch.writeUInt16LE(0, 32);
        ch.writeUInt16LE(0, 34);
        ch.writeUInt16LE(0, 36);
        ch.writeUInt32LE(0, 38);
        ch.writeUInt32LE(offset, 42);
        centrals.push(Buffer.concat([ch, name]));
        locals.push(local);
        offset += local.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, cd, eocd]);
}
function buildDocx(paragraphs: string[][]): Buffer {
    const body = paragraphs
        .map((runs) => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join("")}</w:p>`)
        .join("");
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
    return buildZip([
        {
            name: "[Content_Types].xml",
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        },
        {
            name: "_rels/.rels",
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
        },
        { name: "word/document.xml", data: doc },
    ]);
}

// sample.pdf was printed once from documents/sample.html with the pre-installed
// Chromium (`chrome --headless=new --print-to-pdf`) so it is a realistic,
// compressed, font-embedding PDF rather than a toy hand-built one.
const SAMPLE_PDF = readFileSync(join(OUT, "documents/sample.pdf"));
const SAMPLE_DOCX = buildDocx([
    ["I was dismissed on 14 January 2025 ", "without any disciplinary process."],
    ["Employer: Acme Logistics Ltd."],
    ["EDT: 2025-01-14"],
]);
writeRaw("documents/sample.docx", SAMPLE_DOCX);
writeRaw(
    "documents/sample.txt",
    "Claimant: warehouse employee with ~4 years' service. Dismissed 3 March 2026 for alleged gross misconduct shortly after raising written health and safety concerns. No investigation meeting was held. Employer: Acme Logistics Ltd. EDT: 2026-03-03."
);

async function main(): Promise<void> {
    // ── Constants ──────────────────────────────────────────────────────
    const constants = await import("@/lib/constants");
    const eraIso = Object.entries(constants.ERA_2025)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => v as string);
    const extraIso = ["2024-02-29", "2025-12-31", "2026-02-28", "2028-02-29", "2027-06-15", "2026-10-01"];
    write("constants/constants.json", {
        generated_today: TODAY,
        ERA_2025: constants.ERA_2025,
        ERA_2025_TRACKER: constants.ERA_2025_TRACKER,
        TIME_LIMIT_CONFIG: constants.TIME_LIMIT_CONFIG,
        QUALIFYING_PERIOD_CONFIG: constants.QUALIFYING_PERIOD_CONFIG,
        CLAIM_TYPES: constants.CLAIM_TYPES,
        FSM_STATES: constants.FSM_STATES,
        TBC_COMMENCEMENT_KEYS: [...constants.TBC_COMMENCEMENT_KEYS],
        format_samples: [...new Set([...eraIso, ...extraIso])].map((iso) => ({
            iso,
            date: constants.formatCommencementDate(iso),
            month: constants.formatCommencementMonth(iso),
            label_tbc: constants.formatCommencementLabel(iso, true),
            label_fixed: constants.formatCommencementLabel(iso, false),
        })),
        is_tbc: Object.keys(constants.ERA_2025).map((k) => ({ key: k, tbc: constants.isCommencementTbc(k) })),
        resolve_time_limit_commencement: [
            "", "   ", "2026-11-15", "2027-05-01", "garbage", "2026-02-30", "2026-13-01", "2026-10-01T00:00:00Z", "01/10/2026", "2026-1-1", "20261001",
        ].map((input) => {
            try {
                return { input, ok: constants.resolveTimeLimitCommencement(input) };
            } catch (e) {
                return { input, error: (e as Error).message };
            }
        }),
        resolve_undefined: constants.resolveTimeLimitCommencement(undefined),
    });

    // ── Verified authorities ──────────────────────────────────────────
    const va = await import("@/lib/verified-authorities");
    write("constants/verified-authorities.json", {
        VERIFIED_AUTHORITIES: va.VERIFIED_AUTHORITIES,
        find_by_short_name: ["Polkey", "polkey", "POLKEY", "BHS v Burchell", "Nonexistent Case Name", "", "Igen v Wong", "tesco v usdaw"].map((q) => ({
            input: q,
            result: va.findAuthorityByShortName(q)?.shortName ?? null,
        })),
        find_by_partial: [
            "The tribunal relied on Polkey in its reasoning.",
            "See Polkey v AE Dayton Services Ltd for the principle.",
            "the polkey principle",
            "This text mentions no known case.",
            "Chief Constable of West Yorkshire Police v Vento (No 2) [2002]",
            "Essop v Home Office [2017] UKSC 27",
            "Tesco Stores Ltd v Union of Shop, Distributive and Allied Workers [2024] UKSC 28",
            "Homer v Chief Constable [2012] UKSC 15",
            "british home stores ltd v burchell",
            "",
        ].map((q) => ({ input: q, result: va.findAuthorityByPartialMatch(q)?.shortName ?? null })),
    });

    // ── Claude config ─────────────────────────────────────────────────
    const cfg = await import("@/lib/claude-config");
    const costSamples: Array<[string, number, number]> = [];
    for (const model of Object.values(cfg.CLAUDE_MODELS)) {
        for (const [i, o] of [
            [0, 0], [1, 1], [10000, 5000], [1000000, 2000000], [1000000, 1000000], [123456, 654321], [7, 3], [999999, 1], [1, 999999], [1656, 685], [2312, 1341],
        ]) {
            costSamples.push([model, i, o]);
        }
    }
    const warnSpy: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnSpy.push(args.map(String).join(" ")); };
    const unknownCfg = cfg.getEndpointConfig("does-not-exist");
    console.warn = origWarn;
    write("constants/claude-config.json", {
        CLAUDE_MODELS: cfg.CLAUDE_MODELS,
        ENDPOINT_CONFIG: cfg.ENDPOINT_CONFIG,
        cost_samples: costSamples.map(([model, i, o]) => ({ model, input_tokens: i, output_tokens: o, result: cfg.estimateCost(model as never, i, o) })),
        unknown_endpoint_falls_back_to: unknownCfg.label,
        unknown_endpoint_warning: warnSpy,
    });

    // ── Prompts ───────────────────────────────────────────────────────
    const prompts = await import("@/agents/prompts");
    write("prompts/prompts.json", {
        PROMPT_VERSIONS: prompts.PROMPT_VERSIONS,
        REFINEMENT_PROMPT_VERSION: prompts.REFINEMENT_PROMPT_VERSION,
        ANALYSE_PROMPT_v2: prompts.ANALYSE_PROMPT_v2,
        TRIAGE_PROMPT_v2: prompts.TRIAGE_PROMPT_v2,
        DRAFTER_PROMPT_v2: prompts.DRAFTER_PROMPT_v2,
        CRITIC_PROMPT_v2: prompts.CRITIC_PROMPT_v2,
        JUDGE_PROMPT_v2: prompts.JUDGE_PROMPT_v2,
        ANALYSE_PROMPT_v1: prompts.ANALYSE_PROMPT_v1,
        TRIAGE_PROMPT_v1: prompts.TRIAGE_PROMPT_v1,
        DRAFTER_PROMPT_v1: prompts.DRAFTER_PROMPT_v1,
        CRITIC_PROMPT_v1: prompts.CRITIC_PROMPT_v1,
        JUDGE_PROMPT_v1: prompts.JUDGE_PROMPT_v1,
        LEGAL_WRITING_REFINEMENT_PROMPT_v1: prompts.LEGAL_WRITING_REFINEMENT_PROMPT_v1,
    });

    // ── Schemas ───────────────────────────────────────────────────────
    const schemas = await import("@/schemas");
    write("schemas/all-schemas.json", { SCHEMAS: schemas.SCHEMAS, order: schemas.getAllSchemas().map((s) => s.id), unknown: schemas.getSchema("made_up") });

    // ── Deadline calculator ───────────────────────────────────────────
    const dl = await import("@/services/deadline-calculator");
    const parseUTC = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
    const toIso = (d: Date) => d.toISOString().slice(0, 10);
    const addMonths: Array<{ date: string; months: number; result: string }> = [];
    for (const date of dateRange("2024-01-01", "2028-12-31")) {
        for (const months of [1, 3, 6, 12]) {
            addMonths.push({ date, months, result: toIso(dl.addMonthsLessOneDay(parseUTC(date), months)) });
        }
    }
    write("deadlines/add-months-less-one-day.json", { cases: addMonths });

    const grid: Array<{ date_of_act: string; claim_types: string[]; result: unknown }> = [];
    for (const date of dateRange("2024-06-01", "2029-06-30")) {
        grid.push({ date_of_act: date, claim_types: ["unfair_dismissal"], result: dl.calculateDeadlines(date, ["unfair_dismissal"]) });
    }
    write("deadlines/grid-no-acas.json", { generated_today: TODAY, cases: grid });

    const offsets: Array<[number, number]> = [
        [0, 0], [1, 1], [5, 10], [10, 45], [30, 60], [60, 90], [80, 95], [85, 120], [88, 88], [89, 100], [90, 91], [95, 100], [120, 150], [-5, 5], [20, 10], [0, 200], [170, 200], [181, 190],
    ];
    const acas: Array<{ date_of_act: string; acas_day_a: string; acas_day_b: string; claim_types: string[]; result: unknown; single: unknown }> = [];
    for (const date of dateRange("2025-01-01", "2027-12-31", 7)) {
        for (const [a, b] of offsets) {
            const dayA = isoAddDays(date, a);
            const dayB = isoAddDays(date, b);
            acas.push({
                date_of_act: date,
                acas_day_a: dayA,
                acas_day_b: dayB,
                claim_types: ["unfair_dismissal", "direct_discrimination"],
                result: dl.calculateDeadlines(date, ["unfair_dismissal", "direct_discrimination"], dayA, dayB),
                single: dl.calculateDeadline(date, dayA, dayB, "unfair_dismissal"),
            });
        }
    }
    write("deadlines/grid-acas.json", { generated_today: TODAY, cases: acas });

    const ALL_CT = constants.CLAIM_TYPES.map((c) => c.id);
    const multi = [
        { date_of_act: "2025-06-01", claim_types: ALL_CT },
        { date_of_act: "2027-03-01", claim_types: ALL_CT },
        { date_of_act: "2026-09-15", claim_types: ["unfair_dismissal", "wrongful_dismissal"] },
        { date_of_act: "2026-09-29", claim_types: ["unfair_dismissal"] },
        { date_of_act: "2020-01-01", claim_types: ["unfair_dismissal"] },
        { date_of_act: "2028-10-01", claim_types: ["unfair_dismissal"] },
        { date_of_act: "2025-06-01", claim_types: [] },
        { date_of_act: TODAY, claim_types: ["unfair_dismissal"] },
        { date_of_act: isoAddDays(TODAY, -85), claim_types: ["unfair_dismissal"] },
        { date_of_act: isoAddDays(TODAY, -89), claim_types: ["unfair_dismissal"] },
        { date_of_act: isoAddDays(TODAY, -90), claim_types: ["unfair_dismissal"] },
        { date_of_act: isoAddDays(TODAY, -91), claim_types: ["unfair_dismissal"] },
        { date_of_act: isoAddDays(TODAY, -100), claim_types: ["unfair_dismissal"], acas_day_a: isoAddDays(TODAY, -50), acas_day_b: isoAddDays(TODAY, -20) },
        { date_of_act: "2025-01-01", claim_types: ["unfair_dismissal"], acas_day_a: "2025-04-10", acas_day_b: "2025-04-15" },
        { date_of_act: "2025-01-01", claim_types: ["unfair_dismissal"], acas_day_a: "2025-02-15", acas_day_b: "2025-02-01" },
        { date_of_act: "2026-09-15", claim_types: ["unfair_dismissal"], acas_day_a: "2026-09-20", acas_day_b: "2026-10-05" },
        { date_of_act: "2027-01-31", claim_types: ["harassment", "victimisation"], acas_day_a: "2027-04-30", acas_day_b: "2027-05-31" },
        { date_of_act: "2026-11-30", claim_types: ["unfair_dismissal"], acas_day_a: "2027-02-27", acas_day_b: "2027-03-30" },
    ].map((c) => ({ ...c, result: dl.calculateDeadlines(c.date_of_act, c.claim_types, c.acas_day_a, c.acas_day_b) }));
    write("deadlines/multi.json", { generated_today: TODAY, cases: multi });

    const singles = [
        ["2025-06-01"], ["2026-10-15"], ["2026-10-01"], ["2026-09-30"], ["2025-01-15"], ["2025-04-06"], ["2025-04-07"], ["2020-01-01"], ["2099-01-01"],
        ["2025-01-01", "2025-02-01", "2025-02-15"], ["2025-01-01", "2025-03-30", "2025-04-01"], ["2025-01-01", "2025-04-10", "2025-04-15"],
        ["2026-01-15", "2026-06-01", "2026-07-01"], ["2025-01-01", "2025-02-15", "2025-02-01"], ["2025-01-01", "2025-02-10", "2025-02-10"],
        ["2026-09-15", "2026-09-20", "2026-10-05", "unfair_dismissal"], ["2025-01-01", undefined, undefined, "wrongful_dismissal"], ["2028-12-31"],
        ["2027-11-30"], ["2027-12-01"], ["2025-01-31"], ["2025-08-31"], ["2025-11-30"],
    ].map(([d, a, b, ct]) => ({ date_of_act: d, acas_day_a: a ?? null, acas_day_b: b ?? null, claim_type: ct ?? null, result: dl.calculateDeadline(d as string, a as string | undefined, b as string | undefined, ct as string | undefined) }));
    write("deadlines/single.json", { generated_today: TODAY, cases: singles });

    const invalid = [
        ["not-a-date"], ["2026-02-31"], ["2025-01-01", "2025-13-40", "2025-02-15"], [""], ["2025-1-1"], ["2025-01-01T00:00:00Z"], ["20250101"], ["2025-00-10"], ["2025-01-00"], ["2025-01-01", "bad", "2025-02-15"], ["2025-01-01", "2025-02-15", "2025-02-30"], ["0000-01-01"], ["2025-02-29"], ["2024-02-29"],
    ].map(([d, a, b]) => {
        try {
            return { date_of_act: d, acas_day_a: a ?? null, acas_day_b: b ?? null, ok: dl.calculateDeadline(d as string, a as string | undefined, b as string | undefined) };
        } catch (e) {
            return { date_of_act: d, acas_day_a: a ?? null, acas_day_b: b ?? null, error: (e as Error).message };
        }
    });
    write("deadlines/invalid.json", { generated_today: TODAY, cases: invalid });

    // ── Qualifying period ─────────────────────────────────────────────
    const qp = await import("@/services/qualifying-period");
    const qpCases: Array<{ employment_start: string; edt: string; result?: unknown; error?: string }> = [];
    const starts = ["2020-01-01", "2024-06-15", "2026-04-30", "2026-12-31", "2027-01-01", "2024-01-31", "2024-02-29", "2025-03-31", "2026-08-30", "2026-07-01"];
    for (const s of starts) {
        for (const e of dateRange("2026-06-01", "2027-12-31", 3)) {
            if (e < s) continue;
            qpCases.push({ employment_start: s, edt: e, result: qp.qualifyingPeriod(s, e) });
        }
    }
    for (const [s, e] of [["not-a-date", "2027-01-01"], ["2026-02-30", "2027-01-01"], ["01/01/2020", "2027-01-01"], ["2027-01-01", "2020-01-01"], ["", "2027-01-01"], ["2027-01-01", "2027-01-02"], [" 2024-06-15 ", "2026-06-15"]]) {
        try {
            qpCases.push({ employment_start: s, edt: e, result: qp.qualifyingPeriod(s, e) });
        } catch (err) {
            qpCases.push({ employment_start: s, edt: e, error: (err as Error).message });
        }
    }
    write("qualifying-period/grid.json", { cases: qpCases });

    // ── Citation validator (offline) ──────────────────────────────────
    const cv = await import("@/services/citation-validator");
    const fcl = await import("@/services/find-case-law");
    const citeInputs: string[] = [
        "Polkey v AE Dayton Services Ltd [1987] UKHL 8", "Shamoon v Chief Constable [2003] UKHL 11", "BHS v Burchell [1978] UKEAT 0108_78_2007",
        "Iceland Frozen Foods Ltd v Jones [1982] UKEAT 0062_82_2207", "BHS v Burchell [1978]", "Essop v Home Office [2017] UKSC 27",
        "Polkey v AE Dayton Services Ltd [1988] AC 344", "Polkey v AE Dayton Services Ltd [2025] UKSC 99", "Nonexistent Authority v Someone [1987] UKHL 8",
        "Chief Constable of West Yorkshire Police v Vento (No 2) [2002]", "Smith v Acme Corp [2025] EAT 999", "", "   ", "polkey v AE Dayton Services Ltd [1987] UKHL 8",
        "Tesco Stores Ltd v Union of Shop, Distributive and Allied Workers [2024] UKSC 28", "Chesterton Global Ltd v Nurmohamed [2017] EWCA Civ 979",
        "Archibald v Fife Council [2004] UKHL 32", "Made Up Case v Nobody [2025] EAT 000", "Polkey v AE Dayton [1987] UKHL 8", "Homer v Chief Constable [2012] UKSC 15",
        "Polkey", "Polkey [1987]UKHL 8", "Polkey  v   AE Dayton  [ 1987 ]  UKHL  8", "See Polkey v AE Dayton Services Ltd [1987] UKHL 8 at [12]",
        "Kucukdeveci v Swedex GmbH C-555/07", "Kucukdeveci C-555/07", "Gunton v Richmond-upon-Thames London Borough Council [1981] 1 Ch 448",
        "Williams v Compair Maxam Ltd [1982] ICR 156", "Western Excavating (ECC) Ltd v Sharp [1978] ICR 221", "Igen Ltd v Wong [2005] EWCA Civ 142",
        "Igen v Wong [2005] ICR 931", "Vento v Chief Constable of West Yorkshire Police (No 2) [2002] EWCA Civ 1871", "Robertson v Bexley Community Centre [2003] EWCA Civ 1012",
        "Khatun v Winn Solicitors Ltd [2024] EAT 111", "Richmond Pharmacology v Dhaliwal [2009] UKEAT 0458_08_2403", "Environment Agency v Rowan [2008] UKEAT 0060_07_2908",
        "Cavendish Munro Professional Risks Management Ltd v Geduld [2010] UKEAT 0195_09_0202", "Derbyshire v St Helens Metropolitan Borough Council [2007] UKHL 16",
        "Anya v University of Oxford [2001] EWCA Civ 405", "Pemberton v Inwood [2018] EWCA Civ 564", "Chagger v Abbey National plc [2009] EWCA Civ 1176",
        "the polkey principle applies here", "[1987] UKHL 8", "[2005] EWCA Civ 142 Igen", "Burchell", "British Home Stores Ltd v Burchell [1980] ICR 303",
    ];
    for (const a of va.VERIFIED_AUTHORITIES) {
        citeInputs.push(`${a.fullName} ${a.neutralCitation}`);
        citeInputs.push(`${a.shortName} ${a.neutralCitation}`);
        citeInputs.push(a.fullName);
        citeInputs.push(`${a.fullName} [2099] UKSC 999`);
        citeInputs.push(`${a.fullName.toUpperCase()} ${a.neutralCitation.toUpperCase()}`);
    }
    for (const s of Object.values(schemas.SCHEMAS)) for (const k of s.keyAuthorities) citeInputs.push(k);
    const uniqueCites = [...new Set(citeInputs)];
    write("citations/validate.json", {
        cases: uniqueCites.map((input) => ({ input, result: cv.validateCitation(input) })),
        extract_validator: uniqueCites.map((input) => ({ input, result: cv.extractNeutralCitation(input) })),
        extract_fcl: [...uniqueCites, "see Essop v Home Office [2017] UKSC 27 at [25]", "[2009] EWCA Civ 1202", "no citation here", "[2026] EAT 90", "[1978] UKEAT 0108_78_2007"].map((input) => ({ input, result: fcl.extractNeutralCitation(input) })),
        normalise: ["[2017] UKSC 27", "[2017]  uksc 27", "[1978] UKEAT 0108_78_2007", "  [2005] EWCA Civ 142 ", "C-555/07", ""].map((input) => ({ input, result: fcl.normaliseCitation(input) })),
        tokens: ["Essop v Home Office", "FMX Food Merchants v HMRC", "Nonexistent v Fabricated Ltd", "Polkey v AE Dayton Services Ltd", "Tesco Stores Ltd v Union of Shop, Distributive and Allied Workers", "Smith v. Jones", "The Group plc v Others", "", "G Laffy v Wkcic Group T/A Capital City College Group"].map((input) => ({ input, result: fcl.significantPartyTokens(input) })),
        batches: [
            [{ citation: "Polkey v AE Dayton Services Ltd [1987] UKHL 8" }, { citation: "Shamoon v Chief Constable [2003] UKHL 11" }, { citation: "Made Up Case v Nobody [2025] EAT 000" }],
            [],
            [{ citation: "Polkey v AE Dayton [1987] UKHL 8" }, { citation: "Homer v Chief Constable [2012] UKSC 15" }],
            [{ citation: "BHS v Burchell [1978]" }, { citation: "" }, { citation: "Essop v Home Office [2017] UKSC 27" }],
        ].map((authorities) => ({ authorities, result: cv.validateAllCitations(authorities) })),
    });

    // ── Find Case Law (parse + verify + search with canned fetch) ─────
    const parseCases = Object.entries(FEEDS).flatMap(([name, xml]) => [1, 2, 10].map((limit) => ({ feed: name, limit, result: fcl.parseAtomFeed(xml, limit) })));
    write("find-case-law/feeds.json", FEEDS);
    write("find-case-law/parse.json", { cases: parseCases });

    const searchCases: Array<{ mode: string; opts: unknown; result: unknown; fetched: string[] }> = [];
    async function runSearch(mode: FetchMode, label: string, opts: fcl.SearchOptions) {
        fetchMode = mode;
        fetchCalls.length = 0;
        const result = await fcl.searchCaseLaw(opts);
        searchCases.push({ mode: label, opts, result, fetched: [...fetchCalls] });
    }
    await runSearch({ kind: "ok", body: FEED }, "ok:FEED", { query: "unfair dismissal", court: "eat" });
    await runSearch({ kind: "ok", body: FEED }, "ok:FEED", { query: "unfair dismissal", court: "eat", limit: 1, page: 2, party: "Essop" });
    await runSearch({ kind: "ok", body: FEED_VARIANT }, "ok:FEED_VARIANT", { query: "smith", limit: 100 });
    await runSearch({ kind: "ok", body: FEED_VARIANT }, "ok:FEED_VARIANT", { query: "smith", limit: 0 });
    await runSearch({ kind: "ok", body: EMPTY_FEED }, "ok:EMPTY_FEED", { query: "zzzz no match" });
    await runSearch({ kind: "status", status: 503 }, "status:503", { query: "x" });
    await runSearch({ kind: "status", status: 404 }, "status:404", { query: "x" });
    await runSearch({ kind: "status", status: 429 }, "status:429", { query: "x" });
    await runSearch({ kind: "status", status: 400 }, "status:400", { query: "x" });
    await runSearch({ kind: "status", status: 500 }, "status:500", { query: "x" });
    await runSearch({ kind: "abort" }, "abort", { query: "x" });
    await runSearch({ kind: "reject" }, "reject", { query: "x" });
    write("find-case-law/search.json", { cases: searchCases });

    const verifyCases: Array<{ mode: string; input: unknown; result: unknown; fetched: string[] }> = [];
    async function runVerify(mode: FetchMode, label: string, input: { citation?: string; caseName?: string }) {
        fcl._clearVerifyCache();
        fetchMode = mode;
        fetchCalls.length = 0;
        const result = await fcl.verifyCitation(input);
        verifyCases.push({ mode: label, input, result, fetched: [...fetchCalls] });
    }
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", { citation: "[2017] UKSC 27", caseName: "Essop v Home Office" });
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", { citation: "[2017] UKSC 999", caseName: "Essop v Home Office" });
    await runVerify({ kind: "ok", body: EMPTY_FEED }, "ok:EMPTY_FEED", { citation: "[1801] FAKE 1", caseName: "Madeup v Nobody" });
    await runVerify({ kind: "abort" }, "abort", { citation: "[2017] UKSC 27", caseName: "Essop v Home Office" });
    await runVerify({ kind: "ok", body: FMX_FEED }, "ok:FMX_FEED", { citation: "[2020] UKSC 1", caseName: "FMX Food Merchants v HMRC" });
    await runVerify({ kind: "ok", body: FMX_FEED }, "ok:FMX_FEED", { citation: "Nonexistent v Fabricated Ltd [2020] UKSC 1" });
    await runVerify({ kind: "ok", body: FMX_FEED }, "ok:FMX_FEED", { citation: "[2020] UKSC 1", caseName: "Nonexistent v Fabricated Ltd" });
    await runVerify({ kind: "ok", body: FMX_FEED }, "ok:FMX_FEED", { citation: "[2020] UKSC 1" });
    await runVerify({ kind: "abort" }, "abort", { citation: "Nonexistent v Fabricated Ltd [2020] UKSC 1" });
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", { caseName: "Laffy v Wkcic Group" });
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", { caseName: "Essop v Home Office" });
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", { caseName: "Nobody v Nowhere" });
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", { citation: "Essop & Ors v Home Office [2017] UKSC 27" });
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", {});
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", { citation: "", caseName: "  " });
    await runVerify({ kind: "status", status: 503 }, "status:503", { citation: "[2017] UKSC 27" });
    await runVerify({ kind: "status", status: 404 }, "status:404", { citation: "[2017] UKSC 27" });
    await runVerify({ kind: "ok", body: FEED_VARIANT }, "ok:FEED_VARIANT", { citation: "[2019] EWCA Civ 123", caseName: "Smith & Jones v Acme & Co" });
    await runVerify({ kind: "ok", body: FEED_VARIANT }, "ok:FEED_VARIANT", { citation: "[2019] EWCA Civ 123", caseName: "Wholly Unrelated v Party" });
    await runVerify({ kind: "ok", body: FEED_VARIANT }, "ok:FEED_VARIANT", { caseName: "No Citation Case" });
    await runVerify({ kind: "ok", body: FEED }, "ok:FEED", { citation: "Polkey v AE Dayton Services Ltd [1987] UKHL 8", caseName: "Polkey v AE Dayton Services Ltd" });
    // Cache behaviour: second call with the same key must not re-fetch.
    fcl._clearVerifyCache();
    fetchMode = { kind: "ok", body: FEED };
    fetchCalls.length = 0;
    const first = await fcl.verifyCitation({ citation: "[2017] UKSC 27", caseName: "Essop v Home Office" });
    fetchMode = { kind: "abort" };
    const second = await fcl.verifyCitation({ citation: "[2017] UKSC 27", caseName: "Essop v Home Office" });
    write("find-case-law/verify.json", { cases: verifyCases, cache: { first, second, fetch_calls_total: fetchCalls.length } });

    // Authoritative validation with canned live responses.
    const authCases: Array<{ mode: string; input: unknown; result: unknown; fetched: number }> = [];
    async function runAuth(mode: FetchMode, label: string, input: { citation: string; name?: string }) {
        fcl._clearVerifyCache();
        fetchMode = mode;
        fetchCalls.length = 0;
        const result = await cv.validateCitationAuthoritative(input);
        authCases.push({ mode: label, input, result, fetched: fetchCalls.length });
    }
    await runAuth({ kind: "abort" }, "abort", { citation: "Polkey v AE Dayton Services Ltd [1987] UKHL 8", name: "Polkey v AE Dayton Services Ltd" });
    await runAuth({ kind: "abort" }, "abort", { citation: "Polkey v AE Dayton Services Ltd [1999] UKHL 99", name: "Polkey v AE Dayton Services Ltd" });
    await runAuth({ kind: "abort" }, "abort", { citation: "Some Invented Case [2099] UKSC 999" });
    await runAuth({ kind: "ok", body: FEED }, "ok:FEED", { citation: "Essop v Home Office [2017] UKSC 27", name: "Essop v Home Office" });
    await runAuth({ kind: "ok", body: FEED }, "ok:FEED", { citation: "Essop v Home Office [2017] UKSC 999", name: "Essop v Home Office" });
    await runAuth({ kind: "ok", body: EMPTY_FEED }, "ok:EMPTY_FEED", { citation: "Made Up v Nobody [2099] UKSC 1", name: "Made Up v Nobody" });
    await runAuth({ kind: "ok", body: EMPTY_FEED }, "ok:EMPTY_FEED", { citation: "Polkey v AE Dayton Services Ltd [1999] UKHL 99" });
    await runAuth({ kind: "ok", body: FMX_FEED }, "ok:FMX_FEED", { citation: "Nonexistent v Fabricated Ltd [2020] UKSC 1" });
    await runAuth({ kind: "ok", body: FEED }, "ok:FEED", { citation: "BHS v Burchell [1978]" });
    await runAuth({ kind: "status", status: 503 }, "status:503", { citation: "BHS v Burchell [1978]" });
    await runAuth({ kind: "ok", body: FEED }, "ok:FEED", { citation: "" });
    fcl._clearVerifyCache();
    fetchMode = { kind: "abort" };
    const batchAuth = await cv.validateAllCitationsAuthoritative([
        { citation: "Polkey v AE Dayton Services Ltd [1987] UKHL 8", name: "Polkey v AE Dayton Services Ltd" },
        { citation: "Some Invented Case [2099] UKSC 999" },
        { citation: "BHS v Burchell [1978]" },
    ]);
    write("citations/authoritative.json", { cases: authCases, batch_abort: batchAuth });

    // ── PDF → Markdown ────────────────────────────────────────────────
    const pdfmd = await import("@/services/pdf-to-markdown");
    const pdfCases: Record<string, unknown> = {};
    pdfCases.tidy = ["a\r\n\n\n\nb   \n", "  x  \n\n\n\n\n y\t\n", "", "\r\r\n", "one\n\ntwo\n\n\nthree"].map((input) => ({ input, result: pdfmd.tidyToMarkdown(input) }));
    pdfCases.looks_like_pdf = ["%PDF-1.7", "not a pdf", "%PDF", "%PDF-", ""].map((input) => ({ input, result: pdfmd.looksLikePdf(Buffer.from(input, "latin1")) }));
    pdfCases.allowed_url = [
        "https://caselaw.nationalarchives.gov.uk/eat/2026/90/data.pdf", "https://www.bailii.org/x.pdf", "http://caselaw.nationalarchives.gov.uk/x.pdf", "https://evil.example.com/x.pdf",
        "https://169.254.169.254/latest/meta-data", "not a url", "https://assets.caselaw.nationalarchives.gov.uk/final.pdf", "https://www.legislation.gov.uk/x.pdf", "https://www.gov.uk/big.pdf", "https://WWW.BAILII.ORG/x.pdf", "https://www.bailii.org:443/x.pdf", "https://user:pw@www.bailii.org/x.pdf", "ftp://www.bailii.org/x.pdf", "",
    ].map((input) => ({ input, result: pdfmd.isAllowedPdfUrl(input) }));
    pdfCases.buffer_sample = await pdfmd.pdfBufferToMarkdown(SAMPLE_PDF);
    pdfCases.buffer_empty = await pdfmd.pdfBufferToMarkdown(Buffer.alloc(0));
    pdfCases.buffer_not_pdf = await pdfmd.pdfBufferToMarkdown(Buffer.from("hello"));
    pdfCases.buffer_corrupt = await pdfmd.pdfBufferToMarkdown(Buffer.from("%PDF-1.4 garbage garbage", "latin1"));
    const fetchPdfCases: Array<{ mode: string; url: string; result: unknown; fetched: string[] }> = [];
    async function runFetchPdf(mode: FetchMode, label: string, url: string) {
        fetchMode = mode;
        fetchCalls.length = 0;
        const result = await pdfmd.fetchPdfAsMarkdown(url);
        fetchPdfCases.push({ mode: label, url, result, fetched: [...fetchCalls] });
    }
    await runFetchPdf({ kind: "reject" }, "reject", "https://evil.example.com/x.pdf");
    await runFetchPdf({ kind: "reject" }, "reject", "http://www.bailii.org/x.pdf");
    await runFetchPdf({ kind: "reject" }, "reject", "not a url");
    await runFetchPdf({ kind: "pdf", bytes: SAMPLE_PDF }, "pdf:sample", "https://caselaw.nationalarchives.gov.uk/eat/2026/90/data.pdf");
    await runFetchPdf({ kind: "status", status: 503 }, "status:503", "https://www.legislation.gov.uk/x.pdf");
    await runFetchPdf({ kind: "status", status: 429 }, "status:429", "https://www.legislation.gov.uk/x.pdf");
    await runFetchPdf({ kind: "status", status: 404 }, "status:404", "https://www.legislation.gov.uk/x.pdf");
    await runFetchPdf({ kind: "pdf", bytes: SAMPLE_PDF, contentLength: String(99 * 1024 * 1024) }, "pdf:too-large-header", "https://www.gov.uk/big.pdf");
    await runFetchPdf({ kind: "redirect", location: "https://169.254.169.254/latest/meta-data" }, "redirect:forbidden", "https://www.gov.uk/open-redirect.pdf");
    await runFetchPdf({ kind: "redirect", location: "https://assets.caselaw.nationalarchives.gov.uk/final.pdf", then: { kind: "pdf", bytes: SAMPLE_PDF } }, "redirect:allowed", "https://caselaw.nationalarchives.gov.uk/redirect.pdf");
    await runFetchPdf({ kind: "redirect", location: "/relative/final.pdf", then: { kind: "pdf", bytes: SAMPLE_PDF } }, "redirect:relative", "https://caselaw.nationalarchives.gov.uk/redirect.pdf");
    await runFetchPdf({ kind: "abort" }, "abort", "https://www.bailii.org/x.pdf");
    await runFetchPdf({ kind: "reject" }, "reject", "https://www.bailii.org/x.pdf");
    await runFetchPdf({ kind: "pdf", bytes: Buffer.from("not a pdf at all") }, "pdf:not-pdf", "https://www.bailii.org/x.pdf");
    pdfCases.fetch = fetchPdfCases;
    fetchMode = { kind: "pdf", bytes: SAMPLE_PDF };
    pdfCases.judgment = [
        await fcl.getJudgmentMarkdown("eat/2026/90"),
        await fcl.getJudgmentMarkdown("/eat/2026/90/"),
        await fcl.getJudgmentMarkdown(""),
        await fcl.getJudgmentMarkdown("///"),
    ];
    write("pdf-to-markdown/cases.json", pdfCases);

    // DOCX via mammoth (what /api/triage does).
    const mammoth = appRequire("mammoth") as typeof import("mammoth");
    const docxText = await mammoth.extractRawText({ buffer: SAMPLE_DOCX });
    const pdfParse = appRequire("pdf-parse") as (b: Buffer) => Promise<{ text: string; numpages: number }>;
    write("documents/expected-text.json", {
        pdf_text_raw: (await pdfParse(SAMPLE_PDF)).text,
        pdf_markdown: pdfCases.buffer_sample,
        docx_text: docxText.value,
        docx_messages: docxText.messages,
        txt: readFileSync(join(OUT, "documents/sample.txt"), "utf8"),
    });

    // ── Analyse contract normaliser ───────────────────────────────────
    const ac = await import("@/schemas/analyse-contract");
    const acInputs: unknown[] = [
        {
            claims: [{ type: "unfair_dismissal", strength: "MODERATE", reasoning: "Viable on the facts.", legal_test_elements: [{ element: "Employee status", satisfied: true, evidence: "Not disputed." }, { element: "Fair reason", satisfied: false, evidence: "Fact-dependent." }] }],
            authorities: [{ name: "Polkey", citation: "Polkey [1987] UKHL 8", principle: "Procedure.", trust_level: "VERIFIED" }],
            statutory_provisions: [{ statute: "ERA 1996", section: "s98", relevance: "Fairness." }],
            procedural_notes: ["Three months less one day."],
            era_2025_flags: [{ provision: "Time limit", applies: false, reason: "Pre-commencement.", commencement_date: "Oct 2026", status: "tbc" }],
        },
        {
            claims: [{ claim_type: "harassment", strength: "strong", summary: "Old-shape summary.", elements: [{ element: "Unwanted conduct", met: true, reasoning: "Alleged." }] }],
            authorities: [{ name: "X", citation: "[2020] EAT 1", relevance: "Old field name.", trust: "check" }],
            era_2025_flags: [{ provision: "P", applies: true, reason: "r", commencement_date: "d", status: "awaiting_si" }],
        },
        {}, null, "nonsense", 42, [], { claims: [{ type: "x", strength: "WEAK", reasoning: "r" }] }, { claims: "oops" },
        { claims: [{ type: "x", strength: "wobbly" }], authorities: [{ name: "y", citation: "z", principle: "p" }], era_2025_flags: [{ provision: "q" }] },
        { procedural_notes: ["keep", "", null, "also", 5, true, {}] },
        { authorities: [{ name: "Polkey", citation: "Polkey [1987] UKHL 8", principle: "p", trust_level: "VERIFIED", citation_corrected: true, original_citation: "Polkey [1988] ICR 142", verified: true, validation_reason: "ok", matched_case: "Polkey", matched_citation: "[1987] UKHL 8", source_url: "https://x", verification_source: "verified_db" }] },
        { authorities: ["bare string", 7, null, { matched_case: "MC", citation: 12, principle: null, trust_level: "verified", verified: "yes", citation_corrected: 0 }] },
        { claims: ["bare", { type: 5, strength: null, reasoning: 7, legal_test_elements: ["e", { label: "L", satisfied: "true" }, { name: "N", met: true, reasoning: "" }, { element: "E", satisfied: 1, evidence: 3 }] }] },
        { statutory_provisions: ["s", { statute: 1, section: true, relevance: null }] },
        { era_2025_flags: ["f", { provision: "p", applies: 1, reason: 2, commencementDate: "cd", status: "IN_FORCE" }, { status: "Upcoming" }, { status: "" }] },
    ];
    write("analyse-contract/cases.json", {
        cases: acInputs.map((input) => ({ input: input === undefined ? null : input, result: ac.normaliseAnalyseResponse(input) })),
        strength: ["strong", "MODERATE", undefined, "Weak", "", " strong ", 5].map((v) => ({ input: v ?? null, result: ac.normaliseStrength(v) })),
        trust: ["verified", "", "CHECK", "quarantined", " Verified ", null, 1].map((v) => ({ input: v ?? null, result: ac.normaliseTrustLevel(v) })),
        flag: ["in_force", "upcoming", "awaiting_si", undefined, "TBC", " In_Force ", "x"].map((v) => ({ input: v ?? null, result: ac.normaliseFlagStatus(v) })),
        is_record: [{}, [], null, "s", 1, { a: 1 }].map((v) => ({ input: v, result: ac.isRecord(v) })),
    });

    // ── Agent provider ────────────────────────────────────────────────
    const ap = await import("@/lib/llm/agent-provider");
    const NARRATIVE = "Warehouse employee with ~4 years' service, summarily dismissed on 3 March 2026 for alleged 'gross misconduct' shortly after raising written health and safety concerns. No investigation meeting was held.";
    const messages: Record<string, string> = {
        analyse_ud: "Claim type: unfair_dismissal\nMode: narrative\nSchema: Unfair Dismissal (ERA 1996 s98)\n\nNarrative:\n" + NARRATIVE,
        analyse_harassment: "Claim type: harassment\nMode: narrative\n\nNarrative:\nHostile comments.",
        analyse_unknown_type: "Claim type: made_up_type\nMode: narrative",
        analyse_no_type: "Nothing here",
        analyse_claim_type_underscore: "claim_type: whistleblowing and more",
        analyse_claimtype_nospace: "claimtype: FIRE_AND_REHIRE",
        analyse_zero_hours: "Claim type: zero_hours_rights\nMode: guided_schema",
        analyse_wrongful: "Claim type: wrongful_dismissal",
        triage_smoke: "Current schema state: none\n\nDocument text:\nClaimant: warehouse employee with ~4 years' service. Dismissed 3 March 2026 for alleged gross misconduct shortly after raising written health and safety concerns. No investigation meeting was held. Employer: Acme Logistics Ltd. EDT: 2026-03-03.",
        triage_discrim: "Current schema state: none\n\nDocument text:\nI was subjected to racist comments and harassed; I resigned.",
        triage_none: "Current schema state: none\n\nDocument text:\nNothing relevant at all.",
        triage_narrative: "Narrative:\nI was sacked for whistleblowing\n\nSomething else",
        triage_facts: "Facts:\nMy safety concerns were ignored\n\nNext: x",
        debate_facts: "Claim Type: unfair_dismissal\n\nFacts:\n" + NARRATIVE,
        debate_facts_harassment: "Claim Type: harassment\n\nOriginal Facts:\nx\n\nDrafter Argument:\n{}",
        refine_ok: JSON.stringify({ endpoint: "analyse", prose_fields: { "claims.0.reasoning": "A", "procedural_notes.1": "B" } }),
        refine_empty: JSON.stringify({ endpoint: "analyse" }),
        refine_bad: "not json",
    };
    const endpoints = ["analyse", "analyse_complex", "triage", "drafter", "critic", "judge", "refine", "unknown_endpoint"];
    const apCases: Array<{ endpoint: string; message_key: string; content: string; parsed: unknown }> = [];
    for (const endpoint of endpoints) {
        for (const [key, userMessage] of Object.entries(messages)) {
            const content = ap.generateAgentResponse({ endpoint, system: "sys", userMessage });
            let parsed: unknown = null;
            try { parsed = JSON.parse(content); } catch { parsed = null; }
            apCases.push({ endpoint, message_key: key, content, parsed });
        }
    }
    write("agent-provider/cases.json", {
        AGENT_STAND_IN_MODEL: ap.AGENT_STAND_IN_MODEL,
        messages,
        cases: apCases,
        extract_claim_type: Object.entries(messages).map(([k, m]) => ({ key: k, result: ap.extractClaimType(m) })),
        estimate_tokens: ["", "a", "abcd", "abcde", NARRATIVE, "x".repeat(4000), "x".repeat(4001)].map((t) => ({ len: t.length, result: ap.estimateTokens(t) })),
    });

    // ── Claude client (agent path) ────────────────────────────────────
    const cc = await import("@/lib/claude-client");
    const ccCases: Record<string, unknown> = {};
    ccCases.available_agent = cc.isClientAvailable();
    const r1 = await cc.callClaude({ endpoint: "analyse", system: "sys", userMessage: "claim_type: unfair_dismissal", promptVersion: "v2" });
    ccCases.analyse_agent = r1 ? { ...r1, debug: { ...r1.debug, duration_ms: "<varies>" } } : null;
    const r2 = await cc.callClaude({ endpoint: "critic", system: prompts.CRITIC_PROMPT_v2, userMessage: messages.debate_facts, promptVersion: prompts.PROMPT_VERSIONS.CRITIC });
    ccCases.critic_agent = r2 ? { ...r2, debug: { ...r2.debug, duration_ms: "<varies>" } } : null;
    const r3 = await cc.callClaude({ endpoint: "refine", system: prompts.LEGAL_WRITING_REFINEMENT_PROMPT_v1, userMessage: messages.refine_ok, promptVersion: "v1", configOverride: { max_tokens: 1000, thinking: { type: "enabled", budget_tokens: 5000 } } });
    ccCases.refine_agent_override = r3 ? { ...r3, debug: { ...r3.debug, duration_ms: "<varies>" } } : null;
    process.env.LLM_PROVIDER = "";
    ccCases.available_none = cc.isClientAvailable();
    ccCases.call_none = await cc.callClaude({ endpoint: "analyse", system: "sys", userMessage: "claim_type: unfair_dismissal", promptVersion: "v2" });
    process.env.LLM_PROVIDER = "agent";
    process.env.NODE_ENV = "production";
    try {
        await cc.callClaude({ endpoint: "analyse", system: "sys", userMessage: "x", promptVersion: "v2" });
        ccCases.production_refusal = null;
    } catch (e) {
        ccCases.production_refusal = (e as Error).message;
    }
    delete process.env.NODE_ENV;
    ccCases.truncated_error_message = new cc.ClaudeTruncatedResponseError("Analysis (Sonnet)", 16000).message;
    ccCases.truncated_error_code = new cc.ClaudeTruncatedResponseError("Analysis (Sonnet)", 16000).code;
    write("claude-client/cases.json", ccCases);

    // ── Refinement ────────────────────────────────────────────────────
    const ref = await import("@/services/legal-writing-refinement");
    const refCases: Record<string, unknown> = {};
    refCases.ENDPOINT_PROSE_FIELDS = ref.ENDPOINT_PROSE_FIELDS;
    const analysePayload = JSON.parse(ap.generateAgentResponse({ endpoint: "analyse", system: "", userMessage: messages.analyse_ud }));
    const triagePayload = JSON.parse(ap.generateAgentResponse({ endpoint: "triage", system: "", userMessage: messages.triage_smoke }));
    const debatePayload = {
        mode: "single_pass", rounds_run: 1,
        drafter: JSON.parse(ap.generateAgentResponse({ endpoint: "drafter", system: "", userMessage: messages.debate_facts })),
        critic: JSON.parse(ap.generateAgentResponse({ endpoint: "critic", system: "", userMessage: messages.debate_facts })),
        judge: JSON.parse(ap.generateAgentResponse({ endpoint: "judge", system: "", userMessage: messages.debate_facts })),
        viable: true, usage: { total_input_tokens: 1, total_output_tokens: 1 },
    };
    const partialPayloads = [
        { claims: [{ reasoning: "The claimant has continuous service." }], authorities: [{ principle: "Procedural fairness is required." }], statutory_provisions: [{ relevance: "s98(4)." }], procedural_notes: ["Commence ACAS."], era_2025_flags: [{ reason: "Time-limit regime shifts." }] },
        { claims: [{ reasoning: "" }], procedural_notes: [], era_2025_flags: "nope", authorities: [null, 5, { principle: 7 }] },
        { drafter: { overall_assessment: "Viable." }, critic: { overall_vulnerability_assessment: "Risky." }, judge: { synthesis: "Score 76." } },
        {},
        { claims: "not-an-array" },
        { judge: { score_breakdown: { legal_test_completeness: { reasoning: "r1" }, evidential_sufficiency: { reasoning: "" }, authority_quality: { reasoning: "r5" } }, key_vulnerabilities: ["a", "", "b"] } },
    ];
    refCases.refine = [];
    for (const [endpoint, payload] of [["analyse", analysePayload], ["triage", triagePayload], ["debate", debatePayload], ["analyse", partialPayloads[0]], ["analyse", partialPayloads[1]], ["debate", partialPayloads[2]], ["analyse", partialPayloads[3]], ["analyse", partialPayloads[4]], ["debate", partialPayloads[5]], ["triage", { document_summary: "S", query_array: [{ question: "Q", legal_relevance: "" }, "x"] }]] as const) {
        const r = await ref.refineForUser(endpoint as never, payload);
        (refCases.refine as unknown[]).push({ endpoint, payload, result: r, same_reference: r.payload === payload });
    }
    process.env.REFINEMENT_DISABLED = "1";
    const disabled = await ref.refineForUser("analyse", analysePayload);
    refCases.disabled = { result: disabled, same_reference: disabled.payload === analysePayload };
    delete process.env.REFINEMENT_DISABLED;
    process.env.LLM_PROVIDER = "";
    refCases.no_client = await ref.refineForUser("analyse", analysePayload);
    process.env.LLM_PROVIDER = "agent";
    refCases.get_by_path = [
        [{ document_summary: "before" }, "document_summary"], [{ claims: [{ reasoning: "a" }, { reasoning: "b" }] }, "claims.1.reasoning"], [{ claims: [{ reasoning: "x" }] }, "claims.0.missing"], [{ claims: [{ reasoning: "x" }] }, "claims.5.reasoning"], [{ claims: [{ reasoning: "x" }] }, "absent.path"], [{ claims: [{ reasoning: "x" }] }, "claims.abc.reasoning"], [{ a: null }, "a.b"], ["str", "length"], [{ a: { b: { c: "deep" } } }, "a.b.c"], [[1, 2, 3], "1"],
    ].map(([obj, path]) => ({ obj, path, result: ref.getByPath(obj, path as string) ?? null }));
    refCases.set_by_path = [
        [{ document_summary: "before" }, "document_summary", "after"], [{ claims: [{ reasoning: "a" }, { reasoning: "b" }] }, "claims.1.reasoning", "B"], [{ claims: [{ reasoning: "x" }] }, "claims.5.reasoning", "y"], [{ claims: [{ reasoning: "x" }] }, "absent.path", "y"], [{ claims: [{ reasoning: "x" }] }, "claims.abc.reasoning", "y"], [{ a: null }, "a.b", "y"], [{ a: { b: { c: "deep" } } }, "a.b.c", "D"], [[1, 2, 3], "1", 9], [{ a: 1 }, "a", "one"],
    ].map(([obj, path, value]) => { const clone = structuredClone(obj); const ok = ref.setByPath(clone, path as string, value); return { obj, path, value, ok, after: clone }; });
    write("refinement/cases.json", refCases);

    // ── Rate limit ────────────────────────────────────────────────────
    const rl = await import("@/lib/rate-limit");
    const keyCases = ["1.1.1.1, 2.2.2.2, 3.3.3.3", "9.9.9.9", undefined, " 1.1.1.1 ,  ", ",,,", "a,b"].map((xff) => ({
        xff: xff ?? null,
        result: rl.clientKeyFromRequest(new Request("http://localhost/x", { headers: xff !== undefined ? { "x-forwarded-for": xff } : {} }) as never),
    }));
    const limiter = rl.createRateLimiter({ windowMs: 1000, maxRequests: 3 });
    const seq = ["a", "a", "a", "a", "b", "b", "b", "b", "a"].map((k) => ({ key: k, allowed: limiter.check(k) }));
    write("rate-limit/cases.json", { client_key: keyCases, sequence: seq });

    // ── Debate helpers (UI) ───────────────────────────────────────────
    const dm = await import("@/components/adversarial/debate-modes");
    write("ui/debate-modes.json", {
        DEBATE_MODES: dm.DEBATE_MODES,
        get_mode: ["single_pass", "adversarial", "nonsense"].map((id) => ({ id, result: dm.getDebateMode(id as never).id })),
        describe_rounds: [["single_pass", 1, false], ["adversarial", 2, true], ["adversarial", 3, false], ["adversarial", 1, true], ["adversarial", undefined, false], ["adversarial", 0, true]].map(([m, n, s]) => ({ mode: m, rounds: n ?? null, stopped: s, result: dm.describeRounds(m as never, n as number | undefined, s as boolean) })),
        format_int: [0, 999, 12345, 1000000, -1234, 1.6, NaN, 1e9].map((n) => ({ n: Number.isFinite(n) ? n : null, result: dm.formatInt(n) })),
        format_usage: [{ total_input_tokens: 12345, total_output_tokens: 6789 }, undefined, { total_input_tokens: 0, total_output_tokens: 0 }].map((u) => ({ usage: u ?? null, result: dm.formatUsage(u) })),
        viability: [true, false, null, undefined].map((v) => ({ v: v ?? null, result: dm.viabilityLabel(v) })),
        argument_text: [{ argument: "The dismissal was unfair." }, "Raw fallback text", undefined, { draft: "D" }, { text: "T" }, { content: "C" }, { argument: "  " , draft: "D2" }, 5].map((d) => ({ input: d ?? null, result: dm.getArgumentText(d) })),
        synthesis_text: [{ synthesis: "Marginal." }, undefined, { summary: "S" }, { reasoning: "R" }, "raw"].map((j) => ({ input: j ?? null, result: dm.getSynthesisText(j) })),
        score: [[{ score: 82 }, undefined], [undefined, { score: 71 }], [{ score: null }, { score: NaN }], [undefined, undefined], [{ score: 10 }, { score: 20 }], [{ score: "5" }, { score: 30 }]].map(([r, j]) => ({ round: r ?? null, judge: j ?? null, result: dm.getScore(r as never, j) })),
        partition: [
            [[{ authority: "Polkey v AE Dayton", citation: "[1988] ICR 142", trust_level: "VERIFIED", validation_reason: "Matched." }, { authority: "Made Up v Nobody", citation: "[2099] FAKE 1", trust_level: "QUARANTINED", validation_reason: "No match." }, { authority: "Iceland Frozen Foods", citation: "[1982] IRLR 439", trust_level: "CHECK" }], "authority"],
            [[{ weakness: "No evidence of a hearing", citation: "[2010] ICR 325", trust_level: "CHECK" }], undefined],
            [undefined, undefined], ["not an array", undefined], [[null, 5, {}, { citation: "only cite" }, { detail: "only detail" }, { matched_case: "MC", name: "N", principle: "P", trust_level: "bogus" }], undefined],
            [debatePayload.drafter.legal_framework, "authority"], [debatePayload.critic.attacks, undefined],
        ].map(([items, key]) => ({ items: items ?? null, name_key: key ?? null, result: dm.partitionAuthorities(items, key as string | undefined) })),
    });
    const arp = await import("@/components/analysis/AnalysisResultsPanel");
    write("ui/analysis-results-view.json", {
        cases: [
            analysePayload,
            { ...analysePayload, authorities: [...analysePayload.authorities, { name: "Invented v Nobody", citation: "[2099] UKSC 999", principle: "Fabricated.", trust_level: "QUARANTINED" }], quarantine_summary: { total: 4, verified: 3, check: 0, quarantined: 1 } },
            { ...analysePayload, quarantine_summary: { total: 5, verified: 3, check: 0, quarantined: 2 } },
            { claims: [{ claim_type: "harassment", strength: "strong", summary: "Legacy summary.", elements: [{ element: "Unwanted conduct", met: true }] }], authorities: [], era_2025_flags: [] },
            { claims: [], authorities: [], era_2025_flags: [{ provision: "Zero-hours protections", applies: false, reason: "SI awaited", commencement_date: "2027", status: "awaiting_si" }, { provision: "SSP day one", applies: true, reason: "In force", commencement_date: "2026-04-06", status: "in_force" }] },
            {}, null, { quarantine_summary: { quarantined: "3" } }, { authorities: [{ trust_level: "QUARANTINED" }], quarantine_summary: { quarantined: 0 } },
        ].map((input) => ({ input, result: arp.buildAnalysisResultsView(input) })),
    });

    // ── Routes (hermetic) ─────────────────────────────────────────────
    const routes: Record<string, unknown> = {};

    const schemaRoute = await import("@/app/api/schema/[claimType]/route");
    routes.schema = [];
    for (const ct of [...ALL_CT, "made_up_claim", "", "Unfair_Dismissal"]) {
        const res = await schemaRoute.GET(get(`http://local/api/schema/${ct}`) as never, { params: Promise.resolve({ claimType: ct }) });
        (routes.schema as unknown[]).push({ claim_type: ct, response: await capture(res) });
    }

    const dlRoute = await import("@/app/api/deadlines/route");
    const dlBodies: unknown[] = [
        { claim_types: ["unfair_dismissal"] }, { effective_date_of_termination: "2025-01-15" }, { effective_date_of_termination: "2025-01-15", claim_types: [] },
        { effective_date_of_termination: "2025-06-16", claim_types: ["unfair_dismissal"] }, { date_of_last_act: "2025-06-15", claim_types: ["unfair_dismissal"] },
        { effective_date_of_termination: "2027-03-01", claim_types: ["unfair_dismissal"] }, { effective_date_of_termination: "2025-06-15", claim_types: ["unfair_dismissal"], acas_day_a: "2025-07-01", acas_day_b: "2025-07-22" },
        { effective_date_of_termination: "2028-10-01", claim_types: ["unfair_dismissal"] }, { effective_date_of_termination: "not-a-date", claim_types: ["unfair_dismissal"] },
        { effective_date_of_termination: "2026-02-31", claim_types: ["unfair_dismissal"] }, { effective_date_of_termination: "1850-01-01", claim_types: ["unfair_dismissal"] },
        { effective_date_of_termination: "2101-01-01", claim_types: ["unfair_dismissal"] }, { effective_date_of_termination: "1990-01-01", claim_types: ["unfair_dismissal"] }, { effective_date_of_termination: "2100-12-31", claim_types: ["unfair_dismissal"] },
        { effective_date_of_termination: "2025-01-15", claim_types: ["unfair_dismissal"], acas_day_a: "2025-02-01" }, { effective_date_of_termination: "2025-01-15", claim_types: ["unfair_dismissal"], acas_day_b: "2025-02-01" },
        { effective_date_of_termination: "2025-01-01", claim_types: ["unfair_dismissal"], acas_day_a: "2025-02-15", acas_day_b: "2025-02-01" }, { effective_date_of_termination: "2025-01-01", claim_types: ["unfair_dismissal"], acas_day_a: "2025-13-40", acas_day_b: "2025-02-15" },
        { effective_date_of_termination: "2025-01-01", claim_types: ["unfair_dismissal"], acas_day_a: "2025-02-01", acas_day_b: "2025-02-30" }, { effective_date_of_termination: "2025-01-15", claim_types: ["unfair_dismissal"] },
        { effective_date_of_termination: "", date_of_last_act: "2025-06-15", claim_types: ["unfair_dismissal"] }, { effective_date_of_termination: "2025-06-15", date_of_last_act: "2025-01-01", claim_types: ["unfair_dismissal"] },
        { effective_date_of_termination: 20250101, claim_types: ["unfair_dismissal"] }, { effective_date_of_termination: "2025-01-15", claim_types: "unfair_dismissal" }, { effective_date_of_termination: "2025-01-15", claim_types: ALL_CT },
        { effective_date_of_termination: "2025-01-15", claim_types: ["unfair_dismissal"], acas_day_a: "", acas_day_b: "" }, { effective_date_of_termination: "2025-01-15", claim_types: ["unfair_dismissal"], acas_day_a: null, acas_day_b: null },
        { effective_date_of_termination: "2025-01-01", claim_types: ["unfair_dismissal"], acas_day_a: "2025-02-01", acas_day_b: "2025-02-01" },
    ];
    routes.deadlines = [];
    for (const body of dlBodies) (routes.deadlines as unknown[]).push({ body, response: await capture(await dlRoute.POST(postJson("http://local/api/deadlines", body) as never)) });
    (routes.deadlines as unknown[]).push({ raw_body: "{not json", response: await (async () => { const r = await capture(await dlRoute.POST(postRaw("http://local/api/deadlines", "{not json", { "content-type": "application/json" }) as never)); return { status: r.status, body: { ...(r.body as object), request_id: "<uuid>" } }; })() });

    const trackerRoute = await import("@/app/api/era-2025/tracker/route");
    routes.tracker = await capture(await trackerRoute.GET());

    const roadmapGet = await import("@/app/api/roadmap/[caseId]/route");
    routes.roadmap_case = await capture(await roadmapGet.GET(get("http://local/api/roadmap/case-123"), { params: Promise.resolve({ caseId: "case-123" }) }));
    const roadmapPost = await import("@/app/api/roadmap/route");
    routes.roadmap_post = [];
    for (const body of [{ claimType: "unfair_dismissal" }, { dateOfLastAct: "2025-06-16", claimType: "unfair_dismissal" }, { dateOfLastAct: "2025-06-16" }, { dateOfLastAct: "not-a-date", claimType: "unfair_dismissal" }, { dateOfLastAct: "2026-02-31" }, { dateOfLastAct: "2099-01-01", claimType: "harassment" }, { dateOfLastAct: "2027-03-01" }, { dateOfLastAct: TODAY }, { dateOfLastAct: "" }, { dateOfLastAct: "2025-06-16T00:00:00.000Z" }]) {
        (routes.roadmap_post as unknown[]).push({ body, response: await capture(await roadmapPost.POST(postJson("http://local/api/roadmap", body) as never)) });
    }
    (routes.roadmap_post as unknown[]).push({ raw_body: "{ not valid json", response: await (async () => { const r = await capture(await roadmapPost.POST(postRaw("http://local/api/roadmap", "{ not valid json", { "content-type": "application/json" }) as never)); return { status: r.status, body: { ...(r.body as object), request_id: "<uuid>" } }; })() });

    const clsRoute = await import("@/app/api/case-law/search/route");
    routes.case_law_search = [];
    for (const qs of ["", "?q=Polkey", "?q=burchell", "?q=polkey", "?claim_type=whistleblowing", "?claim_type=fire_and_rehire", "?q=dismissal&tier=binding", "?claim_type=unfair_dismissal", "?claim_type=unfair_dismissal&limit=abc", "?claim_type=unfair_dismissal&limit=0", "?claim_type=unfair_dismissal&limit=999", "?claim_type=unfair_dismissal&limit=-5", "?q=dismissal", "?q=DISMISSAL&limit=3", "?q=era%202025", "?q=x&claim_type=zero_hours_rights", "?q=%20%20", "?tier=statutory&q=act", "?q=harassment&claim_type=harassment&tier=binding", "?q=s.98", "?q=%5B2021%5D", "?q=a", "?claim_type=redundancy&limit=1.9", "?claim_type=unfair_dismissal&limit=2abc", "?q=unfair%20dismissal&claim_type=constructive_dismissal"]) {
        (routes.case_law_search as unknown[]).push({ query: qs, response: await capture(await clsRoute.GET(get(`http://local/api/case-law/search${qs}`) as never)) });
    }

    const findRoute = await import("@/app/api/case-law/find/route");
    routes.case_law_find = [];
    for (const [qs, mode] of [["", { kind: "reject" }], ["?q=unfair%20dismissal&court=eat", { kind: "ok", body: FEED }], ["?q=x", { kind: "status", status: 503 }], ["?query=smith&limit=1", { kind: "ok", body: FEED_VARIANT }], ["?q=x&limit=999", { kind: "ok", body: EMPTY_FEED }], ["?q=%20&court=%20", { kind: "reject" }], ["?q=x&limit=abc", { kind: "abort" }]] as const) {
        fetchMode = mode as FetchMode;
        fetchCalls.length = 0;
        (routes.case_law_find as unknown[]).push({ query: qs, mode: mode.kind, response: await capture(await findRoute.GET(get(`http://local/api/case-law/find${qs}`) as never)), fetched: [...fetchCalls] });
    }

    const judgmentRoute = await import("@/app/api/case-law/judgment/route");
    routes.case_law_judgment = [];
    for (const [qs, mode] of [["", { kind: "reject" }], ["?slug=eat/2026/90", { kind: "pdf", bytes: SAMPLE_PDF }], ["?slug=%2Feat%2F2026%2F90%2F", { kind: "pdf", bytes: SAMPLE_PDF }], ["?slug=eat/2026/90", { kind: "status", status: 503 }], ["?slug=%20", { kind: "reject" }]] as const) {
        fetchMode = mode as FetchMode;
        fetchCalls.length = 0;
        (routes.case_law_judgment as unknown[]).push({ query: qs, mode: mode.kind, response: await capture(await judgmentRoute.GET(get(`http://local/api/case-law/judgment${qs}`) as never)), fetched: [...fetchCalls] });
    }

    // request-access: DATA_DIR is process.cwd()/data at import time → sandbox it.
    const raTmp = mkdtempSync(join(tmpdir(), "th-fixtures-ra-"));
    const origCwd = process.cwd;
    process.cwd = () => raTmp;
    const raRoute = await import("@/app/api/request-access/route");
    process.cwd = origCwd;
    routes.request_access = [];
    const raLog: unknown[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { raLog.push(a); };
    for (const body of [{ name: "John" }, { email: "a@b.com", user_type: "lip" }, { name: "Ada", user_type: "lip" }, { name: "Ada", email: "a@b.com" }, { name: "John", email: "notanemail", user_type: "lip" }, { name: "John", email: "john@example.com", user_type: "invalid_type" }, { name: "John", email: "john@example.com", user_type: "lip" }, { name: "Ada Lovelace", email: "ada@example.com", user_type: "lip", description: "Interested in the LiP tooling." }, { name: "L", email: "l@x.io", user_type: "legal_aid", description: "d".repeat(600) }, { name: "", email: "a@b.com", user_type: "lip" }, { name: "N", email: "a@b", user_type: "lip" }, { name: "N", email: "a b@c.com", user_type: "lip" }, { name: "N", email: "a@b.c", user_type: "solicitor" }, { name: "N", email: "a@b.com", user_type: "researcher", description: null }, { name: "N", email: "a@b.com", user_type: "other", description: 5 }, { name: 0, email: "a@b.com", user_type: "lip" }]) {
        const r = await capture(await raRoute.POST(postJson("http://local/api/request-access", body) as never));
        (routes.request_access as unknown[]).push({ body, response: r });
    }
    const badRa = await capture(await raRoute.POST(postRaw("http://local/api/request-access", "{ bad json", { "content-type": "application/json" }) as never));
    (routes.request_access as unknown[]).push({ raw_body: "{ bad json", response: badRa });
    console.log = origLog;
    let persisted: string[] = [];
    try { persisted = readFileSync(join(raTmp, "data", "access-requests.jsonl"), "utf8").trim().split("\n"); } catch { persisted = []; }
    routes.request_access_persisted = persisted.map((l) => ({ ...JSON.parse(l), timestamp: "<iso-timestamp>" }));
    routes.request_access_logs = raLog;

    const webhookRoute = await import("@/app/api/webhook/route");
    const SECRET = "test-webhook-secret-123";
    const sign = (raw: string, secret: string, ts: string) => "sha256=" + createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
    const nowSec = Math.floor(Date.now() / 1000);
    const ts = String(nowSec);
    routes.webhook = [];
    const whCases: Array<{ label: string; secret_env?: string; raw: string; sig?: string; ts?: string }> = [
        { label: "no-secret", raw: JSON.stringify({ event: "test" }), sig: sign(JSON.stringify({ event: "test" }), SECRET, ts), ts },
        { label: "missing-sig", secret_env: SECRET, raw: JSON.stringify({ event: "test" }), ts },
        { label: "bad-sig", secret_env: SECRET, raw: JSON.stringify({ event: "test" }), sig: "sha256=deadbeef", ts },
        { label: "wrong-secret", secret_env: SECRET, raw: JSON.stringify({ event: "test" }), sig: sign(JSON.stringify({ event: "test" }), "wrong-secret", ts), ts },
        { label: "ok", secret_env: SECRET, raw: JSON.stringify({ event: "et1_filed", caseId: "abc" }), sig: sign(JSON.stringify({ event: "et1_filed", caseId: "abc" }), SECRET, ts), ts },
        { label: "ok-not-json", secret_env: SECRET, raw: "not-json-at-all", sig: sign("not-json-at-all", SECRET, ts), ts },
        { label: "stale", secret_env: SECRET, raw: JSON.stringify({ event: "et1_filed" }), sig: sign(JSON.stringify({ event: "et1_filed" }), SECRET, String(nowSec - 600)), ts: String(nowSec - 600) },
        { label: "future", secret_env: SECRET, raw: JSON.stringify({ event: "x" }), sig: sign(JSON.stringify({ event: "x" }), SECRET, String(nowSec + 600)), ts: String(nowSec + 600) },
        { label: "edge-299", secret_env: SECRET, raw: "{}", sig: sign("{}", SECRET, String(nowSec - 299)), ts: String(nowSec - 299) },
        { label: "edge-300", secret_env: SECRET, raw: "{}", sig: sign("{}", SECRET, String(nowSec - 300)), ts: String(nowSec - 300) },
        { label: "edge-301", secret_env: SECRET, raw: "{}", sig: sign("{}", SECRET, String(nowSec - 301)), ts: String(nowSec - 301) },
        { label: "missing-ts", secret_env: SECRET, raw: JSON.stringify({ event: "test" }), sig: sign(JSON.stringify({ event: "test" }), SECRET, ts) },
        { label: "malformed-ts", secret_env: SECRET, raw: "{}", sig: sign("{}", SECRET, "abc"), ts: "abc" },
        { label: "tamper-ts", secret_env: SECRET, raw: JSON.stringify({ event: "test" }), sig: sign(JSON.stringify({ event: "test" }), SECRET, String(nowSec - 600)), ts },
        { label: "sig-length-mismatch", secret_env: SECRET, raw: "{}", sig: "sha256=ab", ts },
        { label: "ok-array-body", secret_env: SECRET, raw: "[1,2]", sig: sign("[1,2]", SECRET, ts), ts },
    ];
    for (const c of whCases) {
        if (c.secret_env) process.env.WEBHOOK_SECRET = c.secret_env; else delete process.env.WEBHOOK_SECRET;
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (c.sig !== undefined) headers["x-webhook-signature"] = c.sig;
        if (c.ts !== undefined) headers["x-webhook-timestamp"] = c.ts;
        const r = await capture(await webhookRoute.POST(postRaw("http://local/api/webhook", c.raw, headers) as never));
        (routes.webhook as unknown[]).push({ ...c, now_seconds: nowSec, response: r });
    }
    delete process.env.WEBHOOK_SECRET;

    // analyse — degraded (no client) and agent-mode for every claim type + 400s.
    const analyseRoute = await import("@/app/api/analyse/route");
    let ip = 0;
    const analyseReq = (body: unknown) => postJson("http://local/api/analyse", body, { "x-forwarded-for": `10.0.0.${++ip}` });
    routes.analyse_400 = [];
    for (const body of [{ narrative_text: "I was dismissed" }, { claim_type: "made_up_claim" }, { claim_type: "unfair_dismissal", narrative_text: "I was dismissed" }, { claim_type: "unfair_dismissal", narrative_text: "x".repeat(60), consent: false }, { claim_type: "unfair_dismissal", narrative_text: "x".repeat(60), consent: "true" }, { claim_type: "unfair_dismissal", narrative_text: "x".repeat(50001), consent: true }, { claim_type: "unfair_dismissal", mode: "narrative", narrative_text: "too short", consent: true }, { claim_type: "unfair_dismissal", mode: "narrative", narrative_text: "     " + "x".repeat(49) + "     ", consent: true }, { claim_type: "unfair_dismissal", mode: "narrative", consent: true }, { claim_type: "" }]) {
        (routes.analyse_400 as unknown[]).push({ body, response: await capture(await analyseRoute.POST(analyseReq(body) as never)) });
    }
    process.env.LLM_PROVIDER = "";
    routes.analyse_degraded = [];
    for (const ct of ALL_CT) {
        const body = { claim_type: ct, narrative_text: NARRATIVE, consent: true, mode: "narrative" };
        (routes.analyse_degraded as unknown[]).push({ body, response: await capture(await analyseRoute.POST(analyseReq(body) as never)) });
    }
    (routes.analyse_degraded as unknown[]).push({ body: { claim_type: "unfair_dismissal", narrative_text: "I was dismissed", consent: true }, response: await capture(await analyseRoute.POST(analyseReq({ claim_type: "unfair_dismissal", narrative_text: "I was dismissed", consent: true }) as never)) });
    process.env.LLM_PROVIDER = "agent";
    routes.analyse_agent = [];
    for (const ct of ALL_CT) {
        const body = { claim_type: ct, mode: "narrative", narrative_text: NARRATIVE, consent: true };
        (routes.analyse_agent as unknown[]).push({ body, response: await capture(await analyseRoute.POST(analyseReq(body) as never)) });
    }
    for (const body of [
        { claim_type: "unfair_dismissal", mode: "guided_schema", narrative_text: "", consent: true, schema_fields: { employee_status: "employee", start_date: "2022-01-10" }, key_dates: { edt: "2026-03-03" } },
        { claim_type: "harassment", mode: "narrative", narrative_text: NARRATIVE, consent: true, complexity: "high" },
        { claim_type: "unfair_dismissal", mode: "narrative", narrative_text: NARRATIVE, consent: true, key_dates: {}, schema_fields: {} },
    ]) {
        (routes.analyse_agent as unknown[]).push({ body, response: await capture(await analyseRoute.POST(analyseReq(body) as never)) });
    }
    // Rate-limit: 11th call from the same key → 429.
    const rlKey = { "x-forwarded-for": "203.0.113.7, 198.51.100.1" };
    let last: { status: number; body: unknown } | null = null;
    for (let i = 0; i < 11; i++) last = await capture(await analyseRoute.POST(postJson("http://local/api/analyse", { claim_type: "unfair_dismissal" }, rlKey) as never));
    routes.analyse_rate_limited_11th = last;
    routes.analyse_bad_json = await (async () => { const r = await capture(await analyseRoute.POST(postRaw("http://local/api/analyse", "{bad", { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }) as never)); return { status: r.status, body: { ...(r.body as object), request_id: "<uuid>" } }; })();

    // triage
    const triageRoute = await import("@/app/api/triage/route");
    const triageReq = (fd: FormData) => new Request("http://local/api/triage", { method: "POST", body: fd });
    routes.triage = [];
    const txt = readFileSync(join(OUT, "documents/sample.txt"), "utf8");
    const mk = (name: string, content: string | Buffer, type: string) => { const fd = new FormData(); fd.append("document", new File([content], name, { type })); return fd; };
    (routes.triage as unknown[]).push({ label: "no-document", response: await capture(await triageRoute.POST(triageReq(new FormData()) as never)) });
    { const fd = new FormData(); fd.append("document", "I am a string, not a file"); (routes.triage as unknown[]).push({ label: "string-document", response: await capture(await triageRoute.POST(triageReq(fd) as never)) }); }
    (routes.triage as unknown[]).push({ label: "oversize", response: await capture(await triageRoute.POST(triageReq(mk("big.txt", "a".repeat(10 * 1024 * 1024 + 1), "text/plain")) as never)) });
    (routes.triage as unknown[]).push({ label: "unsupported-ext", response: await capture(await triageRoute.POST(triageReq(mk("evidence.exe", "binary-ish content", "application/octet-stream")) as never)) });
    (routes.triage as unknown[]).push({ label: "uppercase-ext-agent", response: await capture(await triageRoute.POST(triageReq(mk("NOTES.TXT", txt, "text/plain")) as never)) });
    (routes.triage as unknown[]).push({ label: "txt-agent", response: await capture(await triageRoute.POST(triageReq(mk("sample.txt", txt, "text/plain")) as never)) });
    (routes.triage as unknown[]).push({ label: "pdf-agent", response: await capture(await triageRoute.POST(triageReq(mk("sample.pdf", SAMPLE_PDF, "application/pdf")) as never)) });
    (routes.triage as unknown[]).push({ label: "docx-agent", response: await capture(await triageRoute.POST(triageReq(mk("sample.docx", SAMPLE_DOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")) as never)) });
    (routes.triage as unknown[]).push({ label: "pdf-corrupt", response: await capture(await triageRoute.POST(triageReq(mk("bad.pdf", "%PDF-1.4 garbage", "application/pdf")) as never)) });
    (routes.triage as unknown[]).push({ label: "docx-corrupt", response: await capture(await triageRoute.POST(triageReq(mk("bad.docx", "PK garbage", "application/octet-stream")) as never)) });
    { const fd = mk("sample.txt", txt, "text/plain"); fd.append("schema_state", '{"claim_type":"unfair_dismissal"}'); (routes.triage as unknown[]).push({ label: "txt-agent-with-schema-state", response: await capture(await triageRoute.POST(triageReq(fd) as never)) }); }
    (routes.triage as unknown[]).push({ label: "txt-agent-long", response: await capture(await triageRoute.POST(triageReq(mk("long.txt", txt.repeat(80), "text/plain")) as never)) });
    process.env.LLM_PROVIDER = "";
    (routes.triage as unknown[]).push({ label: "txt-degraded", response: await capture(await triageRoute.POST(triageReq(mk("narrative.txt", "I was dismissed on 14 January 2025 without any disciplinary process.", "text/plain")) as never)) });
    (routes.triage as unknown[]).push({ label: "txt-degraded-long", response: await capture(await triageRoute.POST(triageReq(mk("long.txt", txt.repeat(80), "text/plain")) as never)) });
    (routes.triage as unknown[]).push({ label: "pdf-degraded", response: await capture(await triageRoute.POST(triageReq(mk("sample.pdf", SAMPLE_PDF, "application/pdf")) as never)) });
    (routes.triage as unknown[]).push({ label: "docx-degraded", response: await capture(await triageRoute.POST(triageReq(mk("sample.docx", SAMPLE_DOCX, "application/octet-stream")) as never)) });
    process.env.LLM_PROVIDER = "agent";

    // debate
    const debateRoute = await import("@/app/api/debate/route");
    const debateReq = (body: unknown) => postJson("http://local/api/debate", body, { "x-forwarded-for": `10.1.0.${++ip}` });
    routes.debate = [];
    for (const body of [{ claim_type: "unfair_dismissal" }, { facts: "I was dismissed without process" }, {}, { facts: "x".repeat(50001), claim_type: "unfair_dismissal" }, { facts: "dismissed unfairly", claim_type: "unfair_dismissal", mode: "iterate_forever" }, { facts: "", claim_type: "unfair_dismissal" }, { facts: NARRATIVE, claim_type: "" }]) {
        (routes.debate as unknown[]).push({ body, response: await capture(await debateRoute.POST(debateReq(body) as never)) });
    }
    process.env.LLM_PROVIDER = "";
    (routes.debate as unknown[]).push({ body: { facts: "I was dismissed without process", claim_type: "unfair_dismissal" }, no_client: true, response: await capture(await debateRoute.POST(debateReq({ facts: "I was dismissed without process", claim_type: "unfair_dismissal" }) as never)) });
    process.env.LLM_PROVIDER = "agent";
    for (const body of [{ facts: NARRATIVE, claim_type: "unfair_dismissal" }, { facts: NARRATIVE, claim_type: "unfair_dismissal", mode: "single_pass" }, { facts: NARRATIVE, claim_type: "harassment", mode: "adversarial" }, { facts: "x".repeat(50000), claim_type: "unfair_dismissal" }, { facts: 12345, claim_type: "whistleblowing" }, { facts: NARRATIVE, claim_type: "zero_hours_rights", mode: "adversarial" }]) {
        (routes.debate as unknown[]).push({ body, response: await capture(await debateRoute.POST(debateReq(body) as never)) });
    }
    routes.debate_bad_json = await (async () => { const r = await capture(await debateRoute.POST(postRaw("http://local/api/debate", "{bad", { "content-type": "application/json", "x-forwarded-for": "10.9.9.8" }) as never)); return { status: r.status, body: { ...(r.body as object), request_id: "<uuid>" } }; })();

    write("routes/responses.json", { generated_today: TODAY, routes });

    // sitemap + robots
    const sitemap = await import("@/app/sitemap");
    write("ui/sitemap.json", sitemap.default().map((e) => ({ ...e, lastModified: "<now>" })));
    write("ui/robots.txt.json", { robots: readFileSync(join(HERE, "..", "..", "..", "tribunal-harness", "public", "robots.txt"), "utf8") });

    // Copy the smoke report produced by `npm run smoke` if present (golden).
    try {
        const smoke = readFileSync(join(HERE, "..", "..", "..", "tribunal-harness", "smoke-report.json"), "utf8");
        writeRaw("smoke/ts-smoke-report.json", smoke);
        const smokeMd = readFileSync(join(HERE, "..", "..", "..", "tribunal-harness", "smoke-report.md"), "utf8");
        writeRaw("smoke/ts-smoke-report.md", smokeMd);
    } catch {
        console.warn("[fixtures] smoke-report.json not found — run `npm run smoke` first");
    }

    console.log("[fixtures] done");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
