"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice, Select, Pill, Empty } from "@/components/ui";
import { DOCUMENT_TYPES } from "@/db/enums";

/** Subset of the persisted extraction report the screen summarises (mirrors ExtractionReport in the schema; type-only). */
export type ReportView = {
    coverage: { totalChars: number; charsSent: number; chunks: number; chunksSucceeded: number; truncated: boolean; parts?: Array<{ kind: string; contentType: string; read: boolean; note?: string }>; pages?: Array<{ page: number; chars: number; confidence?: number | null }> };
    diagnostics: Array<{ chunk: number; kind: string; index: number; problem: string }>;
    counts: { events: number; facts: number; allegations: number; duplicatesSkipped: number; quotesUnverified: number };
    method: string;
    attachments?: Array<{ filename: string | null; contentType: string; sizeBytes: number | null }>;
};

export type DocView = {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    docType: string;
    docTypeConfirmed: boolean;
    docDate: string | null;
    extractionStatus: string;
    extractionError: string | null;
    extractionReport: ReportView | null;
    processId: string | null;
    pageCount: number | null;
    userDescription: string | null;
    uploadedAt: string;
    hasText: boolean;
};

const STATUS_TONE: Record<string, "ok" | "warn" | "urgent" | "neutral"> = { completed: "ok", partial: "warn", processing: "neutral", queued: "neutral", requires_review: "warn", unsupported: "neutral", failed: "urgent" };
const STATUS_LABEL: Record<string, string> = { completed: "read", partial: "read with gaps", processing: "reading…", queued: "waiting", requires_review: "needs a look", unsupported: "kept as evidence", failed: "could not read" };
const IN_PROGRESS = new Set(["queued", "processing"]);
const RETRYABLE = new Set(["failed", "requires_review", "partial"]);

const POLL_MS = 3_000;
const POLL_MAX_MS = 5 * 60_000;

/** Plain-English lines summarising what the extraction did and did not manage. Exported for tests. */
export function reportSummary(d: Pick<DocView, "extractionStatus" | "extractionReport" | "pageCount">): string[] {
    const r = d.extractionReport;
    if (!r || IN_PROGRESS.has(d.extractionStatus)) return [];
    const lines: string[] = [];
    const c = r.coverage;
    if (c.chunks > 0) lines.push(c.chunks === 1 ? (c.chunksSucceeded === 1 ? "Read the whole text" : "The text could not be read") : `Read ${c.chunksSucceeded} of ${c.chunks} sections`);
    if (c.truncated) lines.push(`Only the first ${c.charsSent.toLocaleString("en-GB")} of ${c.totalChars.toLocaleString("en-GB")} characters were read`);
    if (c.parts) {
        const unreadBody = c.parts.filter((p) => !p.read && p.kind !== "attachment" && p.kind !== "alternative");
        if (unreadBody.length) lines.push(`${unreadBody.length} part${unreadBody.length === 1 ? "" : "s"} of the email could not be read`);
    }
    if (r.attachments && r.attachments.length) lines.push(`${r.attachments.length} attachment${r.attachments.length === 1 ? "" : "s"} not read: ${r.attachments.map((a) => a.filename ?? a.contentType).join(", ")}`);
    const dropped = r.diagnostics.filter((x) => x.kind !== "document" || x.chunk >= 0).length;
    if (dropped) lines.push(`${dropped} suggested item${dropped === 1 ? "" : "s"} could not be used`);
    if (r.counts.quotesUnverified) lines.push(`${r.counts.quotesUnverified} suggestion${r.counts.quotesUnverified === 1 ? "" : "s"} could not be matched to the wording — check before confirming`);
    if (r.counts.duplicatesSkipped) lines.push(`${r.counts.duplicatesSkipped} duplicate suggestion${r.counts.duplicatesSkipped === 1 ? "" : "s"} skipped`);
    if (r.method === "ocr" && c.pages) {
        const confs = c.pages.map((p) => p.confidence).filter((x): x is number => typeof x === "number");
        if (confs.length) {
            const mean = confs.reduce((a, b) => a + b, 0) / confs.length;
            lines.push(mean < 0.6 ? "OCR confidence low — check the wording" : `Text recognised by OCR (${Math.round(mean * 100)}% confidence)`);
        } else lines.push("Text recognised by OCR");
        if (d.pageCount && d.pageCount > 1) lines.push(`${d.pageCount} pages`);
    }
    const total = r.counts.events + r.counts.facts + r.counts.allegations;
    if (total) lines.push(`${r.counts.events} event${r.counts.events === 1 ? "" : "s"}, ${r.counts.facts} fact${r.counts.facts === 1 ? "" : "s"}${r.counts.allegations ? `, ${r.counts.allegations} allegation${r.counts.allegations === 1 ? "" : "s"}` : ""} suggested`);
    return lines;
}

