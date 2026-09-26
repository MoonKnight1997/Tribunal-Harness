"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Notice, Pill, Textarea, Empty } from "@/components/ui";
import { Markdown } from "@/components/markdown";

type ArtifactView = { id: string; type: string; title: string; content: string; version: number; status: string; stale: boolean; staleReason: string | null; updatedAt: string };

export function Exports({ caseId, artifacts, processes, entitlements, claimsEnabled }: { caseId: string; artifacts: ArtifactView[]; processes: Array<{ id: string; type: string; state: string }>; entitlements: { paymentsEnabled: boolean; casePass: boolean; claimPack: boolean }; claimsEnabled: boolean }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
    const [open, setOpen] = useState<string | null>(artifacts[0]?.id ?? null);

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

    const gen = (type: string, processId?: string) => run(() => api(`/api/cases/${caseId}/artifacts`, { body: { type, processId: processId ?? null } }));
    const needsPass = entitlements.paymentsEnabled && !entitlements.casePass;
    const needsPack = entitlements.paymentsEnabled && !entitlements.claimPack;

    return (
        <div className="space-y-5">
            {error && <Notice tone="warn">{error}</Notice>}
            <Card title="Generate">
                {needsPass && <p className="mb-3 text-sm text-ink-muted">Generating documents needs a Case Pass. <Link href={`/app/cases/${caseId}/upgrade`}>See options</Link>.</p>}
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={busy || needsPass} onClick={() => gen("chronology")}>Chronology</Button>
                    <Button variant="secondary" disabled={busy || needsPass} onClick={() => gen("case_summary")}>Case summary</Button>
                    <Button variant="secondary" disabled={busy || needsPass} onClick={() => gen("meeting_preparation")}>Meeting preparation</Button>
                    {processes.filter((p) => p.type === "grievance").map((p) => <Button key={p.id} variant="secondary" disabled={busy || needsPass} onClick={() => gen("grievance_letter", p.id)}>Grievance letter</Button>)}
                    {processes.filter((p) => p.type === "disciplinary").map((p) => <Button key={p.id} variant="secondary" disabled={busy || needsPass} onClick={() => gen("disciplinary_response", p.id)}>Disciplinary hearing preparation</Button>)}
                    {processes.filter((p) => p.type === "acas_early_conciliation").map((p) => <Button key={p.id} variant="secondary" disabled={busy || needsPass} onClick={() => gen("acas_preparation", p.id)}>Acas preparation</Button>)}
                    {processes.filter((p) => p.type.endsWith("_appeal")).map((p) => <Button key={p.id} variant="secondary" disabled={busy || needsPass} onClick={() => gen(p.type, p.id)}>{p.type.replace(/_/g, " ")} letter</Button>)}
                    <Button variant="secondary" disabled={busy || needsPack} onClick={() => run(() => api(`/api/cases/${caseId}/et1`, { method: "POST", body: {} }))}>ET1 readiness pack</Button>
                    {claimsEnabled && <Button variant="secondary" disabled={busy || needsPack} onClick={() => gen("potential_claims_summary")}>Possible claims summary</Button>}
                </div>
                {needsPack && !needsPass && <p className="mt-2 text-sm text-ink-muted">The ET1 readiness pack needs the Claim Pack. <Link href={`/app/cases/${caseId}/upgrade`}>See options</Link>.</p>}
            </Card>
            <Card title="Export your whole case">
                <p className="mb-3 text-sm text-ink-muted">A complete copy of your record to keep or to take to an adviser. Nothing is sent anywhere.</p>
                <div className="flex flex-wrap gap-2">
                    <a className="inline-flex items-center rounded-lg border border-line px-4 py-2 text-[15px] no-underline" href={`/api/cases/${caseId}/export?format=markdown`}>Download case pack (text)</a>
                    <a className="inline-flex items-center rounded-lg border border-line px-4 py-2 text-[15px] no-underline" href={`/api/cases/${caseId}/export?format=json`}>Download case pack (data)</a>
                </div>
            </Card>
            {artifacts.length === 0 ? <Empty>Nothing generated yet.</Empty> : (
                <div className="space-y-3">
                    {artifacts.map((a) => (
                        <Card key={a.id} title={<button className="text-left" onClick={() => setOpen(open === a.id ? null : a.id)}>{a.title} <span className="text-sm font-normal text-ink-muted">v{a.version}</span></button>} aside={<span className="flex gap-1">{a.stale && <Pill tone="warn">out of date</Pill>}<Pill tone={a.status === "final" ? "ok" : "neutral"}>{a.status}</Pill></span>}>
                            {a.stale && <p className="mb-2 text-sm text-warn">Your record changed ({a.staleReason}). Generate a fresh version, or keep editing this one if you prefer.</p>}
                            {open === a.id && (
                                editing?.id === a.id ? (
                                    <div className="space-y-2">
                                        <Textarea className="min-h-[360px] font-mono text-sm" value={editing.content} onChange={(e) => setEditing({ id: a.id, content: e.target.value })} />
                                        <div className="flex gap-2">
                                            <Button disabled={busy} onClick={() => run(async () => { await api(`/api/cases/${caseId}/artifacts/${a.id}`, { method: "PATCH", body: { content: editing.content } }); setEditing(null); })}>Save</Button>
                                            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="rounded-lg border border-line bg-surface-muted p-4"><Markdown text={a.content} /></div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <Button variant="secondary" onClick={() => setEditing({ id: a.id, content: a.content })}>Edit wording</Button>
                                            <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/artifacts/${a.id}`, { method: "PATCH", body: { status: a.status === "final" ? "draft" : "final" } }))}>{a.status === "final" ? "Mark as draft" : "Mark as final"}</Button>
                                            <Button variant="secondary" onClick={() => { const blob = new Blob([a.content], { type: "text/markdown" }); const url = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = url; el.download = `${a.title.replace(/\s+/g, "-").toLowerCase()}-v${a.version}.md`; el.click(); URL.revokeObjectURL(url); }}>Download</Button>
                                            <Button variant="quiet" disabled={busy} onClick={() => { if (confirm("Delete this document?")) run(() => api(`/api/cases/${caseId}/artifacts/${a.id}`, { method: "DELETE" })); }}>Delete</Button>
                                        </div>
                                    </div>
                                )
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
