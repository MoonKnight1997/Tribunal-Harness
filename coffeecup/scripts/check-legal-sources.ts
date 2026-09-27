/**
 * Stale-source check for the legal source registry and the source-to-rule register.
 *
 *   npm run legal:check-sources            # check; exit 1 on change/staleness/unreachable
 *   npm run legal:check-sources -- --update  # also record hashes for sources fetched successfully
 *
 * For every registry source URL and every register verification/commencement
 * URL it performs a HEAD then GET, reports HTTP status, Last-Modified and a
 * SHA-256 of the body, compares the hash with legal-corpus/source-hashes.json,
 * and lists entries whose lastVerifiedAt is older than LEGAL_SOURCE_MAX_AGE_DAYS
 * (default 90). It exits non-zero when any content changed, any source is stale
 * or unreachable, or any register entry rests on an unfetched verification.
 *
 * It never edits the registry or register: a change report is a prompt for a
 * human review and a reviewed code change (docs/LEGAL_SOURCE_GOVERNANCE.md).
 * It records a hash ONLY for a URL it fetched successfully in this run, so no
 * review date can be claimed for anything that was not actually read.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { LEGAL_SOURCES } from "../src/legal/sources/registry";
import { LEGAL_RULE_REGISTER } from "../src/legal/rules/register";

interface StoredHash {
    sha256: string;
    fetchedAt: string;
    lastModified: string | null;
    status: number;
}
interface HashFile {
    /** ISO datetime of the last run that wrote this file. */
    updatedAt: string | null;
    note: string;
    sources: Record<string, StoredHash>;
}

const HASH_PATH = resolve(process.cwd(), "legal-corpus/source-hashes.json");
const MAX_AGE_DAYS = Number(process.env.LEGAL_SOURCE_MAX_AGE_DAYS ?? "90");
const TIMEOUT_MS = Number(process.env.LEGAL_SOURCE_FETCH_TIMEOUT_MS ?? "20000");
const UPDATE = process.argv.includes("--update");
const UA = "coffeecup-legal-source-check/1.0 (+docs/LEGAL_SOURCE_GOVERNANCE.md)";

function loadHashes(): HashFile {
    if (!existsSync(HASH_PATH)) return { updatedAt: null, note: "No successful fetch recorded yet.", sources: {} };
    return JSON.parse(readFileSync(HASH_PATH, "utf8")) as HashFile;
}

async function fetchWithTimeout(url: string, method: "HEAD" | "GET"): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { method, redirect: "follow", signal: ctrl.signal, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml,text/plain" } });
    } finally {
        clearTimeout(t);
    }
}

interface Probe {
    url: string;
    ok: boolean;
    status: number | null;
    lastModified: string | null;
    sha256: string | null;
    error: string | null;
}

async function probe(url: string): Promise<Probe> {
    try {
        let head: Response | null = null;
        try {
            head = await fetchWithTimeout(url, "HEAD");
        } catch {
            head = null;
        }
        const res = await fetchWithTimeout(url, "GET");
        const body = new Uint8Array(await res.arrayBuffer());
        const sha256 = createHash("sha256").update(body).digest("hex");
        return {
            url,
            ok: res.ok,
            status: res.status,
            lastModified: res.headers.get("last-modified") ?? head?.headers.get("last-modified") ?? null,
            sha256: res.ok ? sha256 : null,
            error: res.ok ? null : `HTTP ${res.status}`,
        };
    } catch (err) {
        return { url, ok: false, status: null, lastModified: null, sha256: null, error: err instanceof Error ? err.message : String(err) };
    }
}

