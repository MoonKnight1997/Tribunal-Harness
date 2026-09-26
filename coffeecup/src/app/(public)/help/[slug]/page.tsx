import { notFound } from "next/navigation";
import Link from "next/link";
import { Container, Disclaimer, Notice } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { ARTICLES, articleBySlug } from "@/content/articles";
import { getSource } from "@/legal/sources/registry";

export function generateStaticParams() {
    return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const a = articleBySlug(slug);
    return { title: a?.title ?? "Guide", description: a?.summary };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const article = articleBySlug(slug);
    if (!article) notFound();
    const sources = article.sourceKeys.map((k) => getSource(k));
    return (
        <Container className="max-w-3xl">
            <p className="mb-2 text-sm text-ink-muted">
                <Link href="/help">Help</Link> · {article.jurisdiction} · Last reviewed {article.lastReviewed}
            </p>
            <h1 className="mb-3 text-3xl font-semibold leading-tight tracking-tight">{article.title}</h1>
            <p className="mb-5 text-lg text-ink-muted">{article.summary}</p>
            {article.effectiveNote && (
                <div className="mb-5">
                    <Notice tone="info" title="Dates">
                        {article.effectiveNote}
                    </Notice>
                </div>
            )}
            <Markdown text={article.body} />
            {sources.length > 0 && (
                <section className="mt-8 rounded-lg border border-line bg-surface p-4 text-sm">
                    <h2 className="mb-2 font-semibold">Sources</h2>
                    <ul className="space-y-1">
                        {sources.map((s) => (
                            <li key={s.key}>
                                <a href={s.url} target="_blank" rel="noopener noreferrer">
                                    {s.title}
                                </a>{" "}
                                <span className="text-ink-muted">
                                    ({s.publisher}; in force from {s.effectiveFrom}
                                    {s.effectiveTo ? ` to ${s.effectiveTo}` : ""}; checked {s.lastVerifiedAt})
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            <div className="mt-8">
                <Link href="/start" className="inline-block rounded-lg bg-accent px-4 py-2 text-white no-underline">
                    Get help with your situation
                </Link>
            </div>
            <Disclaimer />
        </Container>
    );
}
