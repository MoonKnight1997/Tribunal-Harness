"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice, Select, Textarea, Pill, Empty } from "@/components/ui";
import { APPEAL_GROUND_LABELS } from "@/processes/machines";
import { APPEAL_GROUND_CATEGORIES } from "@/db/enums";
import type { StateDef } from "@/processes/machines";

type Allegation = { id: string; employerAllegation: string; employerEvidence: string | null; workerResponse: string | null; workerEvidence: string | null; missingInformation: string | null; hearingQuestions: string[]; status: string; provenance: string };
type Ground = { id: string; category: string; summary: string; detail: string | null; selected: boolean };
type Proc = { id: string; type: string; state: string; data: Record<string, unknown>; acasCodeVersion: string | null; closedAt: string | null; states: StateDef[]; allegations: Allegation[]; grounds: Ground[] };

const ARTIFACT_FOR: Record<string, Array<{ type: string; label: string }>> = {
    grievance: [{ type: "grievance_letter", label: "Draft grievance letter" }, { type: "meeting_preparation", label: "Meeting preparation" }],
    disciplinary: [{ type: "disciplinary_response", label: "Hearing preparation" }, { type: "meeting_preparation", label: "Meeting preparation" }],
    grievance_appeal: [{ type: "grievance_appeal", label: "Draft appeal" }],
    disciplinary_appeal: [{ type: "disciplinary_appeal", label: "Draft appeal" }],
    informal: [{ type: "meeting_preparation", label: "Prepare for the conversation" }],
};

const DATA_FIELDS: Record<string, Array<{ key: string; label: string; type: "date" | "text" | "number" | "textarea" }>> = {
    grievance: [
        { key: "desiredResolution", label: "What you want to happen", type: "textarea" },
        { key: "submittedDate", label: "Date submitted", type: "date" },
        { key: "meetingDate", label: "Meeting date", type: "date" },
        { key: "outcomeDate", label: "Outcome received on", type: "date" },
        { key: "appealWindowDays", label: "Days allowed to appeal (from the outcome letter)", type: "number" },
        { key: "employerResponseSummary", label: "Employer's response, in summary", type: "textarea" },
    ],
    disciplinary: [
        { key: "investigationStartDate", label: "Investigation started", type: "date" },
        { key: "hearingDate", label: "Hearing date", type: "date" },
        { key: "outcomeDate", label: "Outcome received on", type: "date" },
        { key: "appealWindowDays", label: "Days allowed to appeal (from the outcome letter)", type: "number" },
        { key: "outcome", label: "Outcome, in summary", type: "textarea" },
    ],
    grievance_appeal: [{ key: "submittedDate", label: "Appeal submitted", type: "date" }, { key: "hearingDate", label: "Appeal hearing", type: "date" }, { key: "outcomeDate", label: "Appeal outcome received", type: "date" }, { key: "outcome", label: "Outcome, in summary", type: "textarea" }],
    disciplinary_appeal: [{ key: "submittedDate", label: "Appeal submitted", type: "date" }, { key: "hearingDate", label: "Appeal hearing", type: "date" }, { key: "outcomeDate", label: "Appeal outcome received", type: "date" }, { key: "outcome", label: "Outcome, in summary", type: "textarea" }],
    informal: [{ key: "raisedDate", label: "Raised on", type: "date" }, { key: "raisedWith", label: "Raised with", type: "text" }, { key: "outcome", label: "What was said", type: "textarea" }],
};

