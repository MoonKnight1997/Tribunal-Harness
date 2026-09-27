/**
 * OCR — an explicit, optional, LOCAL capability.
 *
 * Images (and scanned PDFs) are kept as evidence whether or not OCR is
 * available. When `OCR_PROVIDER=tesseract_cli` is set and the `tesseract`
 * binary is installed, image uploads are read locally and the result carries
 * per-page character counts and a mean word confidence so the document
 * screen can say "OCR confidence low — check the wording". When OCR is not
 * configured, or the binary is missing, `getOcrProvider()` returns null and
 * the document is reported as `unsupported` with the manual-fallback message.
 *
 * Images are never sent to a network provider from here.
 *
 * Scanned PDFs: rasterising needs `pdftoppm` (poppler-utils). When it is not
 * installed, PDFs without a text layer keep today's `requires_review`
 * outcome and the note says so.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface OcrPage {
    /** 1-based page number. */
    page: number;
    text: string;
    /** Mean word confidence in [0, 1], or null when the engine does not report one. */
    confidence: number | null;
}

export interface OcrProvider {
    readonly name: string;
    available(): Promise<boolean>;
    recognise(image: Buffer, mime: string): Promise<{ pages: OcrPage[] }>;
}

/** Below this mean confidence the result is marked for review rather than trusted. */
export const OCR_MIN_CONFIDENCE = 0.6;
/** Below this many characters the OCR result is too short to propose from. */
export const OCR_MIN_CHARS = 20;

function run(cmd: string, args: string[], input?: Buffer, timeoutMs = 120_000): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
        } catch (err) {
            reject(err);
            return;
        }
        const out: Buffer[] = [];
        let err = "";
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.stdout.on("data", (d: Buffer) => out.push(d));
        child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
        child.on("error", (e) => {
            clearTimeout(timer);
            reject(e);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout: Buffer.concat(out), stderr: err });
        });
        if (input) child.stdin.end(input);
        else child.stdin.end();
    });
}

/**
 * Parse tesseract's TSV output into text (lines/paragraphs preserved) and a
 * mean word confidence. Exported for tests.
 */
export function parseTesseractTsv(tsv: string): { text: string; confidence: number | null } {
    const lines = tsv.split(/\r?\n/);
    const header = lines.shift()?.split("\t") ?? [];
    const col = (name: string) => header.indexOf(name);
    const iLevel = col("level");
    const iBlock = col("block_num");
    const iPar = col("par_num");
    const iLine = col("line_num");
    const iConf = col("conf");
    const iText = col("text");
    if (iLevel === -1 || iText === -1) return { text: tsv.trim(), confidence: null };
    let text = "";
    let lastKey = "";
    let confSum = 0;
    let confN = 0;
    for (const line of lines) {
        const cells = line.split("\t");
        if (cells.length <= iText) continue;
        if (cells[iLevel] !== "5") continue; // words only
        const word = cells[iText];
        if (!word || !word.trim()) continue;
        const key = `${cells[iBlock]}|${cells[iPar]}|${cells[iLine]}`;
        if (lastKey && key !== lastKey) {
            const [b, p] = lastKey.split("|");
            text += cells[iBlock] !== b || cells[iPar] !== p ? "\n\n" : "\n";
        } else if (text) {
            text += " ";
        }
        text += word;
        lastKey = key;
        const conf = Number(cells[iConf]);
        if (Number.isFinite(conf) && conf >= 0) {
            confSum += conf;
            confN++;
        }
    }
    return { text: text.trim(), confidence: confN ? Math.round((confSum / confN) / 100 * 1000) / 1000 : null };
}

/** Local Tesseract via the CLI. Uses TSV output for word confidences. */
export class TesseractCliOcr implements OcrProvider {
    readonly name = "tesseract_cli";
    private availability: Promise<boolean> | null = null;
    constructor(private readonly binary = process.env.TESSERACT_BIN ?? "tesseract", private readonly lang = process.env.OCR_LANG ?? "eng") {}

    available(): Promise<boolean> {
        if (!this.availability) {
            this.availability = run(this.binary, ["--version"], undefined, 10_000)
                .then((r) => r.code === 0)
                .catch(() => false);
        }
        return this.availability;
    }

    async recognise(image: Buffer, mime: string): Promise<{ pages: OcrPage[] }> {
        const r = await run(this.binary, ["-", "-", "-l", this.lang, "--psm", "3", "tsv"], image);
        if (r.code !== 0) throw new Error(`tesseract exited with code ${r.code} for ${mime || "image"}${r.stderr ? `: ${r.stderr.trim().slice(0, 300)}` : ""}`);
        const parsed = parseTesseractTsv(r.stdout.toString("utf8"));
        return { pages: [{ page: 1, text: parsed.text, confidence: parsed.confidence }] };
    }
}

/** Whether `pdftoppm` is present (needed to OCR a scanned PDF). */
export async function canRasterisePdf(): Promise<boolean> {
    try {
        const r = await run(process.env.PDFTOPPM_BIN ?? "pdftoppm", ["-v"], undefined, 10_000);
        // pdftoppm -v prints the version on stderr and exits 0 (or 99 on some builds).
        return r.code === 0 || /pdftoppm version/i.test(r.stderr);
    } catch {
        return false;
    }
}

/** Rasterise a PDF to PNG pages with pdftoppm. Returns page buffers in order. UNVERIFIED in CI (no poppler installed). */
export async function rasterisePdf(pdf: Buffer, dpi = 200, maxPages = 50): Promise<Buffer[]> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-"));
    try {
        const input = path.join(dir, "in.pdf");
        await fs.writeFile(input, pdf, { mode: 0o600 });
        const r = await run(process.env.PDFTOPPM_BIN ?? "pdftoppm", ["-r", String(dpi), "-l", String(maxPages), "-png", input, path.join(dir, "page")], undefined, 300_000);
        if (r.code !== 0) throw new Error(`pdftoppm exited with code ${r.code}`);
        const files = (await fs.readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return Promise.all(files.map((f) => fs.readFile(path.join(dir, f))));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

/** OCR a multi-page PDF page-by-page. Requires both a provider and pdftoppm. */
export async function recognisePdf(provider: OcrProvider, pdf: Buffer): Promise<{ pages: OcrPage[] }> {
    const images = await rasterisePdf(pdf);
    const pages: OcrPage[] = [];
    for (let i = 0; i < images.length; i++) {
        const r = await provider.recognise(images[i], "image/png");
        for (const p of r.pages) pages.push({ ...p, page: i + 1 });
    }
    return { pages };
}

let override: OcrProvider | null | undefined;
let configured: OcrProvider | null | undefined;

/** The configured OCR provider, or null when OCR is not configured or the binary is missing. */
export async function getOcrProvider(): Promise<OcrProvider | null> {
    if (override !== undefined) return override;
    if (configured === undefined) {
        const name = (process.env.OCR_PROVIDER ?? "").trim().toLowerCase();
        if (name === "tesseract_cli") {
            const t = new TesseractCliOcr();
            configured = (await t.available()) ? t : null;
        } else {
            configured = null;
        }
    }
    return configured;
}

/** Tests: force a provider (pass null to force "none"; undefined to clear the override). */
export function setOcrProviderForTests(provider: OcrProvider | null | undefined): void {
    override = provider;
    configured = undefined;
}
