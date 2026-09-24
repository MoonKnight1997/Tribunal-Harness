"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Notice, Textarea } from "@/components/ui";

export function SituationSummary({ caseId, summary, stale }: { caseId: string; summary: string | null; stale: boolean }) {
    const router = useRouter();
    const [draft, setDraft] = useState<string | null>(null);
    const [unclear, setUnclear] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function propose() {
        setBusy(true);
        setError(null);
        try {
            const res = await api<{ summary: string; stillUnclear: string[] }>(`/api/cases/${caseId}/summary/propose`, { method: "POST", body: {} });
            setDraft(res.summary);
            setUnclear(res.stillUnclear);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    async function confirm() {
        if (draft === null) return;
        setBusy(true);
        try {
            await api(`/api/cases/${caseId}/summary/confirm`, { method: "POST", body: { summary: draft } });
            setDraft(null);
            router.refresh();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    if (draft !== null) {
        return (
            <div className="space-y-3">
                <p className="text-sm text-ink-muted">This is a suggested description built only from what you have confirmed. Edit it so it is right, then save.</p>
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
                {unclear.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-ink-muted">
                        {unclear.map((u) => (
                            <li key={u}>{u}</li>
                        ))}
                    </ul>
                )}
                {error && <Notice tone="warn">{error}</Notice>}
                <div className="flex gap-2">
                    <Button onClick={confirm} disabled={busy}>Save</Button>
                    <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                </div>
            </div>
        );
    }
    return (
        <div>
            {summary ? <p className="mb-3 whitespace-pre-line">{summary}</p> : <p className="mb-3 text-ink-muted">No description yet. Once you have confirmed a few events and facts, we can suggest one for you to check.</p>}
            {error && <Notice tone="warn">{error}</Notice>}
            <div className="flex gap-2">
                <Button variant="secondary" onClick={propose} disabled={busy}>
                    {busy ? "Thinking…" : summary ? (stale ? "Refresh suggestion" : "Suggest an update") : "Suggest a description"}
                </Button>
                <Button variant="quiet" onClick={() => { setDraft(summary ?? ""); setUnclear([]); }}>
                    Write my own
                </Button>
            </div>
        </div>
    );
}
