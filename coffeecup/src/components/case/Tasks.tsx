"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Input, Notice, Select, Pill, Empty } from "@/components/ui";

type TaskView = { id: string; title: string; description: string | null; kind: string; dueDate: string | null; status: string; systemKey: string | null };

export function Tasks({ caseId, tasks }: { caseId: string; tasks: TaskView[] }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({ title: "", kind: "preparation", dueDate: "" });

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

    const open = tasks.filter((t) => t.status === "open");
    const done = tasks.filter((t) => t.status !== "open");
    return (
        <div className="space-y-5">
            {error && <Notice tone="warn">{error}</Notice>}
            <Card title="Add a task">
                <div className="grid gap-2 sm:grid-cols-[1fr_160px_160px_auto]">
                    <Input placeholder="What do you need to do?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                    <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                        {["preparation", "evidence", "procedural", "information", "deadline"].map((k) => <option key={k} value={k}>{k}</option>)}
                    </Select>
                    <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                    <Button variant="secondary" disabled={busy || form.title.trim().length < 2} onClick={() => run(async () => { await api(`/api/cases/${caseId}/tasks`, { body: { title: form.title, kind: form.kind, dueDate: form.dueDate || null } }); setForm({ title: "", kind: "preparation", dueDate: "" }); })}>Add</Button>
                </div>
            </Card>
            <Card title="To do">
                {open.length === 0 ? <Empty>Nothing to do right now.</Empty> : (
                    <ul className="space-y-2">
                        {open.map((t) => (
                            <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-line p-3">
                                <label className="flex items-start gap-3">
                                    <input type="checkbox" className="mt-1" disabled={busy} onChange={() => run(() => api(`/api/cases/${caseId}/tasks/${t.id}`, { method: "PATCH", body: { done: true } }))} />
                                    <span>
                                        <span className="block">{t.title} <Pill tone={t.kind === "deadline" ? "warn" : "neutral"}>{t.kind}</Pill>{t.systemKey && <Pill>suggested</Pill>}</span>
                                        {t.description && <span className="block text-sm text-ink-muted">{t.description}</span>}
                                        {t.dueDate && <span className="block text-sm text-ink-muted">By {t.dueDate}</span>}
                                    </span>
                                </label>
                                {!t.systemKey && <Button variant="quiet" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/tasks/${t.id}`, { method: "DELETE" }))}>Remove</Button>}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
            {done.length > 0 && (
                <Card title="Done">
                    <ul className="space-y-1 text-[15px] text-ink-muted">
                        {done.map((t) => <li key={t.id} className="flex items-center justify-between"><span className="line-through">{t.title}</span><Button variant="quiet" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/tasks/${t.id}`, { method: "PATCH", body: { done: false } }))}>Reopen</Button></li>)}
                    </ul>
                </Card>
            )}
        </div>
    );
}
