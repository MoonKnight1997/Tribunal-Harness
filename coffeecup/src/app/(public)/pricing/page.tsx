import { Container, PageHeader, Card, Disclaimer, Pill } from "@/components/ui";
import { PRICING, formatPrice } from "@/payments/pricing";
import { paymentsEnabled } from "@/entitlements/service";
import { isFlagEnabled } from "@/flags";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
    const enabled = paymentsEnabled();
    const claimsOn = isFlagEnabled("ENABLE_PERSONALISED_CLAIM_IDENTIFICATION");
    return (
        <Container className="max-w-4xl">
            <PageHeader title="Pricing" intro="One price per case, not a monthly subscription and not a charge per message. Time limits and urgent warnings are always free." />
            {!enabled && <p className="mb-4 rounded-lg bg-accent-soft px-4 py-3 text-[15px]">Payments are not switched on for this deployment: everything is currently available for free.</p>}
            <div className="grid gap-4 sm:grid-cols-3">
                <Card title="Free">
                    <p className="mb-3 text-2xl font-semibold">£0</p>
                    <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                        {PRICING.free.includes.map((i) => (
                            <li key={i}>{i}</li>
                        ))}
                    </ul>
                </Card>
                <Card title={PRICING.tiers.case_pass.name}>
                    <p className="mb-1 text-2xl font-semibold">{formatPrice(PRICING.tiers.case_pass.amountMinor)}</p>
                    <p className="mb-3 text-sm text-ink-muted">{PRICING.tiers.case_pass.description}</p>
                    <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                        {PRICING.tiers.case_pass.includes.map((i) => (
                            <li key={i}>{i}</li>
                        ))}
                    </ul>
                </Card>
                <Card title={PRICING.tiers.claim_pack.name} aside={!claimsOn ? <Pill tone="warn">Claim analysis not yet enabled</Pill> : undefined}>
                    <p className="mb-1 text-2xl font-semibold">{formatPrice(PRICING.tiers.claim_pack.amountMinor)}</p>
                    <p className="mb-3 text-sm text-ink-muted">{PRICING.tiers.claim_pack.description}</p>
                    <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                        {PRICING.tiers.claim_pack.includes.map((i) => (
                            <li key={i}>{i}</li>
                        ))}
                    </ul>
                </Card>
            </div>
            <p className="mt-4 text-sm text-ink-muted">Prices are test prices for an initial experiment and may change. Fair-use limits apply to automated drafting so the service stays affordable; you will never be shown tokens or credits.</p>
            <Disclaimer />
        </Container>
    );
}