function daysSince(iso: string, now: Date): number {
    return Math.floor((now.getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000);
}

async function main(): Promise<number> {
    const now = new Date();
    const nowIso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    const stored = loadHashes();
    const problems: string[] = [];
    const urls = new Map<string, string[]>(); // url -> labels

    for (const s of LEGAL_SOURCES) {
        urls.set(s.url, [...(urls.get(s.url) ?? []), `source:${s.key}`]);
        if (s.lastVerifiedAt === null) {
            problems.push(`STALE   source ${s.key}: never verified (verification=${s.verification.method})`);
        } else if (daysSince(s.lastVerifiedAt, now) > MAX_AGE_DAYS) {
            problems.push(`STALE   source ${s.key}: lastVerifiedAt ${s.lastVerifiedAt} is older than ${MAX_AGE_DAYS} days`);
        }
    }
    for (const e of LEGAL_RULE_REGISTER) {
        urls.set(e.verification.url, [...(urls.get(e.verification.url) ?? []), `rule:${e.ruleId}`]);
        if (e.commencementInstrument) urls.set(e.commencementInstrument.url, [...(urls.get(e.commencementInstrument.url) ?? []), `rule:${e.ruleId}:commencement`]);
        if (e.verification.method !== "fetched") {
            problems.push(`UNREAD  rule ${e.ruleId}: verification.method=${e.verification.method} (status ${e.status})`);
        }
        if (daysSince(e.verification.retrievedAt.slice(0, 10), now) > MAX_AGE_DAYS) {
            problems.push(`STALE   rule ${e.ruleId}: verification attempt ${e.verification.retrievedAt} is older than ${MAX_AGE_DAYS} days`);
        }
    }

    console.log(`[legal:check-sources] ${urls.size} URLs, max age ${MAX_AGE_DAYS} days, ${nowIso}`);
    const next: HashFile = { updatedAt: stored.updatedAt, note: stored.note, sources: { ...stored.sources } };
    let fetchedOk = 0;

    for (const [url, labels] of urls) {
        const p = await probe(url);
        const prev = stored.sources[url];
        let verdict: string;
        if (!p.ok) {
            verdict = `UNREACHABLE ${p.error}`;
            problems.push(`UNREACH ${url} (${labels.join(", ")}): ${p.error}`);
        } else if (prev && prev.sha256 !== p.sha256) {
            verdict = `CHANGED (was ${prev.sha256.slice(0, 12)} @ ${prev.fetchedAt}, now ${p.sha256!.slice(0, 12)})`;
            problems.push(`CHANGED ${url} (${labels.join(", ")}): content hash differs from ${prev.fetchedAt}`);
        } else if (!prev) {
            verdict = `NEW ${p.sha256!.slice(0, 12)}${UPDATE ? " (recorded)" : " (not recorded; run with --update)"}`;
        } else {
            verdict = `unchanged ${p.sha256!.slice(0, 12)}`;
        }
        if (p.ok) {
            fetchedOk += 1;
            if (UPDATE) next.sources[url] = { sha256: p.sha256!, fetchedAt: nowIso, lastModified: p.lastModified, status: p.status! };
        }
        console.log(`  ${String(p.status ?? "---").padEnd(4)} ${verdict.padEnd(60)} ${url}\n       ${labels.join(", ")}${p.lastModified ? `  last-modified: ${p.lastModified}` : ""}`);
    }

    if (UPDATE && fetchedOk > 0) {
        next.updatedAt = nowIso;
        next.note = `Hashes recorded only for URLs fetched successfully (${fetchedOk}/${urls.size}) in the run at ${nowIso}.`;
        writeFileSync(HASH_PATH, `${JSON.stringify(next, null, 2)}\n`);
        console.log(`[legal:check-sources] wrote ${HASH_PATH}`);
    }

    if (problems.length > 0) {
        console.log(`\n[legal:check-sources] ${problems.length} problem(s):`);
        for (const p of problems) console.log(`  - ${p}`);
        console.log("\nA CHANGED or STALE entry needs a human to re-read the source and update the registry/register in a reviewed change. UNREAD/UNREACH means no review date may be claimed for that entry.");
        return 1;
    }
    console.log("[legal:check-sources] all sources fetched, unchanged and within the review window.");
    return 0;
}

main().then(
    (code) => process.exit(code),
    (err) => {
        console.error("[legal:check-sources] failed", err);
        process.exit(2);
    },
);
