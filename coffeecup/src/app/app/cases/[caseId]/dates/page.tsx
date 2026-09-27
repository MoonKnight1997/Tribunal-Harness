import { requireUser } from "@/auth/current-user";
import { listDeadlines } from "@/legal/deadlines/case-deadlines";
import { Card, PageHeader, Pill, Notice, Disclaimer } from "@/components/ui";
import { formatLongDate } from "@/lib/dates";

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

function describeSource(source: string | null | undefined): string | null {
    if (!source) return null;
    if (source.startsWith("structured_fact:")) return `the "${source.slice("structured_fact:".length).replace(/_/g, " ")}" date on My case`;
    if (source === "employment.end_date") return "the employment end date on My case";
    if (source.startsWith("process:")) return "the outcome date you entered for this process";
    if (source === "intake") return "your intake answers";
    return source;
}

export default async function DatesPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const deadlines = await listDeadlines(actor, caseId);
    return (
        <div>
            <PageHeader title="Important dates" intro="Every date here is worked out from fixed rules and the dates you recorded. Nothing is estimated. If a date is missing, approximate, or paused for Acas conciliation, we say so." />
            <div className="space-y-4">
                {deadlines.map((d) => {
                    const t = d.explanation.trigger;
                    const approximate = t?.precision && t.precision !== "exact";
                    return (
                        <Card
                            key={d.id}
                            title={d.label}
                            aside={
                                <span className="flex flex-wrap gap-1">
                                    <Pill tone={statusTone(d.status)}>{STATUS_LABEL[d.status] ?? d.status}</Pill>
                                    {approximate && <Pill tone="warn">approximate date</Pill>}
                                </span>
                            }
                        >
                            {d.status === "pending_acas" ? (
                                <div className="mb-3">
                                    <p className="text-2xl font-semibold">Paused for Acas conciliation</p>
                                    {d.explanation.unadjusted && (
                                        <p className="mt-1 text-[15px]">
                                            No earlier than <strong>{formatLongDate(d.explanation.unadjusted.date)}</strong>. {d.explanation.unadjusted.note}
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="mb-3 text-2xl font-semibold">
                                    {d.calculatedDate ? formatLongDate(d.calculatedDate) : "Not yet calculable"}
                                    {approximate && d.calculatedDate && <span className="ml-2 text-base font-normal text-warn">(approximate: may be earlier)</span>}
                                </p>
                            )}
                            <dl className="grid gap-2 text-[15px] sm:grid-cols-[160px_1fr]">
                                <dt className="text-ink-muted">Triggering date</dt>
                                <dd>
                                    {d.explanation.triggerDate ? `${formatLongDate(d.explanation.triggerDate)} — ${d.explanation.triggerDescription}` : d.explanation.triggerDescription}
                                    {t && (
                                        <span className="block text-sm text-ink-muted">
                                            {t.precision && t.precision !== "exact" ? `Recorded as ${t.precision}. ` : ""}
                                            {describeSource(t.source) ? `From ${describeSource(t.source)}. ` : ""}
                                            {t.confirmed ? "Confirmed by you." : "Not yet confirmed by you."}
                                        </span>
                                    )}
                                    {t?.conflictingValues && t.conflictingValues.length > 1 && (
                                        <span className="block text-sm text-warn">Conflicting dates recorded: {t.conflictingValues.map((v) => formatLongDate(v)).join("; ")}. Resolve this on My case.</span>
                                    )}
                                </dd>
                                {d.explanation.assumptions.length > 0 && (
                                    <>
                                        <dt className="text-ink-muted">Assumptions</dt>
                                        <dd>
                                            <ul className="list-disc pl-5">
                                                {d.explanation.assumptions.map((a) => (
                                                    <li key={a}>{a}</li>
                                                ))}
                                            </ul>
                                        </dd>
                                    </>
                                )}
                                {d.explanation.acasEffect && (
                                    <>
                                        <dt className="text-ink-muted">Acas effect</dt>
                                        <dd>{d.explanation.acasEffect}</dd>
                                    </>
                                )}
                                {d.explanation.acas && d.explanation.acas.dayBBasis !== "none" && (
                                    <>
                                        <dt className="text-ink-muted">Acas dates used</dt>
                                        <dd>
                                            Day A: {d.explanation.acas.dayA ? formatLongDate(d.explanation.acas.dayA) : "not recorded"}. Day B: {d.explanation.acas.dayB ? formatLongDate(d.explanation.acas.dayB) : "not yet known"}{" "}
                                            <span className="text-ink-muted">({d.explanation.acas.dayBBasis.replace(/_/g, " ")})</span>
                                            {d.explanation.acas.note && <span className="block text-sm text-ink-muted">{d.explanation.acas.note}</span>}
                                        </dd>
                                    </>
                                )}
                                {d.explanation.secondary && (
                                    <>
                                        <dt className="text-ink-muted">If the law changes</dt>
                                        <dd>
                                            {d.explanation.secondary.label}: {formatLongDate(d.explanation.secondary.date)}. {d.explanation.secondary.note}
                                        </dd>
                                    </>
                                )}
                                <dt className="text-ink-muted">Source</dt>
                                <dd>
                                    {d.explanation.source.url ? (
                                        <a href={d.explanation.source.url} target="_blank" rel="noopener noreferrer">
                                            {d.explanation.source.title}
                                        </a>
                                    ) : (
                                        d.explanation.source.title
                                    )}{" "}
                                    <span className="text-ink-muted">({d.explanation.source.reference}; rule version {d.explanation.source.version})</span>
                                </dd>
                            </dl>
                            {d.explanation.missingInformation.length > 0 && (
                                <div className="mt-3">
                                    <Notice tone="warn" title={d.status === "pending_acas" ? "Needed to finish the calculation" : "Needed to calculate this"}>
                                        <ul className="list-disc pl-5">
                                            {d.explanation.missingInformation.map((m) => (
                                                <li key={m}>{m}</li>
                                            ))}
                                        </ul>
                                    </Notice>
                                </div>
                            )}
                            {d.explanation.warnings.length > 0 && (
                                <div className="mt-3">
                                    <Notice tone={d.status === "expired" ? "urgent" : "warn"}>
                                        <ul className="list-disc pl-5">
                                            {d.explanation.warnings.map((w) => (
                                                <li key={w}>{w}</li>
                                            ))}
                                        </ul>
                                    </Notice>
                                </div>
                            )}
                        </Card>
                    );
                })}
            </div>
            <Disclaimer />
        </div>
    );
}
