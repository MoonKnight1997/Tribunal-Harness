"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice, Select, Textarea, ButtonLink } from "@/components/ui";
import { ENTRY_ROUTE_LABELS } from "@/cases/stages";
import type { EntryRoute } from "@/db/enums";

interface TriageResult {
    suggestedRoutes: Array<{ route: EntryRoute; label: string; reason: string }>;
    summary: string;
    clarifyingQuestions: string[];
    urgency: { level: "none" | "watch" | "urgent" | "expired"; message: string; deadline: string | null };
    resources: Array<{ name: string; url: string; category: string }>;
    jurisdictionNote: string | null;
}

const ROUTES = Object.entries(ENTRY_ROUTE_LABELS) as Array<[EntryRoute, string]>;

export function TriageForm({ signedIn, restoreDraft = false }: { signedIn: boolean; restoreDraft?: boolean }) {
    const router = useRouter();
    useEffect(() => {
        if (!restoreDraft) return;
        try {
            const raw = sessionStorage.getItem("cc_intake");
            if (!raw) return;
            const d = JSON.parse(raw) as Record<string, unknown>;
            setForm((f) => ({
                ...f,
                jurisdiction: (d.jurisdiction as string) ?? f.jurisdiction,
                entryRoute: (d.entryRoute as EntryRoute) ?? f.entryRoute,
                description: (d.description as string) ?? "",
                stillEmployed: d.stillEmployed === true ? "yes" : d.stillEmployed === false ? "no" : "",
                employmentStatus: (d.employmentStatus as string) ?? "",
                employerName: (d.employerName as string) ?? "",
                startDate: (d.startDate as string) ?? "",
                endDate: (d.endDate as string) ?? "",
                endDateApproximate: !!d.endDateApproximate,
                lastActDate: (d.lastActDate as string) ?? "",
                lastActApproximate: !!d.lastActApproximate,
                acasNotified: !!d.acasNotified,
                acasNotificationDate: (d.acasNotificationDate as string) ?? "",
                acasCertificateDate: (d.acasCertificateDate as string) ?? "",
                acasCertificateNumber: (d.acasCertificateNumber as string) ?? "",
                desiredOutcome: (d.desiredOutcome as string) ?? "",
            }));
            sessionStorage.removeItem("cc_intake");
        } catch {
            /* ignore */
        }
    }, [restoreDraft]);
    const [form, setForm] = useState({
        jurisdiction: "england_wales",
        entryRoute: "not_sure" as EntryRoute,
        description: "",
        stillEmployed: "" as "" | "yes" | "no",
        employmentStatus: "",
        employerName: "",
        startDate: "",
        endDate: "",
        endDateApproximate: false,
        lastActDate: "",
        lastActApproximate: false,
        acasNotified: false,
        acasNotificationDate: "",
        acasCertificateDate: "",
        acasCertificateNumber: "",
        desiredOutcome: "",
    });
    const [result, setResult] = useState<TriageResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [chosenRoute, setChosenRoute] = useState<EntryRoute | null>(null);

    const payload = () => ({
        jurisdiction: form.jurisdiction,
        entryRoute: chosenRoute ?? form.entryRoute,
        description: form.description,
        stillEmployed: form.stillEmployed === "" ? null : form.stillEmployed === "yes",
        employmentStatus: form.employmentStatus || null,
        employerName: form.employerName || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        endDateApproximate: form.endDateApproximate,
        lastActDate: form.lastActDate || null,
        lastActApproximate: form.lastActApproximate,
        acasNotified: form.acasNotified,
        acasNotificationDate: form.acasNotificationDate || null,
        acasCertificateDate: form.acasCertificateDate || null,
        acasCertificateNumber: form.acasCertificateNumber || null,
        desiredOutcome: form.desiredOutcome || null,
    });

    async function runTriage(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const res = await api<TriageResult>("/api/triage", { body: payload() });
            setResult(res);
            setChosenRoute(res.suggestedRoutes[0]?.route ?? form.entryRoute);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    async function createCase() {
        setBusy(true);
        setError(null);
        try {
            if (!signedIn) {
                sessionStorage.setItem("cc_intake", JSON.stringify(payload()));
                router.push("/sign-up?next=/app/cases/new");
                return;
            }
            const res = await api<{ caseId: string }>("/api/cases", { body: { intake: payload() } });
            router.push(`/app/cases/${res.caseId}`);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    }

    const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

    return (
        <div className="space-y-5">
            <form onSubmit={runTriage} className="space-y-5">
                <Card title="Where and what">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Where do you work?">
                            <Select value={form.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)}>
                                <option value="england_wales">England or Wales</option>
                                <option value="scotland">Scotland</option>
                                <option value="northern_ireland">Northern Ireland</option>
                            </Select>
                        </Field>
                        <Field label="What is this about?" hint="Pick the closest, or leave “I’m not sure”.">
                            <Select value={form.entryRoute} onChange={(e) => set("entryRoute", e.target.value as EntryRoute)}>
                                {ROUTES.map(([v, l]) => (
                                    <option key={v} value={v}>
                                        {l}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    </div>
                    <div className="mt-4">
                        <Field label="In your own words, what is happening?" hint="Say what happened, roughly when, and what you are worried about. No legal terms needed.">
                            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="For example: My manager changed my shifts without asking and when I complained I was told I was being difficult…" />
                        </Field>
                    </div>
                </Card>

                <Card title="Your job">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Employer name (optional)">
                            <Input value={form.employerName} onChange={(e) => set("employerName", e.target.value)} />
                        </Field>
                        <Field label="Are you still employed there?">
                            <Select value={form.stillEmployed} onChange={(e) => set("stillEmployed", e.target.value as "" | "yes" | "no")}>
                                <option value="">Not sure / prefer not to say</option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                            </Select>
                        </Field>
                        <Field label="Your status" hint="Check your contract if unsure.">
                            <Select value={form.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value)}>
                                <option value="">Not sure</option>
                                <option value="employee">Employee</option>
                                <option value="worker">Worker</option>
                                <option value="agency">Agency worker</option>
                                <option value="self_employed">Self-employed</option>
                            </Select>
                        </Field>
                        <Field label="Start date (optional)">
                            <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
                        </Field>
                        {form.stillEmployed === "no" && (
                            <Field label="Date your employment ended" hint="This date drives the tribunal time limit.">
                                <Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
                                <label className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
                                    <input type="checkbox" checked={form.endDateApproximate} onChange={(e) => set("endDateApproximate", e.target.checked)} /> This date is approximate
                                </label>
                            </Field>
                        )}
                        <Field label="When did the most recent thing happen? (optional)">
                            <Input type="date" value={form.lastActDate} onChange={(e) => set("lastActDate", e.target.value)} />
                            <label className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
                                <input type="checkbox" checked={form.lastActApproximate} onChange={(e) => set("lastActApproximate", e.target.checked)} /> Approximate
                            </label>
                        </Field>
                    </div>
                </Card>

                <Card title="Acas and what you want">
                    <label className="mb-3 flex items-center gap-2">
                        <input type="checkbox" checked={form.acasNotified} onChange={(e) => set("acasNotified", e.target.checked)} /> I have already contacted Acas Early Conciliation
                    </label>
                    {form.acasNotified && (
                        <div className="grid gap-4 sm:grid-cols-3">
                            <Field label="Date Acas was notified (Day A)">
                                <Input type="date" value={form.acasNotificationDate} onChange={(e) => set("acasNotificationDate", e.target.value)} />
                            </Field>
                            <Field label="Certificate date (Day B), if issued">
                                <Input type="date" value={form.acasCertificateDate} onChange={(e) => set("acasCertificateDate", e.target.value)} />
                            </Field>
                            <Field label="Certificate number">
                                <Input value={form.acasCertificateNumber} onChange={(e) => set("acasCertificateNumber", e.target.value)} />
                            </Field>
                        </div>
                    )}
                    <div className="mt-4">
                        <Field label="What would you like to happen? (optional)">
                            <Input value={form.desiredOutcome} onChange={(e) => set("desiredOutcome", e.target.value)} placeholder="For example: an apology and my old shifts back" />
                        </Field>
                    </div>
                </Card>

                {error && <Notice tone="warn">{error}</Notice>}
                <Button type="submit" disabled={busy}>
                    {busy ? "Looking at this…" : "See what this looks like"}
                </Button>
            </form>

            {result && (
                <div className="space-y-4" aria-live="polite">
                    {result.jurisdictionNote && <Notice tone="warn">{result.jurisdictionNote}</Notice>}
                    <Notice tone={result.urgency.level === "expired" || result.urgency.level === "urgent" ? "urgent" : result.urgency.level === "watch" ? "warn" : "info"} title="Time limits">
                        {result.urgency.message}
                    </Notice>
                    <Card title="This looks like">
                        {result.summary && <p className="mb-3 text-ink-muted">{result.summary}</p>}
                        <div className="space-y-2">
                            {result.suggestedRoutes.map((r) => (
                                <label key={r.route} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                                    <input type="radio" name="route" className="mt-1" checked={chosenRoute === r.route} onChange={() => setChosenRoute(r.route)} />
                                    <span>
                                        <span className="block font-medium">{r.label}</span>
                                        <span className="block text-sm text-ink-muted">{r.reason}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        {result.clarifyingQuestions.length > 0 && (
                            <div className="mt-4">
                                <p className="mb-1 text-sm font-medium">Things it would help to know</p>
                                <ul className="list-disc pl-5 text-sm text-ink-muted">
                                    {result.clarifyingQuestions.map((q) => (
                                        <li key={q}>{q}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </Card>
                    <Card title="Help you can get now">
                        <ul className="space-y-1 text-[15px]">
                            {result.resources.map((r) => (
                                <li key={r.url}>
                                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                                        {r.name}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </Card>
                    <div className="flex flex-wrap gap-3">
                        <Button onClick={createCase} disabled={busy}>
                            {signedIn ? "Create my case" : "Create a free account to save this"}
                        </Button>
                        <ButtonLink href="/help" variant="secondary">
                            Read the guides first
                        </ButtonLink>
                    </div>
                </div>
            )}
        </div>
    );
}
