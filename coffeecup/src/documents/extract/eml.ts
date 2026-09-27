/**
 * Email (.eml) reader — RFC 5322 headers + MIME bodies, no dependencies.
 *
 * Why this exists: the previous parser split on "\n\n", so a normal CRLF
 * email lost its entire body while the headers survived and extraction
 * looked successful. This reader:
 *
 *   - accepts CRLF and LF line endings;
 *   - unfolds folded headers and decodes RFC 2047 encoded-words;
 *   - decodes quoted-printable and base64 transfer encodings;
 *   - decodes utf-8, iso-8859-1 and windows-1252 (and anything else Node's
 *     TextDecoder knows) — an unknown charset makes the part unreadable;
 *   - walks multipart/mixed, /alternative, /related and nested boundaries,
 *     preferring text/plain and falling back to text/html stripped to text;
 *   - inventories attachments (filename, content type, size) without reading
 *     them, and includes forwarded message/rfc822 parts as text.
 *
 * The result is never a silent success: if a body part exists that could not
 * be decoded, status is "partial"; if nothing body-like is present at all and
 * the headers do not look like an email, status is "failed".
 */

import { tidyToMarkdown } from "./pdf";

export interface EmlHeaders {
    from: string | null;
    to: string | null;
    cc: string | null;
    date: string | null;
    subject: string | null;
}

export interface EmlPartReport {
    /** "body" | "alternative" | "attachment" | "forwarded" | "container" | "unknown" */
    kind: string;
    contentType: string;
    read: boolean;
    note?: string;
}

export interface EmlAttachment {
    filename: string | null;
    contentType: string;
    sizeBytes: number | null;
}

export interface EmlResult {
    text: string;
    headers: EmlHeaders;
    parts: EmlPartReport[];
    attachments: EmlAttachment[];
    status: "completed" | "partial" | "failed";
    note?: string;
}

// ---------------------------------------------------------------------------
// Low-level pieces
// ---------------------------------------------------------------------------

interface RawMessage {
    headers: Map<string, string[]>;
    /** Body as a latin1 ("binary") string: one char per byte. */
    body: string;
}

