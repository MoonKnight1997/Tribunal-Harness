"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice, Select, Pill, Empty } from "@/components/ui";
import { DOCUMENT_TYPES } from "@/db/enums";

type DocView = { id: string; filename: string; mimeType: string; sizeBytes: number; docType: string; docTypeConfirmed: boolean; docDate: string | null; extractionStatus: string; extractionError: string | null; userDescription: string | null; uploadedAt: string; hasText: boolean };

const STATUS_TONE: Record<string, "ok" | "warn" | "urgent" | "neutral"> = { completed: "ok", processing: "neutral", queued: "neutral", requires_review: "warn", unsupported: "neutral", failed: "urgent" };

export function Documents({ caseId, documents, disciplinaryProcesses }: { caseId: string; documents: DocView[]; disciplinaryProcesses: Array<{ id: string; state: string }> }) {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [description, setDescription] = useState("");
    const [processId, setProcessId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    async function run(fn: () => Promise<unknown>) {
        setBusy(true);
        setError(null);
        try {
            await fn();
            router.refresh();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-5">
            {error && <Notice tone="warn">{error}</Notice>}
            {message && <Notice tone="ok">{message}</Notice>}
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
                        setMessage(res.document.extractionStatus === "completed" ? "Uploaded and read. Check the Timeline for suggested events." : res.document.extractionStatus === "requires_review" ? "Uploaded. We could not read all of it automatically; you can still describe it and link it to events." : "Uploaded.");
                    })}>{busy ? "Uploading…" : "Upload"}</Button>
                </div>
            </Card>
            <Card title="Your documents">
                {documents.length === 0 ? <Empty>No documents yet.</Empty> : (
                    <ul className="space-y-3">
                        {documents.map((d) => (
                            <li key={d.id} className="rounded-lg border border-line p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">{d.filename} <Pill tone={STATUS_TONE[d.extractionStatus] ?? "neutral"}>{d.extractionStatus.replace(/_/g, " ")}</Pill></p>
                                        <p className="text-xs text-ink-muted">{(d.sizeBytes / 1024).toFixed(0)} KB · uploaded {d.uploadedAt.slice(0, 10)}{d.userDescription ? ` · ${d.userDescription}` : ""}</p>
                                        {d.extractionError && <p className="mt-1 text-sm text-warn">{d.extractionError}</p>}
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        <a className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-sm no-underline" href={`/api/cases/${caseId}/documents/${d.id}/download`}>Download</a>
                                        {(d.extractionStatus === "failed" || d.extractionStatus === "requires_review") && d.hasText && <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/documents/${d.id}/reprocess`, { method: "POST", body: {} }))}>Try again</Button>}
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
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