export function Documents({ caseId, documents, disciplinaryProcesses }: { caseId: string; documents: DocView[]; disciplinaryProcesses: Array<{ id: string; state: string }> }) {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [description, setDescription] = useState("");
    const [processId, setProcessId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState<string>("");
    const [pollTimedOut, setPollTimedOut] = useState(false);
    const pollStartedAt = useRef<number | null>(null);
    const previousStatuses = useRef<Map<string, string>>(new Map());

    const inProgress = documents.filter((d) => IN_PROGRESS.has(d.extractionStatus));

    // Poll while any document is being read, so a production worker's progress shows up without a manual refresh.
    useEffect(() => {
        if (inProgress.length === 0) {
            pollStartedAt.current = null;
            return;
        }
        if (pollStartedAt.current === null) pollStartedAt.current = Date.now();
        if (Date.now() - pollStartedAt.current > POLL_MAX_MS) {
            setPollTimedOut(true);
            return;
        }
        const t = setTimeout(() => router.refresh(), POLL_MS);
        return () => clearTimeout(t);
    }, [inProgress.length, documents, router]);

    // Announce status changes politely for screen readers.
    useEffect(() => {
        const changes: string[] = [];
        for (const d of documents) {
            const prev = previousStatuses.current.get(d.id);
            if (prev && prev !== d.extractionStatus) changes.push(`${d.filename}: ${STATUS_LABEL[d.extractionStatus] ?? d.extractionStatus.replace(/_/g, " ")}`);
            previousStatuses.current.set(d.id, d.extractionStatus);
        }
        if (changes.length) setAnnouncement(changes.join(". "));
    }, [documents]);

    async function run(fn: () => Promise<unknown>) {
        setBusy(true);
        setError(null);
        try {
            await fn();
            setPollTimedOut(false);
            pollStartedAt.current = null;
            router.refresh();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-5">
            <p aria-live="polite" className="sr-only">{announcement}</p>
            {error && <Notice tone="warn">{error}</Notice>}
            {message && <Notice tone="ok">{message}</Notice>}
            {inProgress.length > 0 && !pollTimedOut && <Notice tone="info">Reading {inProgress.length === 1 ? "one document" : `${inProgress.length} documents`}… this page updates itself.</Notice>}
            {pollTimedOut && inProgress.length > 0 && <Notice tone="warn">Still reading after five minutes. Refresh the page later to see the result, or cancel and try again.</Notice>}
            <Card title="Upload a document">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="File" hint="PDF, Word, text, email (.eml) or an image. Up to 10 MB.">
                        <input type="file" accept=".pdf,.docx,.txt,.md,.eml,.png,.jpg,.jpeg,.webp,.heic,application/pdf,text/plain,message/rfc822,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[15px]" />
                    </Field>
                    <Field label="What is it? (optional)" hint="A few words helps us read it in context.">
                        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Letter inviting me to the hearing" />
                    </Field>
                    {disciplinaryProcesses.length > 0 && (
                        <Field label="Part of a disciplinary process?" hint="We will pull out the allegations for you to check.">
                            <Select value={processId} onChange={(e) => setProcessId(e.target.value)}>
                                <option value="">No</option>
                                {disciplinaryProcesses.map((p) => <option key={p.id} value={p.id}>Disciplinary ({p.state.replace(/_/g, " ")})</option>)}
                            </Select>
                        </Field>
                    )}
                </div>
                <div className="mt-4">
                    <Button disabled={busy || !file} onClick={() => run(async () => {
                        const form = new FormData();
                        form.append("file", file!);
                        if (description) form.append("description", description);
                        if (processId) form.append("processId", processId);
                        const res = await api<{ document: DocView; jobId: string | null }>(`/api/cases/${caseId}/documents`, { form });
                        setFile(null);
                        setDescription("");
                        const s = res.document.extractionStatus;
                        setMessage(
                            s === "completed" ? "Uploaded and read. Check the Timeline for suggested events."
                            : s === "partial" ? "Uploaded and read, with some gaps. See the note under the document."
                            : s === "requires_review" ? "Uploaded. We could not read all of it automatically; you can still describe it and link it to events."
                            : IN_PROGRESS.has(s) ? "Uploaded. We are reading it now; this page will update."
                            : "Uploaded.",
                        );
                    })}>{busy ? "Uploading…" : "Upload"}</Button>
                </div>
            </Card>
            <Card title="Your documents">
                {documents.length === 0 ? <Empty>No documents yet.</Empty> : (
                    <ul className="space-y-3">
                        {documents.map((d) => {
                            const summary = reportSummary(d);
                            return (
                                <li key={d.id} className="rounded-lg border border-line p-3">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{d.filename} <Pill tone={STATUS_TONE[d.extractionStatus] ?? "neutral"}>{STATUS_LABEL[d.extractionStatus] ?? d.extractionStatus.replace(/_/g, " ")}</Pill>{d.processId && <Pill tone="accent">disciplinary</Pill>}</p>
                                            <p className="text-xs text-ink-muted">{(d.sizeBytes / 1024).toFixed(0)} KB · uploaded {d.uploadedAt.slice(0, 10)}{d.userDescription ? ` · ${d.userDescription}` : ""}</p>
                                            {d.extractionError && <p className="mt-1 text-sm text-warn">{d.extractionError}</p>}
                                            {summary.length > 0 && (
                                                <ul className="mt-1 text-xs text-ink-muted">
                                                    {summary.map((line) => <li key={line}>{line}</li>)}
                                                </ul>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            <a className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-sm no-underline" href={`/api/cases/${caseId}/documents/${d.id}/download`}>Download</a>
                                            {RETRYABLE.has(d.extractionStatus) && <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/documents/${d.id}/reprocess`, { method: "POST", body: {} }))}>Try again</Button>}
                                            {d.extractionStatus === "queued" && <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/documents/${d.id}/cancel`, { method: "POST", body: {} }))}>Cancel</Button>}
                                            <Button variant="quiet" disabled={busy} onClick={() => { if (confirm("Delete this document? Events you confirmed from it stay.")) run(() => api(`/api/cases/${caseId}/documents/${d.id}`, { method: "DELETE" })); }}>Delete</Button>
                                        </div>
                                    </div>
                                    <div className="mt-2 grid gap-2 sm:grid-cols-[220px_180px]">
                                        <Select value={d.docType} aria-label="Document type" onChange={(e) => run(() => api(`/api/cases/${caseId}/documents/${d.id}`, { method: "PATCH", body: { docType: e.target.value } }))}>
                                            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}{!d.docTypeConfirmed && t === d.docType ? " (suggested)" : ""}</option>)}
                                        </Select>
                                        <Input type="date" aria-label="Document date" defaultValue={d.docDate ?? ""} onBlur={(e) => { if (e.target.value !== (d.docDate ?? "")) run(() => api(`/api/cases/${caseId}/documents/${d.id}`, { method: "PATCH", body: { docDate: e.target.value || null } })); }} />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Card>
        </div>
    );
}