/** Split raw bytes (as a latin1 string) into headers and body at the first blank line. */
function splitHeadersAndBody(raw: string): { headerBlock: string; body: string } {
    const m = /\r?\n\r?\n/.exec(raw);
    if (!m) {
        // No blank line: either headers-only or body-only. Treat as headers if the first line looks like one.
        return /^[!-9;-~]+:/.test(raw) ? { headerBlock: raw, body: "" } : { headerBlock: "", body: raw };
    }
    return { headerBlock: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

/** Unfold and parse a header block into a case-insensitive multimap. */
export function parseHeaderBlock(block: string): Map<string, string[]> {
    const headers = new Map<string, string[]>();
    const lines = block.split(/\r?\n/);
    const unfolded: string[] = [];
    for (const line of lines) {
        if (line === "") continue;
        if (/^[ \t]/.test(line) && unfolded.length > 0) {
            unfolded[unfolded.length - 1] += ` ${line.trim()}`;
        } else {
            unfolded.push(line);
        }
    }
    for (const line of unfolded) {
        const idx = line.indexOf(":");
        if (idx <= 0) continue;
        const name = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        const list = headers.get(name) ?? [];
        list.push(value);
        headers.set(name, list);
    }
    return headers;
}

function header(h: Map<string, string[]>, name: string): string | null {
    const v = h.get(name.toLowerCase());
    return v && v.length > 0 ? v[0] : null;
}

/** Decode bytes in a named charset. Returns null for unknown charsets. */
export function decodeCharset(bytes: Uint8Array, charset: string | null | undefined): string | null {
    const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^["']|["']$/g, "") || "utf-8";
    const aliases: Record<string, string> = { "us-ascii": "utf-8", ascii: "utf-8", "utf8": "utf-8", latin1: "iso-8859-1", "cp1252": "windows-1252", "ansi": "windows-1252" };
    const name = aliases[label] ?? label;
    try {
        return new TextDecoder(name, { fatal: false }).decode(bytes);
    } catch {
        return null;
    }
}

/** Quoted-printable → bytes (RFC 2045 §6.7). Soft line breaks are removed. */
export function decodeQuotedPrintable(s: string, underscoreIsSpace = false): Uint8Array {
    const out: number[] = [];
    const src = s.replace(/=\r?\n/g, "");
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
            out.push(parseInt(src.slice(i + 1, i + 3), 16));
            i += 2;
        } else if (ch === "_" && underscoreIsSpace) {
            out.push(0x20);
        } else {
            out.push(ch.charCodeAt(0) & 0xff);
        }
    }
    return Uint8Array.from(out);
}

function decodeBase64(s: string): Uint8Array {
    return Uint8Array.from(Buffer.from(s.replace(/[^A-Za-z0-9+/=]/g, ""), "base64"));
}

/** Transfer-decode a latin1 body string to bytes. Returns null for an unsupported encoding. */
export function transferDecode(body: string, encoding: string | null | undefined): Uint8Array | null {
    const enc = (encoding ?? "7bit").trim().toLowerCase();
    if (enc === "base64") return decodeBase64(body);
    if (enc === "quoted-printable") return decodeQuotedPrintable(body);
    if (enc === "7bit" || enc === "8bit" || enc === "binary" || enc === "") return Uint8Array.from(Buffer.from(body, "latin1"));
    return null;
}

/** RFC 2047 encoded-words in a header value. Adjacent encoded words are joined without the separating whitespace. */
export function decodeEncodedWords(value: string | null): string | null {
    if (value == null) return null;
    const re = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;
    // First, drop whitespace between adjacent encoded words.
    const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
    return joined.replace(re, (_m, charset: string, enc: string, text: string) => {
        const bytes = enc.toUpperCase() === "B" ? decodeBase64(text) : decodeQuotedPrintable(text, true);
        const decoded = decodeCharset(bytes, charset);
        return decoded ?? _m;
    });
}

export interface ContentType {
    mime: string;
    params: Record<string, string>;
}

/** Parse "type/subtype; a=b; c="d"" including RFC 2231 `name*=charset''pct-encoded` values. */
export function parseContentType(value: string | null): ContentType {
    if (!value) return { mime: "text/plain", params: {} };
    const [head, ...rest] = value.split(";");
    const params: Record<string, string> = {};
    const continuations: Record<string, Array<{ n: number; v: string; ext: boolean }>> = {};
    for (const raw of rest) {
        const eq = raw.indexOf("=");
        if (eq === -1) continue;
        let name = raw.slice(0, eq).trim().toLowerCase();
        let v = raw.slice(eq + 1).trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, "$1");
        const ext = name.endsWith("*");
        if (ext) name = name.slice(0, -1);
        const cont = /^(.*)\*(\d+)$/.exec(name);
        if (cont) {
            (continuations[cont[1]] ??= []).push({ n: Number(cont[2]), v, ext });
            continue;
        }
        params[name] = ext ? decodeRfc2231(v) : v;
    }
    for (const [name, pieces] of Object.entries(continuations)) {
        pieces.sort((a, b) => a.n - b.n);
        const first = pieces[0];
        let charset = "utf-8";
        const joined = pieces
            .map((p, i) => {
                if (!p.ext) return p.v;
                if (i === 0) {
                    const m = /^([^']*)'[^']*'(.*)$/.exec(p.v);
                    if (m) {
                        charset = m[1] || "utf-8";
                        return m[2];
                    }
                }
                return p.v;
            })
            .join("");
        params[name] = first.ext ? decodeCharset(pctDecode(joined), charset) ?? joined : joined;
    }
    return { mime: head.trim().toLowerCase() || "text/plain", params };
}

function pctDecode(s: string): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "%" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
            out.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 2;
        } else out.push(s.charCodeAt(i) & 0xff);
    }
    return Uint8Array.from(out);
}

