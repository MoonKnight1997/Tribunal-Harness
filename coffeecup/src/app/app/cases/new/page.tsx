import { Container, PageHeader, Disclaimer } from "@/components/ui";
import { TriageForm } from "@/components/intake/TriageForm";

export const metadata = { title: "Start a new case" };

export default function NewCasePage() {
    return (
        <Container className="max-w-3xl py-8">
            <PageHeader title="Start a new case" intro="Tell us what is happening. You can change any of this later." />
            <TriageForm signedIn restoreDraft />
            <Disclaimer />
        </Container>
    );
}