export function Processes({ caseId, processes }: { caseId: string; processes: Proc[] }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [newType, setNewType] = useState("grievance");
    const [newStart, setNewStart] = useState("");
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
            <Card title="Start a process">
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
                    <Select value={newType} onChange={(e) => setNewType(e.target.value)}>
                        <option value="informal">Raising it informally</option>
                        <option value="grievance">Grievance</option>
                        <option value="disciplinary">Disciplinary / investigation</option>
                        <option value="grievance_appeal">Grievance appeal</option>
                        <option value="disciplinary_appeal">Disciplinary appeal</option>
                    </Select>
                    <Input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} aria-label="Start date" />
                    <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/processes`, { body: { type: newType, startedOn: newStart || undefined, parentProcessId: newType.endsWith("_appeal") ? processes.find((p) => p.type === newType.replace("_appeal", ""))?.id : undefined } }))}>Start</Button>
                </div>
                <p className="mt-2 text-sm text-ink-muted">The start date decides which version of the Acas Code applies to the process.</p>
            </Card>
            {processes.length === 0 && <Empty>No process started yet. If your employer has started one, or you are about to, add it above.</Empty>}
            {processes.map((p) => <ProcessCard key={p.id} caseId={caseId} p={p} busy={busy} run={run} onGenerated={(t) => setMessage(`${t} generated. Find it under Exports to read and edit.`)} />)}
        </div>
    );
}

function ProcessCard({ caseId, p, busy, run, onGenerated }: { caseId: string; p: Proc; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void>; onGenerated: (t: string) => void }) {
    const def = p.states.find((s) => s.id === p.state);
    const [data, setData] = useState<Record<string, string>>(Object.fromEntries((DATA_FIELDS[p.type] ?? []).map((f) => [f.key, p.data[f.key] === undefined || p.data[f.key] === null ? "" : String(p.data[f.key])])));
    const [allegation, setAllegation] = useState({ employerAllegation: "", employerEvidence: "" });
    const [ground, setGround] = useState({ category: "procedural_issue", summary: "", detail: "" });
    const [editingAllegation, setEditingAllegation] = useState<Record<string, Partial<Allegation & { hearingQuestionsText: string }>>>({});

    return (
        <Card title={<span className="capitalize">{p.type.replace(/_/g, " ")}</span>} aside={<Pill tone={p.closedAt ? "neutral" : "accent"}>{def?.label ?? p.state}</Pill>}>
            {def && <p className="mb-3 text-ink-muted">{def.plain}</p>}
            {p.acasCodeVersion && <p className="mb-3 text-xs text-ink-faint">Governed by: {p.acasCodeVersion.replace(/_/g, " ")} (the Code in force when this started).</p>}
            {def && def.next.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-ink-muted">Move to:</span>
                    {def.next.map((n) => <Button key={n} variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/processes/${p.id}/transition`, { body: { to: n } }))}>{p.states.find((s) => s.id === n)?.label ?? n}</Button>)}
                </div>
            )}
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
                {(DATA_FIELDS[p.type] ?? []).map((f) => (
                    <Field key={f.key} label={f.label}>
                        {f.type === "textarea" ? <Textarea className="min-h-[70px]" value={data[f.key]} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} /> : <Input type={f.type} value={data[f.key]} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />}
                    </Field>
                ))}
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => run(async () => {
                    const patch: Record<string, unknown> = {};
                    for (const f of DATA_FIELDS[p.type] ?? []) patch[f.key] = f.type === "number" ? (data[f.key] === "" ? null : Number(data[f.key])) : data[f.key] || null;
                    await api(`/api/cases/${caseId}/processes/${p.id}`, { method: "PATCH", body: patch });
                    await api(`/api/cases/${caseId}/deadlines`, { method: "POST", body: {} });
                })}>Save details</Button>
                {(ARTIFACT_FOR[p.type] ?? []).map((a) => (
                    <Button key={a.type} disabled={busy} onClick={() => run(async () => { await api(`/api/cases/${caseId}/artifacts`, { body: { type: a.type, processId: p.id } }); onGenerated(a.label); })}>{a.label}</Button>
                ))}
            </div>

            {p.type === "disciplinary" && (
                <div className="border-t border-line pt-4">
                    <h3 className="mb-2 font-semibold">Allegations</h3>
                    <p className="mb-3 text-sm text-ink-muted">One entry per allegation. Record exactly what the employer says, then your response, the evidence each side has, and what you still need.</p>
                    {p.allegations.length === 0 ? <Empty>No allegations recorded. Add them from the invitation letter, or upload it as a document linked to this process.</Empty> : (
                        <ul className="mb-3 space-y-3">
                            {p.allegations.map((a) => {
                                const ed = editingAllegation[a.id] ?? { workerResponse: a.workerResponse ?? "", workerEvidence: a.workerEvidence ?? "", missingInformation: a.missingInformation ?? "", employerEvidence: a.employerEvidence ?? "", hearingQuestionsText: a.hearingQuestions.join("\n") };
                                return (
                                    <li key={a.id} className="rounded-lg border border-line p-3">
                                        <p className="font-medium">Employer says: {a.employerAllegation} {a.status === "proposed" && <Pill tone="warn">read from document, check it</Pill>}</p>
                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                            <Field label="Employer's evidence"><Textarea className="min-h-[60px]" value={ed.employerEvidence ?? ""} onChange={(e) => setEditingAllegation({ ...editingAllegation, [a.id]: { ...ed, employerEvidence: e.target.value } })} /></Field>
                                            <Field label="Your response"><Textarea className="min-h-[60px]" value={ed.workerResponse ?? ""} onChange={(e) => setEditingAllegation({ ...editingAllegation, [a.id]: { ...ed, workerResponse: e.target.value } })} /></Field>
                                            <Field label="Your evidence"><Textarea className="min-h-[60px]" value={ed.workerEvidence ?? ""} onChange={(e) => setEditingAllegation({ ...editingAllegation, [a.id]: { ...ed, workerEvidence: e.target.value } })} /></Field>
                                            <Field label="Information you still need"><Textarea className="min-h-[60px]" value={ed.missingInformation ?? ""} onChange={(e) => setEditingAllegation({ ...editingAllegation, [a.id]: { ...ed, missingInformation: e.target.value } })} /></Field>
                                            <Field label="Questions for the hearing (one per line)"><Textarea className="min-h-[60px]" value={ed.hearingQuestionsText ?? ""} onChange={(e) => setEditingAllegation({ ...editingAllegation, [a.id]: { ...ed, hearingQuestionsText: e.target.value } })} /></Field>
                                        </div>
                                        <div className="mt-2 flex gap-2">
                                            <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/allegations/${a.id}`, { method: "PATCH", body: { employerEvidence: ed.employerEvidence || null, workerResponse: ed.workerResponse || null, workerEvidence: ed.workerEvidence || null, missingInformation: ed.missingInformation || null, hearingQuestions: (ed.hearingQuestionsText ?? "").split("\n").map((s) => s.trim()).filter(Boolean), status: a.status === "proposed" ? "open" : undefined } }))}>Save</Button>
                                            <Button variant="quiet" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/allegations/${a.id}`, { method: "DELETE" }))}>Remove</Button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <Input placeholder="What the employer alleges" value={allegation.employerAllegation} onChange={(e) => setAllegation({ ...allegation, employerAllegation: e.target.value })} />
                        <Input placeholder="Evidence they rely on (optional)" value={allegation.employerEvidence} onChange={(e) => setAllegation({ ...allegation, employerEvidence: e.target.value })} />
                        <Button variant="secondary" disabled={busy || allegation.employerAllegation.trim().length < 3} onClick={() => run(async () => { await api(`/api/cases/${caseId}/processes/${p.id}/allegations`, { body: { employerAllegation: allegation.employerAllegation, employerEvidence: allegation.employerEvidence || null } }); setAllegation({ employerAllegation: "", employerEvidence: "" }); })}>Add</Button>
                    </div>
                </div>
            )}

            {p.type.endsWith("_appeal") && (
                <div className="border-t border-line pt-4">
                    <h3 className="mb-2 font-semibold">Grounds of appeal</h3>
                    <p className="mb-3 text-sm text-ink-muted">These categories help you organise what went wrong. None of them decides an appeal on its own. Tick the ones to include in the draft.</p>
                    {p.grounds.length > 0 && (
                        <ul className="mb-3 space-y-2">
                            {p.grounds.map((g) => (
                                <li key={g.id} className="flex items-start justify-between gap-2 rounded-lg border border-line p-3">
                                    <label className="flex items-start gap-2">
                                        <input type="checkbox" className="mt-1" checked={g.selected} onChange={(e) => run(() => api(`/api/cases/${caseId}/grounds/${g.id}`, { method: "PATCH", body: { selected: e.target.checked } }))} />
                                        <span><span className="block text-sm font-medium">{APPEAL_GROUND_LABELS[g.category as keyof typeof APPEAL_GROUND_LABELS]?.label ?? g.category}</span><span className="block">{g.summary}</span>{g.detail && <span className="block text-sm text-ink-muted">{g.detail}</span>}</span>
                                    </label>
                                    <Button variant="quiet" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/grounds/${g.id}`, { method: "DELETE" }))}>Remove</Button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Select value={ground.category} onChange={(e) => setGround({ ...ground, category: e.target.value })}>
                            {APPEAL_GROUND_CATEGORIES.map((c) => <option key={c} value={c}>{APPEAL_GROUND_LABELS[c].label}</option>)}
                        </Select>
                        <Input placeholder="In one sentence" value={ground.summary} onChange={(e) => setGround({ ...ground, summary: e.target.value })} />
                        <Textarea className="min-h-[60px] sm:col-span-2" placeholder="Detail and the facts that support it (optional)" value={ground.detail} onChange={(e) => setGround({ ...ground, detail: e.target.value })} />
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{APPEAL_GROUND_LABELS[ground.category as keyof typeof APPEAL_GROUND_LABELS]?.plain}</p>
                    <div className="mt-2"><Button variant="secondary" disabled={busy || ground.summary.trim().length < 3} onClick={() => run(async () => { await api(`/api/cases/${caseId}/processes/${p.id}/grounds`, { body: { category: ground.category, summary: ground.summary, detail: ground.detail || null } }); setGround({ category: "procedural_issue", summary: "", detail: "" }); })}>Add ground</Button></div>
                </div>
            )}
            <p className="mt-3 text-xs text-ink-faint">Generated documents appear under <Link href={`/app/cases/${caseId}/exports`}>Exports</Link>.</p>
        </Card>
    );
}
