"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice, Select, Textarea, Pill, Empty } from "@/components/ui";
import type { EmploymentRow, PersonRow } from "@/cases/service";
import type { IssueRow } from "@/issues/service";

type FactView = { id: string; statement: string; provenance: string; status: string; disputed: boolean; key: string | null; value: string | null; createdAt: string; updatedAt: string };

const PROVENANCE_LABEL: Record<string, string> = {
    USER_CONFIRMED: "confirmed by you",
    DOCUMENT_EXTRACTED: "read from a document (unconfirmed)",
    DOCUMENT_CONFIRMED: "from a document, confirmed by you",
    EMPLOYER_ALLEGATION: "employer's allegation",
    USER_ALLEGATION: "your account",
    MODEL_INFERENCE: "suggested (unconfirmed)",
    LEGAL_SOURCE: "legal source",
    DISPUTED: "disputed",
    UNKNOWN: "unknown",
};

export function CaseDetails({ caseId, caseRow, employment, people, issues, facts }: { caseId: string; caseRow: { title: string; jurisdiction: string }; employment: EmploymentRow; people: PersonRow[]; issues: IssueRow[]; facts: FactView[] }) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [title, setTitle] = useState(caseRow.title);
    const [jurisdiction, setJurisdiction] = useState(caseRow.jurisdiction);
    const [emp, setEmp] = useState({
        employerName: employment.employerName ?? "",
        respondentLegalEntity: employment.respondentLegalEntity ?? "",
        respondentAddress: employment.respondentAddress ?? "",
        jobTitle: employment.jobTitle ?? "",
        employmentStatus: employment.employmentStatus ?? "",
        startDate: employment.startDate ?? "",
        endDate: employment.endDate ?? "",
        stillEmployed: employment.stillEmployed === null ? "" : employment.stillEmployed ? "yes" : "no",
        payAmount: employment.payAmount ?? "",
        payPeriod: employment.payPeriod ?? "",
        hoursPerWeek: employment.hoursPerWeek ?? "",
        workplace: employment.workplace ?? "",
    });
    const [person, setPerson] = useState({ name: "", role: "manager", organisation: "" });
    const [issue, setIssue] = useState({ title: "", category: "other", description: "", desiredResolution: "" });
    const [fact, setFact] = useState({ statement: "", disputed: false });
    const [editingFact, setEditingFact] = useState<{ id: string; statement: string; value: string } | null>(null);

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

    const saveEmployment = () =>
        run(async () => {
            await api(`/api/cases/${caseId}`, { method: "PATCH", body: { title, jurisdiction } });
            await api(`/api/cases/${caseId}/employment`, {
                method: "PATCH",
                body: {
                    employerName: emp.employerName || null,
                    respondentLegalEntity: emp.respondentLegalEntity || null,
                    respondentAddress: emp.respondentAddress || null,
                    jobTitle: emp.jobTitle || null,
                    employmentStatus: emp.employmentStatus || null,
                    startDate: emp.startDate || null,
                    endDate: emp.endDate || null,
                    stillEmployed: emp.stillEmployed === "" ? null : emp.stillEmployed === "yes",
                    payAmount: emp.payAmount || null,
                    payPeriod: emp.payPeriod || null,
                    hoursPerWeek: emp.hoursPerWeek || null,
                    workplace: emp.workplace || null,
                },
            });
            if (emp.startDate) await api(`/api/cases/${caseId}/facts/structured/employment_start`, { method: "PUT", body: { value: emp.startDate, statement: `I started work on ${emp.startDate}.` } });
            if (emp.stillEmployed === "no" && emp.endDate) await api(`/api/cases/${caseId}/facts/structured/dismissal_date`, { method: "PUT", body: { value: emp.endDate, statement: `My employment ended on ${emp.endDate}.` } });
            await api(`/api/cases/${caseId}/deadlines`, { method: "POST", body: {} });
        });

    const e = <K extends keyof typeof emp>(k: K) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setEmp((s) => ({ ...s, [k]: ev.target.value }));

    return (
        <div className="space-y-5">
            {error && <Notice tone="warn">{error}</Notice>}
            <Card title="Employment">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Case name"><Input value={title} onChange={(ev) => setTitle(ev.target.value)} /></Field>
                    <Field label="Where you work">
                        <Select value={jurisdiction} onChange={(ev) => setJurisdiction(ev.target.value)}>
                            <option value="england_wales">England or Wales</option>
                            <option value="scotland">Scotland</option>
                            <option value="northern_ireland">Northern Ireland</option>
                        </Select>
                    </Field>
                    <Field label="Employer name"><Input value={emp.employerName} onChange={e("employerName")} /></Field>
                    <Field label="Employer's legal name" hint="As on your contract or payslip; needed for a tribunal claim."><Input value={emp.respondentLegalEntity} onChange={e("respondentLegalEntity")} /></Field>
                    <Field label="Employer's address"><Input value={emp.respondentAddress} onChange={e("respondentAddress")} /></Field>
                    <Field label="Job title"><Input value={emp.jobTitle} onChange={e("jobTitle")} /></Field>
                    <Field label="Your status">
                        <Select value={emp.employmentStatus} onChange={e("employmentStatus")}>
                            <option value="">Not sure</option>
                            <option value="employee">Employee</option>
                            <option value="worker">Worker</option>
                            <option value="agency">Agency worker</option>
                            <option value="self_employed">Self-employed</option>
                            <option value="unsure">Unsure</option>
                        </Select>
                    </Field>
                    <Field label="Still employed?">
                        <Select value={emp.stillEmployed} onChange={e("stillEmployed")}>
                            <option value="">Not sure</option>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                        </Select>
                    </Field>
                    <Field label="Start date"><Input type="date" value={emp.startDate} onChange={e("startDate")} /></Field>
                    <Field label="End date (if it ended)" hint="Drives the tribunal time limit."><Input type="date" value={emp.endDate} onChange={e("endDate")} /></Field>
                    <Field label="Pay (before tax)"><Input value={emp.payAmount} onChange={e("payAmount")} placeholder="e.g. 2100" /></Field>
                    <Field label="Pay period"><Input value={emp.payPeriod} onChange={e("payPeriod")} placeholder="month / week / hour" /></Field>
                    <Field label="Hours per week"><Input value={emp.hoursPerWeek} onChange={e("hoursPerWeek")} /></Field>
                    <Field label="Workplace"><Input value={emp.workplace} onChange={e("workplace")} /></Field>
                </div>
                <div className="mt-4"><Button onClick={saveEmployment} disabled={busy}>Save details</Button></div>
            </Card>

            <Card title="People involved">
                {people.length === 0 ? <Empty>No one added yet. Managers, HR, witnesses and representatives go here.</Empty> : (
                    <ul className="mb-4 space-y-1">
                        {people.map((p) => (
                            <li key={p.id} className="flex items-center justify-between gap-2 text-[15px]">
                                <span>{p.name} <span className="text-ink-muted">· {p.role}{p.organisation ? `, ${p.organisation}` : ""}</span></span>
                                <Button variant="quiet" onClick={() => run(() => api(`/api/cases/${caseId}/people/${p.id}`, { method: "DELETE" }))}>Remove</Button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="grid gap-3 sm:grid-cols-[1fr_160px_1fr_auto]">
                    <Input placeholder="Name" value={person.name} onChange={(ev) => setPerson({ ...person, name: ev.target.value })} />
                    <Select value={person.role} onChange={(ev) => setPerson({ ...person, role: ev.target.value })}>
                        {["manager", "hr", "witness", "representative", "colleague", "conciliator", "other"].map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                    <Input placeholder="Organisation (optional)" value={person.organisation} onChange={(ev) => setPerson({ ...person, organisation: ev.target.value })} />
                    <Button variant="secondary" disabled={busy || !person.name.trim()} onClick={() => run(async () => { await api(`/api/cases/${caseId}/people`, { body: { name: person.name, role: person.role, organisation: person.organisation || null } }); setPerson({ name: "", role: "manager", organisation: "" }); })}>Add</Button>
                </div>
            </Card>

            <Card title="What this is about">
                {issues.length === 0 ? <Empty>Add each issue separately: what happened and what you want to happen.</Empty> : (
                    <ul className="mb-4 space-y-2">
                        {issues.map((i) => (
                            <li key={i.id} className="rounded-lg border border-line p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="font-medium">{i.title} <Pill>{i.category.replace(/_/g, " ")}</Pill></p>
                                        {i.description && <p className="text-sm text-ink-muted">{i.description}</p>}
                                        {i.desiredResolution && <p className="text-sm">Wanted: {i.desiredResolution}</p>}
                                    </div>
                                    <Button variant="quiet" onClick={() => run(() => api(`/api/cases/${caseId}/issues/${i.id}`, { method: "DELETE" }))}>Remove</Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Issue"><Input value={issue.title} onChange={(ev) => setIssue({ ...issue, title: ev.target.value })} placeholder="e.g. Shift changes without notice" /></Field>
                    <Field label="Category">
                        <Select value={issue.category} onChange={(ev) => setIssue({ ...issue, category: ev.target.value })}>
                            {["dismissal", "redundancy", "discrimination", "disability_adjustments", "whistleblowing", "pay", "contract_change", "disciplinary", "grievance", "appeal", "other"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                        </Select>
                    </Field>
                    <Field label="What happened (optional)"><Textarea value={issue.description} onChange={(ev) => setIssue({ ...issue, description: ev.target.value })} className="min-h-[80px]" /></Field>
                    <Field label="What you want to happen"><Textarea value={issue.desiredResolution} onChange={(ev) => setIssue({ ...issue, desiredResolution: ev.target.value })} className="min-h-[80px]" /></Field>
                </div>
                <div className="mt-3"><Button variant="secondary" disabled={busy || !issue.title.trim()} onClick={() => run(async () => { await api(`/api/cases/${caseId}/issues`, { body: { title: issue.title, category: issue.category, description: issue.description || null, desiredResolution: issue.desiredResolution || null } }); setIssue({ title: "", category: "other", description: "", desiredResolution: "" }); })}>Add issue</Button></div>
            </Card>

            <Card title="Facts">
                <p className="mb-3 text-sm text-ink-muted">Every fact shows where it came from. Only confirmed facts are used to draft documents or analyse claims.</p>
                {facts.filter((f) => f.status !== "superseded" && f.status !== "rejected").length === 0 ? <Empty>No facts yet.</Empty> : (
                    <ul className="mb-4 space-y-2">
                        {facts.filter((f) => f.status !== "superseded" && f.status !== "rejected").map((f) => (
                            <li key={f.id} className="rounded-lg border border-line p-3">
                                {editingFact?.id === f.id ? (
                                    <div className="space-y-2">
                                        <Textarea value={editingFact.statement} onChange={(ev) => setEditingFact({ ...editingFact, statement: ev.target.value })} className="min-h-[70px]" />
                                        {f.key && <Input type="date" value={editingFact.value} onChange={(ev) => setEditingFact({ ...editingFact, value: ev.target.value })} />}
                                        <div className="flex gap-2">
                                            <Button disabled={busy} onClick={() => run(async () => { await api(`/api/cases/${caseId}/facts/${f.id}/correct`, { body: { statement: editingFact.statement, value: f.key ? editingFact.value : undefined } }); setEditingFact(null); })}>Save correction</Button>
                                            <Button variant="secondary" onClick={() => setEditingFact(null)}>Cancel</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p>{f.statement}</p>
                                            <p className="text-xs text-ink-muted">
                                                <Pill tone={f.status === "confirmed" ? "ok" : "warn"}>{f.status}</Pill> {PROVENANCE_LABEL[f.provenance] ?? f.provenance}{f.disputed ? " · disputed" : ""}{f.key ? ` · ${f.key.replace(/_/g, " ")}: ${f.value}` : ""}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 gap-1">
                                            {f.status === "proposed" && <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/facts/${f.id}/confirm`, { method: "POST", body: {} }))}>Confirm</Button>}
                                            <Button variant="quiet" onClick={() => setEditingFact({ id: f.id, statement: f.statement, value: f.value ?? "" })}>Correct</Button>
                                            <Button variant="quiet" disabled={busy} onClick={() => run(() => api(`/api/cases/${caseId}/facts/${f.id}/reject`, { method: "POST", body: {} }))}>Remove</Button>
                                        </div>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                <Field label="Add a fact" hint="One thing you know happened, in your own words.">
                    <Textarea value={fact.statement} onChange={(ev) => setFact({ ...fact, statement: ev.target.value })} className="min-h-[70px]" />
                </Field>
                <label className="mt-2 flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={fact.disputed} onChange={(ev) => setFact({ ...fact, disputed: ev.target.checked })} /> The employer disputes this</label>
                <div className="mt-3"><Button variant="secondary" disabled={busy || fact.statement.trim().length < 3} onClick={() => run(async () => { await api(`/api/cases/${caseId}/facts`, { body: { statement: fact.statement, disputed: fact.disputed, status: "confirmed" } }); setFact({ statement: "", disputed: false }); })}>Add fact</Button></div>
            </Card>
        </div>
    );
}
