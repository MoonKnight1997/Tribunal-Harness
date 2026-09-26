import Link from "next/link";
import { BRAND } from "@/brand/config";
import { Container, ButtonLink, Card } from "@/components/ui";
import { ARTICLES } from "@/content/articles";

const STEPS = [
    { title: "Tell us what is happening", body: "In your own words. You do not need to know any legal terms. We ask about dates, your job and where things are up to." },
    { title: "Get organised", body: "Keep the important facts and documents in one place, build a clear timeline, and see what still needs clarifying." },
    { title: "Take the next step", body: "Prepare for a grievance, a disciplinary meeting or an appeal, or get ready to talk to Acas. If it comes to it, get ready for a tribunal claim." },
];

export default function HomePage() {
    return (
        <Container>
            <section className="mb-14 max-w-2xl">
                <p className="mb-2 text-sm font-medium uppercase tracking-wide text-ink-muted">For workers in England, Wales and Scotland</p>
                <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Get help with a problem at work.</h1>
                <p className="mt-4 text-lg text-ink-muted">
                    {BRAND.name} helps you understand what is going on, keep a clear record, and move through the steps at your own pace: talking it through, raising a grievance, dealing with a disciplinary, contacting Acas, and only if you need to, preparing a tribunal claim.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                    <ButtonLink href="/start">Get help with a problem at work</ButtonLink>
                    <ButtonLink href="/how-it-works" variant="secondary">
                        How it works
                    </ButtonLink>
                </div>
                <p className="mt-4 text-sm text-ink-muted">Free to start. No legal knowledge needed. You decide what happens next; many problems are resolved without any claim.</p>
            </section>

            <section className="mb-14 grid gap-4 sm:grid-cols-3">
                {STEPS.map((s, i) => (
                    <Card key={s.title}>
                        <p className="mb-1 text-sm font-medium text-accent">Step {i + 1}</p>
                        <h2 className="mb-1 text-lg font-semibold">{s.title}</h2>
                        <p className="text-ink-muted">{s.body}</p>
                    </Card>
                ))}
            </section>

            <section className="mb-14">
                <h2 className="mb-3 text-2xl font-semibold">Things we keep straight for you</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                    {[
                        "Time limits are worked out from fixed rules and your dates, never guessed, and always shown with the assumptions.",
                        "Anything read from a document is a suggestion until you confirm it. You can correct any date, name or fact at any time.",
                        "Letters and preparation notes are drafted from your confirmed facts and stay editable. Editing wording never changes your record.",
                        "Your case is private to you. Nothing is sent to anyone else unless you download and share it.",
                    ].map((t) => (
                        <li key={t} className="rounded-lg border border-line bg-surface p-4 text-ink-muted">
                            {t}
                        </li>
                    ))}
                </ul>
            </section>

            <section>
                <h2 className="mb-3 text-2xl font-semibold">Plain-English guides</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                    {ARTICLES.slice(0, 8).map((a) => (
                        <Link key={a.slug} href={`/help/${a.slug}`} className="rounded-lg border border-line bg-surface p-4 no-underline hover:border-accent">
                            <span className="block font-medium text-ink">{a.title}</span>
                            <span className="block text-sm text-ink-muted">{a.summary}</span>
                        </Link>
                    ))}
                </div>
            </section>
        </Container>
    );
}
