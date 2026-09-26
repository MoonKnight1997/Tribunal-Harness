import Link from "next/link";
import { requireUser } from "@/auth/current-user";
import { getCase } from "@/cases/service";
import { listIssues } from "@/issues/service";
import { resourcesFor, RESOURCE_CATEGORY_LABELS } from "@/resources/directory";
import { ARTICLES } from "@/content/articles";
import { Card, PageHeader, Disclaimer } from "@/components/ui";

export default async function CaseHelpPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const c = await getCase(actor, caseId);
    const issues = await listIssues(actor, caseId);
    const tags = [c.entryRoute, c.stage, ...issues.map((i) => i.category)];
    const resources = resourcesFor({ jurisdiction: c.jurisdiction, tags });
    const guides = ARTICLES.filter((a) => a.relatedRoutes.some((r) => tags.includes(r))).slice(0, 6);
    return (
        <div>
            <PageHeader title="Help for this case" intro="Guides and organisations relevant to where you are. We do not pass your details to any of them." />
            <div className="grid gap-5 lg:grid-cols-2">
                <Card title="Guides that fit your situation">
                    {guides.length === 0 ? <p className="text-ink-muted">See <Link href="/help">all guides</Link>.</p> : (
                        <ul className="space-y-2">
                            {guides.map((g) => <li key={g.slug}><Link href={`/help/${g.slug}`}>{g.title}</Link><span className="block text-sm text-ink-muted">{g.summary}</span></li>)}
                        </ul>
                    )}
                </Card>
                <Card title="Who can help">
                    <ul className="space-y-2">
                        {resources.slice(0, 10).map((r) => (
                            <li key={r.id}>
                                <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium">{r.name}</a>{" "}
                                <span className="text-xs text-ink-faint">{RESOURCE_CATEGORY_LABELS[r.category].label}</span>
                                <span className="block text-sm text-ink-muted">{r.description}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-3 text-sm"><Link href="/help">Full directory</Link></p>
                </Card>
                <Card title="Something not working?">
                    <p className="text-ink-muted">If a document would not read, a date looks wrong or a download failed, you can fix it yourself: re-run extraction from Documents, correct any fact on My case, and regenerate documents from Exports. For a software problem, contact support from the footer of any page.</p>
                </Card>
                <Card title="Your data">
                    <p className="mb-2 text-ink-muted">Export your case at any time from Exports. To delete this case permanently, use the button below; this cannot be undone.</p>
                    <form action={`/api/cases/${caseId}/purge`} method="post">
                        <Link href={`/app/cases/${caseId}/delete`} className="text-urgent">Delete this case</Link>
                    </form>
                </Card>
            </div>
            <Disclaimer />
        </div>
    );
}
