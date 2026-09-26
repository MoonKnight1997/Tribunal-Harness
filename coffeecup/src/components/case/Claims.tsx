"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Notice, Pill, Empty } from "@/components/ui";
import type { ClaimCandidateRow, ClaimElementRow } from "@/claims/service";

type Candidate = Omit<ClaimCandidateRow, "generatedAt"> & { generatedAt: string; elements: ClaimElementRow[] };

const STATUS_LABEL: Record<string, { label: string; tone: "ok" | "accent" | "warn" | "urgent" | "neutral" }> = {
    supported: { label: "Supported by confirmed facts", tone: "ok" },
    potentially_supported: { label: "Potentially supported", tone: "accent" },
    disputed: { label: "Disputed", tone: "warn" },
    unsupported_on_current_information: { label: "Unsupported on current information", tone: "urgent" },
    information_missing: { label: "Information missing", tone: "neutral" },
    not_applicable: { label: "Not applicable", tone: "neutral" },
};

export function Claims({ caseId, candidates }: { caseId: string; candidates: Candidate[] }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const stale = candidates.some((c) => c.stale);

    async function run() {
        setBusy(true);
        setError(null);
        try {
            await api(`/api/cases/${caseId}/claims`, { method: "POST", body: {} });
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
            {stale && <Notice tone="warn" title="Out of date">Your case record has changed since this analysis ran ({candidates.find((c) => c.stale)?.staleReason}). Run it again before relying on it.</Notice>}
            <div className="flex flex-wrap items-center gap-3">
                <Button disabled={busy} onClick={run}>{busy ? "Analysing your confirmed facts…" : candidates.length ? "Run the analysis again" : "See which claims could apply"}</Button>
                <span className="text-sm text-ink-muted">Uses only the facts you have confirmed on <Link href={`/app/cases/${caseId}/case`}>My case</Link>. No scores or predictions.</span>
            </div>
            {candidates.length === 0 && <Empty>No analysis yet.</Empty>}
            {candidates.map((c) => (
                <Card key={c.id} title={c.label} aside={<span className="text-xs text-ink-faint">{c.generatedAt.slice(0, 10)}{c.stale ? " · out of date" : ""}</span>}>
                    <p className="mb-3 text-sm text-ink-muted">Why it came up: {c.triggeredBy.join("; ")}.</p>
                    <ol className="mb-4 space-y-2">
                        {c.elements.map((e) => (
                            <li key={e.id} className="rounded-lg border border-line p-3">
                                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-medium">{e.label}</span>
                                    <Pill tone={STATUS_LABEL[e.status]?.tone ?? "neutral"}>{STATUS_LABEL[e.status]?.label ?? e.status}</Pill>
                                </div>
                                <p className="text-sm">{e.reasoning}</p>
                                {e.missingInformation.length > 0 && <p className="mt-1 text-sm text-ink-muted">Still needed: {e.missingInformation.join(" ")}</p>}
                            </li>
                        ))}
                    </ol>
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                            <p className="font-medium">Time limit</p>
                            <p className="text-ink-muted">{c.timeLimit?.summary ?? "Not yet calculable."} <Link href={`/app/cases/${caseId}/dates`}>Details</Link></p>
                            <p className="mt-2 font-medium">Acas</p>
                            <p className="text-ink-muted">{c.acasStatus.replace(/_/g, " ")}</p>
                        </div>
                        <div>
                            {c.missingFacts.length > 0 && <><p className="font-medium">Missing facts</p><ul className="list-disc pl-5 text-ink-muted">{c.missingFacts.slice(0, 6).map((m) => <li key={m}>{m}</li>)}</ul></>}
                            {c.alternatives.length > 0 && <p className="mt-2 text-ink-muted">Other ways of looking at the same facts: {c.alternatives.map((a) => a.replace(/_/g, " ")).join(", ")}.</p>}
                        </div>
                    </div>
                    {c.uncertainties.length > 0 && (
                        <ul className="mt-3 list-disc pl-5 text-sm text-ink-muted">
                            {c.uncertainties.map((u) => <li key={u}>{u}</li>)}
                        </ul>
                    )}
                    <details className="mt-3 text-sm">
                        <summary className="cursor-pointer text-ink-muted">Sources and checks</summary>
                        <ul className="mt-2 list-disc pl-5">
                            {c.sources.map((s) => <li key={s.key}>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title} <span className="text-ink-muted">({s.reference})</span></li>)}
                        </ul>
                        {(() => {
                            const rr = c.reviewerResult as { deterministicFindings?: Array<{ note: string }> } | null;
                            const f = rr?.deterministicFindings ?? [];
                            return f.length ? <p className="mt-2 text-ink-muted">Automatic checks adjusted {f.length} point{f.length === 1 ? "" : "s"} where the draft went beyond the confirmed facts.</p> : <p className="mt-2 text-ink-muted">Automatic checks found nothing to adjust.</p>;
                        })()}
                    </details>
                </Card>
            ))}
        </div>
    );
}
