import Link from "next/link";
import { requireUser } from "@/auth/current-user";
import { listCases } from "@/cases/service";
import { stageInfo } from "@/cases/stages";
import { Container, PageHeader, ButtonLink, Empty, Pill } from "@/components/ui";

export const metadata = { title: "My cases" };

export default async function CasesPage() {
    const { actor } = await requireUser();
    const cases = await listCases(actor);
    return (
        <Container className="py-8">
            <PageHeader title="My cases" intro="Each case is one problem at work. Everything you record stays here until you delete it." actions={<ButtonLink href="/app/cases/new">Start a new case</ButtonLink>} />
            {cases.length === 0 ? (
                <Empty>You have no cases yet. Start one to get organised.</Empty>
            ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                    {cases.map((c) => {
                        const s = stageInfo(c.stage);
                        return (
                            <li key={c.id}>
                                <Link href={`/app/cases/${c.id}`} className="block rounded-[var(--radius-card)] border border-line bg-surface p-5 no-underline hover:border-accent">
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="text-lg font-semibold text-ink">{c.title}</span>
                                        <Pill tone={c.status === "resolved" ? "ok" : "accent"}>{c.status}</Pill>
                                    </div>
                                    <span className="block text-sm text-ink-muted">{s.label}</span>
                                    <span className="block text-xs text-ink-faint">Last activity {c.lastActivityAt.toISOString().slice(0, 10)}</span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Container>
    );
}
