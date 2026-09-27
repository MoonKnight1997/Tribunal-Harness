"use client";

/**
 * Evidence inbox — review everything read from documents in one place, with
 * the source passage beside each item.
 *
 * Layout: two panes from 900 px (list left, source excerpt right); stacked on
 * narrower screens, where the excerpt sits directly under the selected item.
 * Keyboard: j/k or arrow keys move, c confirms (or records an allegation),
 * r rejects (or withdraws), e opens the edit form, ? lists the shortcuts.
 * Every action is also a plain button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice, Pill, Textarea, cx } from "@/components/ui";
import { formatLongDate } from "@/lib/dates";
import type { ReviewItem, ReviewQueue } from "@/review/types";

const PROVENANCE_TONE: Record<ReviewItem["provenanceLabel"], "accent" | "warn" | "neutral" | "ok"> = {
    "The document says": "accent",
    "The employer alleges": "warn",
    "The model inferred": "neutral",
    "You said": "ok",
};

type EventForm = { date: string; dateApproximate: boolean; title: string; description: string };
type FactForm = { statement: string; value: string };

function isTypingTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

function itemsLeft(n: number): string {
    return n === 0 ? "Nothing left to review" : n === 1 ? "1 item left" : `${n} items left`;
}

export function EvidenceInbox({ caseId, initial }: { caseId: string; initial: ReviewQueue }) {
    const router = useRouter();
    const [queue, setQueue] = useState<ReviewQueue>(initial);
    const [selected, setSelected] = useState(0);
    const [editing, setEditing] = useState<string | null>(null);
    const [eventForm, setEventForm] = useState<EventForm>({ date: "", dateApproximate: false, title: "", description: "" });
    const [factForm, setFactForm] = useState<FactForm>({ statement: "", value: "" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [announce, setAnnounce] = useState("");
    const [showHelp, setShowHelp] = useState(false);
    const [finished, setFinished] = useState(initial.items.length === 0);
    const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

    const items = queue.items;
    const current: ReviewItem | undefined = items[selected];
    const base = `/api/cases/${caseId}`;

    // Keep the selection in range and focused as the list changes.
    useEffect(() => {
        if (selected > items.length - 1) setSelected(Math.max(0, items.length - 1));
    }, [items.length, selected]);
    useEffect(() => {
        optionRefs.current[selected]?.focus({ preventScroll: false });
    }, [selected, items.length]);

    const refresh = useCallback(async () => {
        const q = await api<ReviewQueue>(`${base}/review`);
        setQueue(q);
        setAnnounce(itemsLeft(q.remaining));
        if (q.remaining === 0) setFinished(true);
        router.refresh(); // nav badge and other pages
    }, [base, router]);

    const run = useCallback(
        async (fn: () => Promise<unknown>) => {
            if (busy) return;
            setBusy(true);
            setError(null);
            try {
                await fn();
                setEditing(null);
                await refresh();
            } catch (err) {
                setError(errorMessage(err));
            } finally {
                setBusy(false);
            }
        },
        [busy, refresh],
    );

    const confirm = useCallback(
        (item: ReviewItem) => {
            if (item.kind === "event") return run(() => api(`${base}/events/${item.id}/confirm`, { method: "POST", body: {} }));
            if (item.kind === "fact") return run(() => api(`${base}/facts/${item.id}/confirm`, { method: "POST", body: {} }));
            return run(() => api(`${base}/allegations/${item.id}/accept`, { method: "POST", body: {} }));
        },
        [base, run],
    );
    const reject = useCallback(
        (item: ReviewItem) => {
            if (item.kind === "event") return run(() => api(`${base}/events/${item.id}/reject`, { method: "POST", body: {} }));
            if (item.kind === "fact") return run(() => api(`${base}/facts/${item.id}/reject`, { method: "POST", body: {} }));
            return run(() => api(`${base}/allegations/${item.id}/withdraw`, { method: "POST", body: {} }));
        },
        [base, run],
    );
    const startEdit = useCallback((item: ReviewItem) => {
        if (item.kind === "allegation") return;
        if (item.kind === "event") setEventForm({ date: item.date ?? "", dateApproximate: item.datePrecision === "approximate", title: item.title, description: item.detail ?? "" });
        else setFactForm({ statement: item.title, value: item.factValue ?? "" });
        setEditing(item.id);
    }, []);
    const saveEdit = useCallback(
        (item: ReviewItem) => {
            if (item.kind === "event") {
                return run(() => api(`${base}/events/${item.id}`, { method: "PATCH", body: { date: eventForm.date, dateApproximate: eventForm.dateApproximate, title: eventForm.title, description: eventForm.description || null } }));
            }
            return run(() => api(`${base}/facts/${item.id}/correct`, { method: "POST", body: { statement: factForm.statement, value: item.factKey ? factForm.value || null : undefined } }));
        },
        [base, run, eventForm, factForm],
    );

    // Keyboard shortcuts. Not active while typing in a field or editing.
    useEffect(() => {
        function onKey(ev: KeyboardEvent) {
            if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
            if (ev.key === "Escape") {
                setEditing(null);
                setShowHelp(false);
                return;
            }
            if (isTypingTarget(ev.target) || editing) return;
            if (ev.key === "?") {
                ev.preventDefault();
                setShowHelp((s) => !s);
                return;
            }
            if (items.length === 0) return;
            switch (ev.key) {
                case "j":
                case "ArrowDown":
                    ev.preventDefault();
                    setSelected((i) => Math.min(items.length - 1, i + 1));
                    break;
                case "k":
                case "ArrowUp":
                    ev.preventDefault();
                    setSelected((i) => Math.max(0, i - 1));
                    break;
                case "c":
                    ev.preventDefault();
                    if (current) void confirm(current);
                    break;
                case "r":
                    ev.preventDefault();
                    if (current) void reject(current);
                    break;
                case "e":
                    ev.preventDefault();
                    if (current) startEdit(current);
                    break;
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [items.length, current, editing, confirm, reject, startEdit]);

    const countLine = useMemo(() => {
        const parts: string[] = [];
        if (queue.byKind.events) parts.push(`${queue.byKind.events} event${queue.byKind.events === 1 ? "" : "s"}`);
        if (queue.byKind.facts) parts.push(`${queue.byKind.facts} fact${queue.byKind.facts === 1 ? "" : "s"}`);
        if (queue.byKind.allegations) parts.push(`${queue.byKind.allegations} allegation${queue.byKind.allegations === 1 ? "" : "s"}`);
        return parts.join(" · ");
    }, [queue.byKind]);

    const excerptPanel = (item: ReviewItem | undefined, id: string) => (
        <Card title="Where this came from" className="min-w-0">
            {!item ? (
                <p className="text-sm text-ink-muted">Select an item to see the passage it came from.</p>
            ) : !item.source.filename ? (
                <p className="text-sm text-ink-muted">This item is not linked to a document.</p>
            ) : (
                <div className="min-w-0">
                    <p className="mb-2 break-words text-sm text-ink-muted">
                        {item.source.filename}
                        {item.source.page ? ` · page ${item.source.page}` : ""}
                    </p>
                    {item.source.excerpt ? (
                        <blockquote id={id} data-testid="excerpt" className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border-l-4 border-accent bg-surface-muted px-4 py-3 text-[15px] leading-relaxed">
                            {item.source.excerpt.before}
                            <mark className="rounded bg-warn-soft px-0.5 text-ink outline outline-1 outline-warn/40">{item.source.excerpt.match}</mark>
                            {item.source.excerpt.after}
                        </blockquote>
                    ) : (
                        <Notice tone="warn">We could not find this passage in the document. Open the file and read the original carefully before you decide.</Notice>
                    )}
                    {item.source.quote && item.source.excerpt && item.source.quote.trim().toLowerCase() !== item.source.excerpt.match.trim().toLowerCase() && (
                        <p className="mt-2 text-xs text-ink-faint">Recorded quote: “{item.source.quote}”</p>
                    )}
                </div>
            )}
        </Card>
    );

    if (finished && items.length === 0) {
        return (
            <div className="space-y-4">
                <p className="sr-only" aria-live="polite" data-testid="review-announce">{announce}</p>
                <Notice tone="ok" title="All reviewed">
                    <p>There is nothing waiting for your decision. Confirmed events are on your timeline; confirmed facts are in your case record.</p>
                    <p className="mt-2 flex flex-wrap gap-4">
                        <Link href={`/app/cases/${caseId}/timeline`}>Go to the timeline</Link>
                        <Link href={`/app/cases/${caseId}/case`}>Go to My case</Link>
                    </p>
                </Notice>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <p className="sr-only" aria-live="polite" data-testid="review-announce">{announce}</p>
            {error && <Notice tone="warn">{error}</Notice>}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px]">
                    <strong data-testid="remaining-count">{itemsLeft(queue.remaining)}</strong>
                    {countLine && <span className="text-ink-muted"> · {countLine}</span>}
                </p>
                <Button variant="quiet" onClick={() => setShowHelp((s) => !s)} aria-expanded={showHelp} aria-controls="review-shortcuts">
                    Keyboard shortcuts
                </Button>
            </div>
            {showHelp && (
                <Card className="text-sm" title="Keyboard shortcuts">
                    <dl id="review-shortcuts" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                        <dt><kbd>j</kbd> / <kbd>↓</kbd></dt><dd>Next item</dd>
                        <dt><kbd>k</kbd> / <kbd>↑</kbd></dt><dd>Previous item</dd>
                        <dt><kbd>c</kbd></dt><dd>Confirm (or record as the employer&apos;s allegation)</dd>
                        <dt><kbd>e</kbd></dt><dd>Edit and confirm</dd>
                        <dt><kbd>r</kbd></dt><dd>Reject (or remove an allegation)</dd>
                        <dt><kbd>?</kbd></dt><dd>Show or hide this list</dd>
                        <dt><kbd>Esc</kbd></dt><dd>Close the edit form</dd>
                    </dl>
                </Card>
            )}

            <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] min-[900px]:items-start">
                <ul role="listbox" aria-label="Items to review" aria-activedescendant={current ? `review-item-${current.id}` : undefined} className="m-0 min-w-0 list-none space-y-3 p-0">
                    {items.map((item, index) => {
                        const isSelected = index === selected;
                        const isEditing = editing === item.id;
                        return (
                            <li
                                key={item.id}
                                id={`review-item-${item.id}`}
                                role="option"
                                aria-selected={isSelected}
                                aria-describedby={isSelected && item.source.excerpt ? `excerpt-inline-${item.id}` : undefined}
                                tabIndex={isSelected ? 0 : -1}
                                ref={(el) => {
                                    optionRefs.current[index] = el;
                                }}
                                onClick={() => setSelected(index)}
                                onFocus={() => setSelected(index)}
                                data-testid="review-item"
                                className={cx("min-w-0 rounded-[var(--radius-card)] border bg-surface p-4 outline-none transition", isSelected ? "border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]" : "border-line hover:border-ink-faint")}
                            >
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <Pill tone={PROVENANCE_TONE[item.provenanceLabel]}>{item.provenanceLabel}</Pill>
                                    <span className="text-ink-muted capitalize">{item.kind}</span>
                                    {item.date && (
                                        <span className="text-ink-muted">
                                            {formatLongDate(item.date)}
                                            {item.datePrecision && item.datePrecision !== "exact" ? " (approximate)" : ""}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1.5 break-words font-medium">{item.title}</p>
                                {item.detail && <p className="mt-0.5 break-words text-sm text-ink-muted">{item.detail}</p>}
                                <p className="mt-1.5 text-xs text-ink-faint">
                                    {item.source.filename
                                        ? item.source.excerpt
                                            ? `Passage found in ${item.source.filename}`
                                            : "Passage not found in the document — read carefully"
                                        : "No source document"}
                                </p>

                                {isSelected && (
                                    <div className="mt-3 space-y-3">
                                        {item.conflicts.map((c, i) => (
                                            <Notice key={i} tone="warn">
                                                <p>{c.message}</p>
                                                {c.kind === "differs_from_confirmed" && (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        <Button variant="secondary" disabled={busy} onClick={() => reject(item)}>
                                                            Keep the confirmed {item.date ? "date" : "value"}{c.confirmedValue ? ` (${/^\d{4}-\d{2}-\d{2}$/.test(c.confirmedValue) ? formatLongDate(c.confirmedValue) : c.confirmedValue})` : ""}
                                                        </Button>
                                                        <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`${base}/facts/${item.id}/adopt`, { method: "POST", body: {} }))}>
                                                            Use this {item.date ? "date" : "value"} instead
                                                        </Button>
                                                    </div>
                                                )}
                                                {c.kind === "possible_duplicate" && c.relatedId && (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`${base}/events/merge`, { body: { keepId: c.relatedId, mergeIds: [item.id] } }))}>
                                                            Merge with the event on the timeline
                                                        </Button>
                                                    </div>
                                                )}
                                            </Notice>
                                        ))}

                                        {/* Phone: the passage sits directly under the item. */}
                                        <div className="min-[900px]:hidden">{excerptPanel(item, `excerpt-inline-${item.id}`)}</div>

                                        {isEditing && item.kind === "event" && (
                                            <div className="rounded-lg border border-line bg-surface-muted p-3">
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <Field label="Date"><Input type="date" value={eventForm.date} onChange={(ev) => setEventForm({ ...eventForm, date: ev.target.value })} /></Field>
                                                    <Field label="What happened"><Input value={eventForm.title} onChange={(ev) => setEventForm({ ...eventForm, title: ev.target.value })} /></Field>
                                                </div>
                                                <div className="mt-3"><Field label="Details (optional)"><Textarea value={eventForm.description} onChange={(ev) => setEventForm({ ...eventForm, description: ev.target.value })} className="min-h-[80px]" /></Field></div>
                                                <label className="mt-2 flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={eventForm.dateApproximate} onChange={(ev) => setEventForm({ ...eventForm, dateApproximate: ev.target.checked })} /> Date is approximate</label>
                                                <div className="mt-3 flex gap-2">
                                                    <Button disabled={busy || !eventForm.date || !eventForm.title.trim()} onClick={() => saveEdit(item)}>Save and confirm</Button>
                                                    <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                                                </div>
                                            </div>
                                        )}
                                        {isEditing && item.kind === "fact" && (
                                            <div className="rounded-lg border border-line bg-surface-muted p-3">
                                                <Field label="Statement"><Textarea value={factForm.statement} onChange={(ev) => setFactForm({ ...factForm, statement: ev.target.value })} className="min-h-[80px]" /></Field>
                                                {item.factKey && (
                                                    <div className="mt-3">
                                                        <Field label={item.factKey.replace(/_/g, " ")} hint={item.date ? "Enter the date as YYYY-MM-DD." : undefined}>
                                                            <Input type={item.date ? "date" : "text"} value={factForm.value} onChange={(ev) => setFactForm({ ...factForm, value: ev.target.value })} />
                                                        </Field>
                                                    </div>
                                                )}
                                                <div className="mt-3 flex gap-2">
                                                    <Button disabled={busy || factForm.statement.trim().length < 3} onClick={() => saveEdit(item)}>Save and confirm</Button>
                                                    <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                                                </div>
                                            </div>
                                        )}

                                        {!isEditing && item.kind !== "allegation" && (
                                            <div className="flex flex-wrap gap-2">
                                                <Button disabled={busy} onClick={() => confirm(item)}>Confirm</Button>
                                                <Button variant="secondary" disabled={busy} onClick={() => startEdit(item)}>Edit and confirm</Button>
                                                <Button variant="quiet" disabled={busy} onClick={() => reject(item)}>Reject</Button>
                                            </div>
                                        )}
                                        {item.kind === "allegation" && (
                                            <div>
                                                <div className="flex flex-wrap gap-2">
                                                    <Button disabled={busy} onClick={() => confirm(item)}>Record as the employer&apos;s allegation</Button>
                                                    <Button variant="quiet" disabled={busy} onClick={() => reject(item)}>Not an allegation — remove</Button>
                                                </div>
                                                <p className="mt-2 text-sm text-ink-muted">Recording an allegation notes what the employer says. It does not mean you agree with it; you respond to it in Workplace process.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {/* Desktop: the passage sits beside the list. */}
                <div className="hidden min-w-0 min-[900px]:sticky min-[900px]:top-4 min-[900px]:block">{excerptPanel(current, "excerpt-side")}</div>
            </div>
        </div>
    );
}
