import { Container, PageHeader, Disclaimer } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { BRAND } from "@/brand/config";
import { CURRENT_PRIVACY_VERSION } from "@/auth/service";

export const metadata = { title: "Privacy notice" };

const BODY = `## Who we are
${BRAND.name} is operated by ${BRAND.operator}. Data protection contact: ${BRAND.privacyEmail}.

## What we collect
- Account details: email address and a password hash.
- Case data you enter or upload: descriptions, dates, names of people involved, documents and their extracted text. This can include special category data (for example health or ethnicity) where it is relevant to your problem. We process it because you ask us to, on the basis of your explicit consent given when you create a case; you can withdraw consent by deleting the case or your account.
- Minimal product analytics: event names with a hashed identifier. Never case text.
- Audit records: which actions happened on your case and when, without content.

## How we use it
Only to provide the service to you: organising your case, calculating dates, and generating documents you ask for. Automated processing (including AI models) is used to read documents you upload and to draft wording from facts you have confirmed. Nothing is decided about you automatically; you confirm or correct every suggestion.

## Who sees it
Nobody else. We do not sell data, we do not take referral fees, and we do not send your case to any third party. If an AI provider is configured, text from your case is sent to that provider under a data-processing agreement to perform the task you requested and is not used to train models. See AI_PROVIDER_ARCHITECTURE in the documentation for the providers supported.

## Retention
A deleted case is removed from the live system immediately and purged from backups within 30 days. Deleting your account deletes all your cases and documents.

## Your rights
Access, rectification, erasure, restriction, portability and objection. Export your case at any time from the Exports page. Contact ${BRAND.privacyEmail}. You can complain to the Information Commissioner's Office.

## Version
${CURRENT_PRIVACY_VERSION}`;

export default function PrivacyPage() {
    return (
        <Container className="max-w-3xl">
            <PageHeader title="Privacy notice" intro="How we handle your information under UK GDPR and the Data Protection Act 2018." />
            <Markdown text={BODY} />
            <Disclaimer />
        </Container>
    );
}
