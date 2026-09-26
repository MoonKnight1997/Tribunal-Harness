import Link from "next/link";
import { Container, PageHeader, Card, Disclaimer } from "@/components/ui";
import { ARTICLES } from "@/content/articles";
import { RESOURCES, RESOURCE_CATEGORY_LABELS, type ResourceCategory } from "@/resources/directory";

export const metadata = { title: "Help and support" };

const ORDER: ResourceCategory[] = ["official", "free_general_advice", "pro_bono_legal", "union_insurance", "regulated_solicitors", "self_representation", "commercial"];

export default function HelpPage() {
    return (
        <Container>
            <PageHeader eyebrow="Help" title="Guides and where to get support" intro="Plain-English guides, then the organisations that can help. We do not take referral fees and never pass your details to anyone." />
            <section className="mb-10">
                <h2 className="mb-3 text-xl font-semibold">Guides</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                    {ARTICLES.map((a) => (
                        <Link key={a.slug} href={`/help/${a.slug}`} className="rounded-lg border border-line bg-surface p-4 no-underline hover:border-accent">
                            <span className="block font-medium text-ink">{a.title}</span>
                            <span className="block text-sm text-ink-muted">{a.summary}</span>
                            <span className="mt-1 block text-xs text-ink-faint">
                                {a.jurisdiction} · reviewed {a.lastReviewed}
                            </span>
                        </Link>
                    ))}
                </div>
            </section>
            <section className="space-y-5">
                <h2 className="text-xl font-semibold">Where to get help</h2>
                {ORDER.map((cat) => (
                    <Card key={cat} title={RESOURCE_CATEGORY_LABELS[cat].label}>
                        <p className="mb-3 text-sm text-ink-muted">{RESOURCE_CATEGORY_LABELS[cat].plain}</p>
                        <ul className="space-y-2">
                            {RESOURCES.filter((r) => r.category === cat).map((r) => (
                                <li key={r.id} className="text-[15px]">
                                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium">
                                        {r.name}
                                    </a>{" "}
                                    <span className="text-ink-muted">— {r.description}</span>{" "}
                                    <span className="text-xs text-ink-faint">({r.jurisdiction.join(", ").replace(/_/g, " ")}; {r.cost.replace(/_/g, " ")})</span>
                                </li>
                            ))}
                        </ul>
                    </Card>
                ))}
            </section>
            <Disclaimer />
        </Container>
    );
}
