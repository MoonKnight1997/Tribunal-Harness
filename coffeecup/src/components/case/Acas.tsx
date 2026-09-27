"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice, Select, Textarea, Pill } from "@/components/ui";
import type { AcasProcessData } from "@/db/schema";
import type { StateDef } from "@/processes/machines";
import { formatLongDate } from "@/lib/dates";

export interface AcasTimeLimitView {
    label: string;
    date: string | null;
    /** calculated | uncertain | pending_acas | expired (presented for today). */
    status: string;
    acasEffect: string | null;
    missing: string[];
    /** The date the limit would have expired without Acas, shown as a floor while conciliation is pending. */
    unadjustedDate: string | null;
    dayBBasis: string | null;
    triggerPrecision: string | null;
}

const STATUS_LABEL: Record<string, string> = {
    calculated: "calculated",
    uncertain: "needs information",
    pending_acas: "paused for Acas",
    expired: "appears to have passed",
    stale: "being recalculated",
};

function statusTone(status: string): "ok" | "warn" | "urgent" | "accent" {
    if (status === "expired") return "urgent";
    if (status === "uncertain") return "warn";
    if (status === "pending_acas") return "accent";
    return "ok";
}

export function Acas({ caseId, process, states, timeLimits }: { caseId: string; process: { id: string; state: string; data: AcasProcessData } | null; states: StateDef[]; timeLimits: AcasTimeLimitView[] }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const d = process?.data ?? {};
    const [form, setForm] = useState({
        notificationDate: d.notificationDate ?? "",
        reference: d.reference ?? "",
        conciliatorName: d.conciliatorName ?? "",
        conciliatorContact: d.conciliatorContact ?? "",
        certificateStatus: d.certificateStatus ?? "not_started",
        certificateIssueDate: d.certificateIssueDate ?? "",
        certificateReceivedDate: d.certificateReceivedDate ?? "",
        certificateDeliveryMethod: d.certificateDeliveryMethod ?? "unknown",
        certificateNumber: d.certificateNumber ?? "",
        keyIssues: (d.preparation?.keyIssues ?? []).join("\n"),
        stepsTaken: (d.preparation?.stepsTaken ?? []).join("\n"),
        moneyIssues: d.preparation?.moneyIssues ?? "",
        desiredResolution: d.preparation?.desiredResolution ?? "",
        questionsToClarify: (d.preparation?.questionsToClarify ?? []).join("\n"),
    });
    const [comm, setComm] = useState({ date: "", direction: "from_acas", summary: "" });
    const [offer, setOffer] = useState({ date: "", from: "employer", amount: "", terms: "" });

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

    const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

    if (!process) {
        return (
            <div className="space-y-4">
                {error && <Notice tone="warn">{error}</Notice>}
                <Card title="Not started yet">
                    <p className="mb-3 text-ink-muted">Start the Acas stage to record your notification date, reference and certificate, and to prepare what you want to say. Time limits are paused between the day Acas receives your notification (Day A) and the day you receive the certificate (Day B).</p>
                    <Button disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/processes`, { body: { type: "acas_early_conciliation" } }))}>Start the Acas stage</Button>
                    <p className="mt-3 text-sm"><Link href="/help/acas-early-conciliation">Read about Early Conciliation first</Link></p>
                </Card>
            </div>
        );
    }

    const def = states.find((s) => s.id === process.state);
    return (
        <div className="space-y-5">
            {error && <Notice tone="warn">{error}</Notice>}
            <Card title="Where this is" aside={<Pill tone="accent">{def?.label ?? process.state}</Pill>}>
                <p className="mb-3 text-ink-muted">{def?.plain}</p>
                {def && def.next.length > 0 && <div className="flex flex-wrap gap-2">{def.next.map((n) => <Button key={n} variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/processes/${process.id}/transition`, { body: { to: n } }))}>{states.find((s) => s.id === n)?.label ?? n}</Button>)}</div>}
            </Card>
            <Card title="Your tribunal time limits, with Acas taken into account">
                <ul className="space-y-3">
                    {timeLimits.map((t) => (
                        <li key={t.label}>
                            <span className="font-medium">{t.label}:</span>{" "}
                            {t.status === "pending_acas" ? "paused for Acas conciliation" : t.date ? formatLongDate(t.date) : "not yet calculable"}{" "}
                            <Pill tone={statusTone(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</Pill>
                            {t.triggerPrecision && t.triggerPrecision !== "exact" && <Pill tone="warn">approximate date</Pill>}
                            {t.status === "pending_acas" && t.unadjustedDate && (
                                <span className="block text-sm">
                                    The extended deadline can&apos;t be worked out until you add the certificate date. It will be <strong>no earlier than {formatLongDate(t.unadjustedDate)}</strong> (the date it would have expired without Acas).
                                </span>
                            )}
                            {t.acasEffect && <span className="block text-sm text-ink-muted">{t.acasEffect}</span>}
                            {t.dayBBasis === "issue_date_assumed" && <span className="block text-sm text-ink-muted">Day B has been taken as the date on the certificate. If you received it later, add that date below: the deadline can only move later, never earlier.</span>}
                            {t.missing.length > 0 && <span className="block text-sm text-warn">Needed: {t.missing.join(" ")}</span>}
                        </li>
                    ))}
                </ul>
                <p className="mt-2 text-sm"><Link href={`/app/cases/${caseId}/dates`}>See the full calculation</Link></p>
            </Card>
            <Card title="Acas details">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Date Acas received your notification (Day A)" hint="The day Acas received your Early Conciliation form or call. The time limit is paused from the day after this."><Input type="date" value={form.notificationDate} onChange={(e) => setForm({ ...form, notificationDate: e.target.value })} /></Field>
                    <Field label="Acas reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
                    <Field label="Conciliator (optional)"><Input value={form.conciliatorName} onChange={(e) => setForm({ ...form, conciliatorName: e.target.value })} /></Field>
                    <Field label="Conciliator contact (optional)"><Input value={form.conciliatorContact} onChange={(e) => setForm({ ...form, conciliatorContact: e.target.value })} /></Field>
                    <Field label="Certificate">
                        <Select value={form.certificateStatus} onChange={(e) => setForm({ ...form, certificateStatus: e.target.value as NonNullable<AcasProcessData["certificateStatus"]> })}>
                            <option value="not_started">Not started</option>
                            <option value="in_progress">Conciliation in progress</option>
                            <option value="issued">Certificate issued</option>
                            <option value="not_required">Not required for my claim</option>
                        </Select>
                    </Field>
                    <Field label="Certificate number"><Input value={form.certificateNumber} onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })} /></Field>
                    <Field label="Date on the certificate (issue date)" hint="The date printed on the certificate. This is not necessarily Day B."><Input type="date" value={form.certificateIssueDate} onChange={(e) => setForm({ ...form, certificateIssueDate: e.target.value })} /></Field>
                    <Field label="Date you received the certificate (if different)" hint="Day B is the day you received, or are treated as receiving, the certificate. The pause ends on Day B. Leave blank if it is the same as the date on the certificate."><Input type="date" value={form.certificateReceivedDate} onChange={(e) => setForm({ ...form, certificateReceivedDate: e.target.value })} /></Field>
                    <Field label="How it was sent" hint="Email counts as received the day it is sent. If posted and you do not know when it arrived, we use the date on the certificate, which is the cautious choice.">
                        <Select value={form.certificateDeliveryMethod} onChange={(e) => setForm({ ...form, certificateDeliveryMethod: e.target.value as NonNullable<AcasProcessData["certificateDeliveryMethod"]> })}>
                            <option value="unknown">Not sure</option>
                            <option value="email">Email</option>
                            <option value="post">Post</option>
                        </Select>
                    </Field>
                </div>
                <div className="mt-4">
                    <Button
                        disabled={busy}
                        onClick={() =>
                            run(() =>
                                api(`/api/cases/${caseId}/processes/${process.id}`, {
                                    method: "PATCH",
                                    body: {
                                        notificationDate: form.notificationDate || null,
                                        reference: form.reference || null,
                                        conciliatorName: form.conciliatorName || null,
                                        conciliatorContact: form.conciliatorContact || null,
                                        certificateStatus: form.certificateStatus ?? "not_started",
                                        certificateIssueDate: form.certificateIssueDate || null,
                                        certificateReceivedDate: form.certificateReceivedDate || null,
                                        certificateDeliveryMethod: form.certificateDeliveryMethod || "unknown",
                                        certificateNumber: form.certificateNumber || null,
                                    },
                                }),
                            )
                        }
                    >
                        Save Acas details
                    </Button>
                </div>
            </Card>
            <Card title="Prepare for the conversation">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Key issues (one per line)"><Textarea value={form.keyIssues} onChange={(e) => setForm({ ...form, keyIssues: e.target.value })} /></Field>
                    <Field label="Steps already taken (one per line)"><Textarea value={form.stepsTaken} onChange={(e) => setForm({ ...form, stepsTaken: e.target.value })} /></Field>
                    <Field label="Money issues" hint="Unpaid wages, notice, losses. Amounts if you know them."><Textarea className="min-h-[80px]" value={form.moneyIssues} onChange={(e) => setForm({ ...form, moneyIssues: e.target.value })} /></Field>
                    <Field label="What you want"><Textarea className="min-h-[80px]" value={form.desiredResolution} onChange={(e) => setForm({ ...form, desiredResolution: e.target.value })} /></Field>
                    <Field label="Questions to clarify (one per line)"><Textarea value={form.questionsToClarify} onChange={(e) => setForm({ ...form, questionsToClarify: e.target.value })} /></Field>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/processes/${process.id}`, { method: "PATCH", body: { preparation: { keyIssues: lines(form.keyIssues), stepsTaken: lines(form.stepsTaken), moneyIssues: form.moneyIssues || null, desiredResolution: form.desiredResolution || null, questionsToClarify: lines(form.questionsToClarify) } } }))}>Save preparation</Button>
                    <Button disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/artifacts`, { body: { type: "acas_preparation", processId: process.id, extra: { preparation: { keyIssues: lines(form.keyIssues), stepsTaken: lines(form.stepsTaken), moneyIssues: form.moneyIssues, desiredResolution: form.desiredResolution, questionsToClarify: lines(form.questionsToClarify) } } } }))}>Generate preparation note</Button>
                </div>
            </Card>
            <Card title="Communications and offers">
                {(d.communications ?? []).length > 0 && (
                    <ul className="mb-3 space-y-1 text-[15px]">
                        {(d.communications ?? []).map((c, i) => <li key={i}><span className="text-ink-muted">{c.date} · {c.direction.replace(/_/g, " ")}:</span> {c.summary}</li>)}
                    </ul>
                )}
                <div className="mb-4 grid gap-2 sm:grid-cols-[150px_150px_1fr_auto]">
                    <Input type="date" value={comm.date} onChange={(e) => setComm({ ...comm, date: e.target.value })} />
                    <Select value={comm.direction} onChange={(e) => setComm({ ...comm, direction: e.target.value })}>
                        <option value="from_acas">From Acas</option>
                        <option value="to_acas">To Acas</option>
                        <option value="employer">Employer</option>
                    </Select>
                    <Input placeholder="Summary" value={comm.summary} onChange={(e) => setComm({ ...comm, summary: e.target.value })} />
                    <Button variant="secondary" disabled={busy || !comm.date || !comm.summary} onClick={() => run(async () => { await api(`/api/cases/${caseId}/processes/${process.id}`, { method: "PATCH", body: { communications: [...(d.communications ?? []), comm] } }); setComm({ date: "", direction: "from_acas", summary: "" }); })}>Add</Button>
                </div>
                {(d.offers ?? []).length > 0 && (
                    <ul className="mb-3 space-y-1 text-[15px]">
                        {(d.offers ?? []).map((o, i) => <li key={i}><span className="text-ink-muted">{o.date} · {o.from}:</span> {o.amount ? `${o.amount} — ` : ""}{o.terms} <Pill>{o.status}</Pill></li>)}
                    </ul>
                )}
                <div className="grid gap-2 sm:grid-cols-[150px_130px_120px_1fr_auto]">
                    <Input type="date" value={offer.date} onChange={(e) => setOffer({ ...offer, date: e.target.value })} />
                    <Select value={offer.from} onChange={(e) => setOffer({ ...offer, from: e.target.value })}>
                        <option value="employer">Employer</option>
                        <option value="worker">Me</option>
                    </Select>
                    <Input placeholder="Amount" value={offer.amount} onChange={(e) => setOffer({ ...offer, amount: e.target.value })} />
                    <Input placeholder="Terms" value={offer.terms} onChange={(e) => setOffer({ ...offer, terms: e.target.value })} />
                    <Button variant="secondary" disabled={busy || !offer.date || !offer.terms} onClick={() => run(async () => { await api(`/api/cases/${caseId}/processes/${process.id}`, { method: "PATCH", body: { offers: [...(d.offers ?? []), { ...offer, status: "open" }] } }); setOffer({ date: "", from: "employer", amount: "", terms: "" }); })}>Add offer</Button>
                </div>
            </Card>
        </div>
    );
}
