import { requireUser } from "@/auth/current-user";
import { listDeadlines } from "@/legal/deadlines/case-deadlines";
import { Card, PageHeader, Pill, Notice, Disclaimer } from "@/components/ui";
import { formatLongDate } from "@/lib/dates";

export default async function DatesPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const deadlines = await listDeadlines(actor, caseId);
    return (
        <div>
            <PageHeader title="Important dates" intro="Every date here is worked out from fixed rules and the dates you recorded. Nothing is estimated. If a date is missing we say so." />
            <div className="space-y-4">
                {deadlines.map((d) => (
                    <Card key={d.id} title={d.label} aside={<Pill tone={d.status === "expired" ? "urgent" : d.status === "uncertain" ? "warn" : "ok"}>{d.status}</Pill>}>
                        <p className="mb-3 text-2xl font-semibold">{d.calculatedDate ? formatLongDate(d.calculatedDate) : "Not yet calculable"}</p>
                        <dl className="grid gap-2 text-[15px] sm:grid-cols-[160px_1fr]">
                            <dt className="text-ink-muted">Triggering date</dt>
                            <dd>{d.explanation.triggerDate ? `${formatLongDate(d.explanation.triggerDate)} — ${d.explanation.triggerDescription}` : d.explanation.triggerDescription}</dd>
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
                                <Notice tone="warn" title="Needed to calculate this">
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
                ))}
            </div>
            <Disclaimer />
        </div>
    );
}
