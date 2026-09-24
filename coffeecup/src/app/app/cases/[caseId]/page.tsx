import Link from "next/link";
import { requireUser } from "@/auth/current-user";
import { buildDashboard } from "@/cases/dashboard";
import { Card, Notice, Pill, ButtonLink, Empty } from "@/components/ui";
import { SituationSummary } from "@/components/case/SituationSummary";
import { StageControl } from "@/components/case/StageControl";

export default async function CaseHomePage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const d = await buildDashboard(actor, caseId);
    const base = `/app/cases/${caseId}`;
    const urgent = d.important.filter((i) => i.status === "expired" || (i.daysAway !== null && i.daysAway <= 21));
    return (
        <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
                {urgent.length > 0 && (
                    <Notice tone="urgent" title="Important">
                        <ul className="list-disc pl-5">
                            {urgent.map((i) => (
                                <li key={i.label}>{i.headline}</li>
                            ))}
                        </ul>
                        <Link href={`${base}/dates`} className="mt-1 inline-block text-sm">
                            See how this was worked out
                        </Link>
                    </Notice>
                )}
                <Card title="Your situation" aside={d.case.summaryStale && d.situation.summary ? <Pill tone="warn">May be out of date</Pill> : undefined}>
                    <SituationSummary caseId={caseId} summary={d.situation.summary} stale={d.case.summaryStale} />
                </Card>
                <Card title="Where you are">
                    <p className="font-medium">{d.case.stageLabel}</p>
                    <p className="mb-3 text-ink-muted">{d.case.stagePlain}</p>
                    <StageControl caseId={caseId} stage={d.case.stage} />
                    {d.processes.length > 0 && (
                        <ul className="mt-4 space-y-2">
                            {d.processes.map((p) => (
                                <li key={p.id} className="rounded-lg border border-line p-3">
                                    <Link href={p.type === "acas_early_conciliation" ? `${base}/acas` : `${base}/process`} className="font-medium no-underline text-ink">
                                        {p.type.replace(/_/g, " ")}
                                    </Link>
                                    <span className="block text-sm text-ink-muted">
                                        {p.stateLabel}. {p.statePlain}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
                <Card title="Next" aside={<Link href={`${base}/tasks`} className="text-sm">All tasks</Link>}>
                    {d.nextSteps.length === 0 ? (
                        <Empty>Nothing waiting. Add events or documents to keep building your record.</Empty>
                    ) : (
                        <ul className="space-y-2">
                            {d.nextSteps.map((t) => (
                                <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-line p-3">
                                    <span>
                                        <span className="block">{t.title}</span>
                                        {t.dueDate && <span className="block text-sm text-ink-muted">By {t.dueDate}</span>}
                                    </span>
                                    <Pill tone={t.kind === "deadline" ? "warn" : "neutral"}>{t.kind}</Pill>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
                {(d.reviewQueue.proposedEvents > 0 || d.reviewQueue.proposedFacts > 0) && (
                    <Notice tone="info" title="Things to review">
                        We found {d.reviewQueue.proposedEvents} possible event{d.reviewQueue.proposedEvents === 1 ? "" : "s"} and {d.reviewQueue.proposedFacts} possible fact{d.reviewQueue.proposedFacts === 1 ? "" : "s"} in your documents. Nothing is added to your record until you confirm it.{" "}
                        <Link href={`${base}/timeline`}>Review now</Link>
                    </Notice>
                )}
            </div>
            <div className="space-y-5">
                <Card title="Important dates" aside={<Link href={`${base}/dates`} className="text-sm">Details</Link>}>
                    {d.important.length === 0 ? (
                        <p className="text-ink-muted">No dates yet.</p>
                    ) : (
                        <ul className="space-y-2 text-[15px]">
                            {d.important.map((i) => (
                                <li key={i.label}>
                                    <span className="block">{i.headline}</span>
                                    {i.status === "uncertain" && <span className="text-sm text-ink-muted">Add the date on My case.</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
                <Card title="Still needs clarifying">
                    {d.missingInformation.length === 0 ? <p className="text-ink-muted">Nothing obvious is missing.</p> : (
                        <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-muted">
                            {d.missingInformation.slice(0, 6).map((m) => (
                                <li key={m}>{m}</li>
                            ))}
                        </ul>
                    )}
                    <div className="mt-3">
                        <ButtonLink href={`${base}/case`} variant="secondary">
                            Update my case
                        </ButtonLink>
                    </div>
                </Card>
                <Card title="Your case">
                    <ul className="space-y-1 text-[15px]">
                        <li><Link href={`${base}/timeline`}>Timeline</Link> · {d.counts.events} confirmed event{d.counts.events === 1 ? "" : "s"}</li>
                        <li><Link href={`${base}/documents`}>Documents</Link> · {d.counts.documents}</li>
                        <li><Link href={`${base}/case`}>Facts</Link> · {d.counts.facts} confirmed</li>
                        <li><Link href={`${base}/exports`}>Generated documents</Link> · {d.counts.artifacts}</li>
                    </ul>
                </Card>
                {d.recentActivity.length > 0 && (
                    <Card title="Recent activity">
                        <ul className="space-y-1 text-sm text-ink-muted">
                            {d.recentActivity.map((r, i) => (
                                <li key={i}>
                                    <span className="text-ink">{r.title}</span>
                                    {r.status ? ` · ${r.status.replace(/_/g, " ")}` : ""}
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}
                {d.entitlements.paymentsEnabled && !d.entitlements.casePass && (
                    <Card title="Unlock the full workspace">
                        <p className="mb-2 text-sm text-ink-muted">Documents, the full chronology, letters and preparation notes need a Case Pass. Time limits are always free.</p>
                        <ButtonLink href={`${base}/upgrade`}>See options</ButtonLink>
                    </Card>
                )}
            </div>
        </div>
    );
}
