import { Container, PageHeader, Card, Disclaimer, ButtonLink } from "@/components/ui";
import { BRAND } from "@/brand/config";

export const metadata = { title: "How it works" };

export default function HowItWorksPage() {
    return (
        <Container className="max-w-3xl">
            <PageHeader title="How it works" intro={`${BRAND.name} is a place to organise a problem at work and move it forward, one step at a time. It is not a chatbot and it is not a lawyer.`} />
            <div className="space-y-4">
                <Card title="1. Start with what is happening">
                    <p className="text-ink-muted">Answer a few plain questions: where you work, whether you are still employed, the key dates, and what stage things are at. You can pick “I’m not sure” and we will suggest routes.</p>
                </Card>
                <Card title="2. Build one record">
                    <p className="text-ink-muted">Upload letters, emails and notes. We read them and suggest timeline events and facts; nothing is added to your record until you confirm it. You can correct anything, at any time, and the things that depend on it are flagged for a refresh.</p>
                </Card>
                <Card title="3. Work through the process you are in">
                    <p className="text-ink-muted">Grievance, disciplinary, appeal, Acas Early Conciliation: each has its own workspace with the stages, the documents you might need, preparation notes and editable letters drafted from your confirmed facts.</p>
                </Card>
                <Card title="4. Know your dates">
                    <p className="text-ink-muted">Time limits are calculated from fixed legal rules and your dates, with the assumptions, the Acas effect and the source shown. If a date is missing, we say so rather than guessing.</p>
                </Card>
                <Card title="5. If it comes to a tribunal">
                    <p className="text-ink-muted">Where enabled, see which claims you could potentially bring based on the facts you have confirmed, element by element, with what is missing. Build an ET1 readiness pack, export your case, and file through the official GOV.UK service.</p>
                </Card>
                <Card title="What we do not do">
                    <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                        <li>We do not give legal advice or predict outcomes. No scores, no percentages.</li>
                        <li>We do not submit claims or contact your employer, Acas or a tribunal.</li>
                        <li>We do not pass your details to anyone. Support routes are listed; you choose.</li>
                    </ul>
                </Card>
            </div>
            <div className="mt-6">
                <ButtonLink href="/start">Get help with a problem at work</ButtonLink>
            </div>
            <Disclaimer />
        </Container>
    );
}