function decodeRfc2231(v: string): string {
    const m = /^([^']*)'[^']*'(.*)$/.exec(v);
    if (!m) return v;
    return decodeCharset(pctDecode(m[2]), m[1] || "utf-8") ?? v;
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€", copy: "©", reg: "®", trade: "™",
    hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", middot: "·", bull: "•", deg: "°", times: "×",
};

export function decodeHtmlEntities(s: string): string {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
        if (body[0] === "#") {
            const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
        }
        return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? m;
    });
}

/** HTML → plain text keeping paragraph breaks. */
export function htmlToText(html: string): string {
    let s = html
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/\r?\n/g, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<\/li>/gi, "")
        .replace(/<\/(p|div|h[1-6]|tr|blockquote|pre|table|section|article|header|footer|ul|ol|dd|dt)>/gi, "\n\n")
        .replace(/<(p|div|h[1-6]|tr|blockquote|pre|table|section|article|header|footer|ul|ol|hr)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "");
    s = decodeHtmlEntities(s);
    return s
        .split("\n")
        .map((line) => line.replace(/[ \t ]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// ---------------------------------------------------------------------------
// MIME tree walk
// ---------------------------------------------------------------------------

interface WalkState {
    parts: EmlPartReport[];
    attachments: EmlAttachment[];
    bodyTexts: string[];
    /** A body-like part existed but could not be decoded. */
    unreadableBody: boolean;
    depth: number;
}

function parseRaw(raw: string): RawMessage {
    const { headerBlock, body } = splitHeadersAndBody(raw);
    return { headers: parseHeaderBlock(headerBlock), body };
}

/** Split a multipart body on its boundary. Returns the raw parts (latin1 strings). */
export function splitMultipart(body: string, boundary: string): string[] {
    const delim = `--${boundary}`;
    const lines = body.split(/\r?\n/);
    const parts: string[] = [];
    let current: string[] | null = null;
    for (const line of lines) {
        if (line === delim || line === `${delim}--` || line.startsWith(`${delim}--`)) {
            if (current) parts.push(current.join("\r\n"));
            current = line === delim ? [] : null;
            if (line !== delim) break;
            continue;
        }
        if (current) current.push(line);
    }
    if (current && current.length) parts.push(current.join("\r\n"));
    return parts;
}

function textFromPart(msg: RawMessage, ct: ContentType): { text: string | null; note?: string } {
    const bytes = transferDecode(msg.body, header(msg.headers, "content-transfer-encoding"));
    if (!bytes) return { text: null, note: `unsupported transfer encoding "${header(msg.headers, "content-transfer-encoding")}"` };
    const decoded = decodeCharset(bytes, ct.params.charset);
    if (decoded == null) return { text: null, note: `unsupported charset "${ct.params.charset}"` };
    if (ct.mime === "text/html") return { text: htmlToText(decoded) };
    return { text: decoded.replace(/\r\n/g, "\n") };
}

function filenameFor(msg: RawMessage, ct: ContentType): string | null {
    const cd = parseContentType(header(msg.headers, "content-disposition"));
    const name = cd.params.filename ?? ct.params.name ?? null;
    return name ? decodeEncodedWords(name) : null;
}

function isAttachment(msg: RawMessage, ct: ContentType): boolean {
    const cd = parseContentType(header(msg.headers, "content-disposition"));
    if (cd.mime === "attachment") return true;
    const hasName = !!(cd.params.filename ?? ct.params.name);
    if (ct.mime.startsWith("text/") && !hasName) return false;
    if (ct.mime.startsWith("multipart/") || ct.mime === "message/rfc822") return false;
    return hasName || !ct.mime.startsWith("text/");
}

function decodedSize(msg: RawMessage): number | null {
    const bytes = transferDecode(msg.body, header(msg.headers, "content-transfer-encoding"));
    return bytes ? bytes.length : null;
}

function walk(msg: RawMessage, state: WalkState, role: "body" | "alternative" | "forwarded"): void {
    if (state.depth > 20) return;
    const ct = parseContentType(header(msg.headers, "content-type"));

    if (ct.mime.startsWith("multipart/")) {
        const boundary = ct.params.boundary;
        if (!boundary) {
            state.parts.push({ kind: "container", contentType: ct.mime, read: false, note: "multipart without a boundary" });
            state.unreadableBody = true;
            return;
        }
        const children = splitMultipart(msg.body, boundary).map(parseRaw);
        state.parts.push({ kind: "container", contentType: ct.mime, read: true });
        state.depth++;
        if (ct.mime === "multipart/alternative") {
            // Prefer text/plain; otherwise the first readable alternative (usually text/html).
            const ranked = children.map((c) => ({ c, ct: parseContentType(header(c.headers, "content-type")) }));
            const preferred = ranked.find((r) => r.ct.mime === "text/plain") ?? ranked.find((r) => r.ct.mime === "text/html") ?? ranked[0];
            let anyRead = false;
            for (const r of ranked) {
                if (r === preferred) {
                    const before = state.bodyTexts.length;
                    walk(r.c, state, role);
                    anyRead = state.bodyTexts.length > before;
                } else if (!anyRead && r.ct.mime.startsWith("text/")) {
                    // Preferred alternative unreadable so far: try this one as a fallback.
                    const before = state.bodyTexts.length;
                    walk(r.c, state, "alternative");
                    anyRead = state.bodyTexts.length > before;
                } else {
                    state.parts.push({ kind: "alternative", contentType: r.ct.mime, read: false, note: "alternative rendering of the same content; not needed" });
                }
            }
            if (!anyRead) state.unreadableBody = true;
        } else {
            for (const child of children) walk(child, state, role);
        }
        state.depth--;
        return;
    }

    if (ct.mime === "message/rfc822") {
        const inner = parseRaw(msg.body);
        const h = headersOf(inner.headers);
        state.parts.push({ kind: "forwarded", contentType: ct.mime, read: true });
        // Collect the forwarded body separately so it can be framed as one block.
        const outer = state.bodyTexts;
        state.bodyTexts = [];
        state.depth++;
        walk(inner, state, "forwarded");
        state.depth--;
        const innerTexts = state.bodyTexts;
        state.bodyTexts = outer;
        state.bodyTexts.push(["---- Forwarded message ----", ...headerLines(h), "", ...innerTexts].join("\n"));
        return;
    }

    if (isAttachment(msg, ct)) {
        const filename = filenameFor(msg, ct);
        state.attachments.push({ filename, contentType: ct.mime, sizeBytes: decodedSize(msg) });
        state.parts.push({ kind: "attachment", contentType: ct.mime, read: false, note: `attachment${filename ? ` ${filename}` : ""} not read; upload it separately to have it read` });
        return;
    }

    if (ct.mime.startsWith("text/")) {
        const { text, note } = textFromPart(msg, ct);
        if (text == null) {
            state.parts.push({ kind: role, contentType: ct.mime, read: false, note });
            state.unreadableBody = true;
            return;
        }
        state.parts.push({ kind: role, contentType: ct.mime, read: true });
        const trimmed = text.trim();
        if (trimmed) state.bodyTexts.push(trimmed);
        return;
    }

    // Anything else without a filename: inventory it as an unnamed attachment.
    state.attachments.push({ filename: filenameFor(msg, ct), contentType: ct.mime, sizeBytes: decodedSize(msg) });
    state.parts.push({ kind: "unknown", contentType: ct.mime, read: false, note: "non-text part not read" });
}

function headersOf(h: Map<string, string[]>): EmlHeaders {
    return {
        from: decodeEncodedWords(header(h, "from")),
        to: decodeEncodedWords(header(h, "to")),
        cc: decodeEncodedWords(header(h, "cc")),
        date: header(h, "date"),
        subject: decodeEncodedWords(header(h, "subject")),
    };
}

function headerLines(h: EmlHeaders): string[] {
    const out: string[] = [];
    if (h.from) out.push(`From: ${h.from}`);
    if (h.to) out.push(`To: ${h.to}`);
    if (h.cc) out.push(`Cc: ${h.cc}`);
    if (h.date) out.push(`Date: ${h.date}`);
    if (h.subject) out.push(`Subject: ${h.subject}`);
    return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse an .eml file. Never throws; problems are reported in `status`/`note`/`parts`. */
export function parseEmlBuffer(raw: Buffer): EmlResult {
    const msg = parseRaw(raw.toString("latin1"));
    const headers = headersOf(msg.headers);
    const looksLikeEmail = msg.headers.size > 0 && (headers.from !== null || headers.subject !== null || headers.date !== null || msg.headers.has("content-type") || msg.headers.has("mime-version"));

    const state: WalkState = { parts: [], attachments: [], bodyTexts: [], unreadableBody: false, depth: 0 };
    try {
        walk(msg, state, "body");
    } catch (err) {
        return { text: "", headers, parts: state.parts, attachments: state.attachments, status: "failed", note: err instanceof Error ? err.message : "The email could not be parsed." };
    }

    const body = state.bodyTexts.join("\n\n");
    const text = tidyToMarkdown(`${headerLines(headers).join("\n")}\n\n${body}`);

    if (!looksLikeEmail) {
        return { text: "", headers, parts: state.parts, attachments: state.attachments, status: "failed", note: "This does not look like an email: no From, Subject, Date or MIME headers were found." };
    }
    if (state.unreadableBody) {
        const unread = state.parts.filter((p) => !p.read && p.kind !== "attachment" && p.kind !== "alternative");
        const note = body
            ? `Some of the email could not be read (${unread.map((p) => p.note ?? p.contentType).join("; ")}).`
            : `The email's body could not be read (${unread.map((p) => p.note ?? p.contentType).join("; ")}). The headers were kept; you can describe the content by hand.`;
        return { text, headers, parts: state.parts, attachments: state.attachments, status: "partial", note };
    }
    const note = state.attachments.length
        ? `${state.attachments.length} attachment${state.attachments.length === 1 ? "" : "s"} not read: ${state.attachments.map((a) => a.filename ?? a.contentType).join(", ")}. Upload attachments separately to have them read.`
        : undefined;
    return { text, headers, parts: state.parts, attachments: state.attachments, status: "completed", note };
}

/** Back-compatible convenience: text only. Prefer `parseEmlBuffer` for the report. */
export function parseEml(raw: string | Buffer): string {
    return parseEmlBuffer(Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8")).text;
}
