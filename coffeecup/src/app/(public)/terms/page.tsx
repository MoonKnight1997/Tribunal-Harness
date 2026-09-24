import { Container, PageHeader, Disclaimer } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { BRAND } from "@/brand/config";
import { CURRENT_TERMS_VERSION } from "@/auth/service";

export const metadata = { title: "Terms of use" };

const BODY = `## What the service is
${BRAND.name} is an organisational and legal-information tool for workers in England, Wales and Scotland. It helps you record, understand and progress a problem at work.

## What it is not
It is not legal advice and does not create a solicitor–client relationship. Nothing produced here has been reviewed by a solicitor, barrister, Acas, HM Courts and Tribunals Service or any judge. Generated documents are drafts for you to check. Time-limit calculations depend on the dates you enter; you are responsible for checking them.

## Your account
Keep your password safe. You may delete your account at any time.

## Payments
Where payments are enabled, a Case Pass or Claim Pack is a one-off purchase for one case. If a payment is refunded or disputed, the related features are switched off for that case.

## Acceptable use
Use the service for your own workplace problem (or to help someone with theirs, with their consent). Do not upload material you are not entitled to hold.

## Liability
The service is provided with reasonable care but without warranty that any document or calculation is complete or suitable for your circumstances. Nothing in these terms limits liability that cannot be limited by law.

## Version
${CURRENT_TERMS_VERSION}`;

export default function TermsPage() {
    return (
        <Container className="max-w-3xl">
            <PageHeader title="Terms of use" />
            <Markdown text={BODY} />
            <Disclaimer />
        </Container>
    );
}
