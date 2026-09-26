"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice, Select, Textarea, Pill, Empty } from "@/components/ui";
import { EVENT_CATEGORIES } from "@/db/enums";
import { formatLongDate } from "@/lib/dates";

type EventView = {
    id: string; date: string; dateEnd: string | null; dateApproximate: boolean; title: string; description: string | null; category: string;
    actorIds: string[]; sourceDocumentIds: string[]; status: string; userConfirmed: boolean; confidence: number | null; disputed: boolean; provenance: string; mergedIntoId: string | null;
};

const blank = { date: "", dateEnd: "", dateApproximate: false, title: "", description: "", category: "other", disputed: false, sourceDocumentIds: [] as string[], actorIds: [] as string[] };

export function Timeline({ caseId, events, documents, people }: { caseId: string; events: EventView[]; documents: Array<{ id: string; filename: string }>; people: Array<{ id: string; name: string }> }) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState(blank);
    const [editing, setEditing] = useState<string | null>(null);
    const [selected, setSelected] = useState<string[]>([]);

    const proposed = events.filter((e) => e.status === "proposed");
    const confirmed = events.filter((e) => e.status === "confirmed" && !e.mergedIntoId);
    const docName = (id: string) => documents.find((d) => d.id === id)?.filename ?? "document";
    const personName = (id: string) => people.find((p) => p.id === id)?.name ?? "someone";

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

    const body = () => ({ date: form.date, dateEnd: form.dateEnd || null, dateApproximate: form.dateApproximate, title: form.title, description: form.description || null, category: form.category, disputed: form.disputed, sourceDocumentIds: form.sourceDocumentIds, actorIds: form.actorIds });

    function startEdit(e: EventView) {
        setEditing(e.id);
        setForm({ date: e.date, dateEnd: e.dateEnd ?? "", dateApproximate: e.dateApproximate, title: e.title, description: e.description ?? "", category: e.category, disputed: e.disputed, sourceDocumentIds: e.sourceDocumentIds, actorIds: e.actorIds });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    const EventForm = (
        <Card title={editing ? "Edit event" : "Add an event"}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date"><Input type="date" value={form.date} onChange={(ev) => setForm({ ...form, date: ev.target.value })} required /></Field>
                <Field label="End date (if it went on for a while)"><Input type="date" value={form.dateEnd} onChange={(ev) => setForm({ ...form, dateEnd: ev.target.value })} /></Field>
                <Field label="What happened"><Input value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} placeholder="Short title" /></Field>
                <Field label="Category">
                    <Select value={form.category} onChange={(ev) => setForm({ ...form, category: ev.target.value })}>
                        {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                    </Select>
                </Field>
            </div>
            <div className="mt-3"><Field label="Details (optional)"><Textarea value={form.description} onChange={(ev) => setForm({ ...form, description: ev.target.value })} className="min-h-[80px]" /></Field></div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-ink-muted">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.dateApproximate} onChange={(ev) => setForm({ ...form, dateApproximate: ev.target.checked })} /> Date is approximate</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.disputed} onChange={(ev) => setForm({ ...form, disputed: ev.target.checked })} /> The employer disputes this</label>
            </div>
            {(documents.length > 0 || people.length > 0) && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {documents.length > 0 && (
                        <Field label="Linked documents">
                            <div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-line p-2 text-sm">
                                {documents.map((d) => (
                                    <label key={d.id} className="flex items-center gap-2"><input type="checkbox" checked={form.sourceDocumentIds.includes(d.id)} onChange={(ev) => setForm({ ...form, sourceDocumentIds: ev.target.checked ? [...form.sourceDocumentIds, d.id] : form.sourceDocumentIds.filter((x) => x !== d.id) })} /> {d.filename}</label>
                                ))}
                            </div>
                        </Field>
                    )}
                    {people.length > 0 && (
                        <Field label="Who was involved">
                            <div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-line p-2 text-sm">
                                {people.map((p) => (
                                    <label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={form.actorIds.includes(p.id)} onChange={(ev) => setForm({ ...form, actorIds: ev.target.checked ? [...form.actorIds, p.id] : form.actorIds.filter((x) => x !== p.id) })} /> {p.name}</label>
                                ))}
                            </div>
                        </Field>
                    )}
                </div>
            )}
            <div className="mt-4 flex gap-2">
                <Button disabled={busy || !form.date || !form.title.trim()} onClick={() => run(async () => { if (editing) await api(`/api/cases/${caseId}/events/${editing}`, { method: "PATCH", body: body() }); else await api(`/api/cases/${caseId}/events`, { body: body() }); setEditing(null); setForm(blank); })}>{editing ? "Save changes" : "Add event"}</Button>
                {editing && <Button variant="secondary" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</Button>}
            </div>
        </Card>
    );

    return (
        <div className="space-y-5">
            {error && <Notice tone="warn">{error}</Notice>}
            {EventForm}
            {proposed.length > 0 && (
                <Card title={`We found ${proposed.length} possible event${proposed.length === 1 ? "" : "s"} in your documents`}>
                    <p className="mb-3 text-sm text-ink-muted">Check each one. Confirm if it is right, edit if the date or wording is off, or reject it. Nothing here counts until you confirm it.</p>
                    <ul className="space-y-2">
                        {proposed.map((e) => (
                            <li key={e.id} className="rounded-lg border border-warn/40 bg-warn-soft p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="font-medium">{formatLongDate(e.date)}{e.dateApproximate ? " (approx.)" : ""} — {e.title}</p>
                                        {e.description && e.description !== e.title && <p className="text-sm text-ink-muted">{e.description}</p>}
                                        <p className="text-xs text-ink-muted">From {e.sourceDocumentIds.map(docName).join(", ") || "a document"}{e.confidence !== null ? ` · confidence ${e.confidence}%` : ""}</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/events/${e.id}/confirm`, { method: "POST", body: {} }))}>Confirm</Button>
                                        <Button variant="secondary" onClick={() => startEdit(e)}>Edit</Button>
                                        <Button variant="quiet" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/events/${e.id}/reject`, { method: "POST", body: {} }))}>Reject</Button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
            <Card title="Confirmed events" aside={selected.length > 1 ? <Button variant="secondary" disabled={busy} onClick={() => run(async () => { await api(`/api/cases/${caseId}/events/merge`, { body: { keepId: selected[0], mergeIds: selected.slice(1) } }); setSelected([]); })}>Merge {selected.length} into first</Button> : <span className="text-sm text-ink-muted">Tick two or more duplicates to merge</span>}>
                {confirmed.length === 0 ? <Empty>No confirmed events yet.</Empty> : (
                    <ol className="relative space-y-3 border-l border-line pl-5">
                        {confirmed.map((e) => (
                            <li key={e.id} className="relative">
                                <span className="absolute -left-[26px] top-2 h-3 w-3 rounded-full bg-accent" aria-hidden />
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="text-sm text-ink-muted">{formatLongDate(e.date)}{e.dateEnd ? ` to ${formatLongDate(e.dateEnd)}` : ""}{e.dateApproximate ? " (approx.)" : ""} <Pill>{e.category.replace(/_/g, " ")}</Pill>{e.disputed && <Pill tone="warn">disputed</Pill>}</p>
                                        <p className="font-medium">{e.title}</p>
                                        {e.description && e.description !== e.title && <p className="whitespace-pre-line text-sm text-ink-muted">{e.description}</p>}
                                        {(e.sourceDocumentIds.length > 0 || e.actorIds.length > 0) && <p className="text-xs text-ink-faint">{e.sourceDocumentIds.map(docName).join(", ")}{e.sourceDocumentIds.length && e.actorIds.length ? " · " : ""}{e.actorIds.map(personName).join(", ")}</p>}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <input type="checkbox" aria-label="Select for merge" checked={selected.includes(e.id)} onChange={(ev) => setSelected(ev.target.checked ? [...selected, e.id] : selected.filter((x) => x !== e.id))} />
                                        <Button variant="quiet" onClick={() => startEdit(e)}>Edit</Button>
                                        <Button variant="quiet" disabled={busy} onClick={() => { if (confirm("Delete this event?")) run(() => api(`/api/cases/${caseId}/events/${e.id}`, { method: "DELETE" })); }}>Delete</Button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
            </Card>
        </div>
    );
}
