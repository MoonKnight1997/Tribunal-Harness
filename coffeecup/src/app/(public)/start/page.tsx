import { Container, PageHeader, Disclaimer } from "@/components/ui";
import { TriageForm } from "@/components/intake/TriageForm";
import { getCurrentUser } from "@/auth/current-user";

export const metadata = { title: "Get help with a problem at work" };

export default async function StartPage() {
    const user = await getCurrentUser();
    return (
        <Container className="max-w-3xl">
            <PageHeader title="Get help with a problem at work" intro="A few questions, no legal knowledge needed. Nothing is saved until you choose to create a case." />
            <TriageForm signedIn={!!user} />
            <Disclaimer />
        </Container>
    );
}
