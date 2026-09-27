import { Container, PageHeader, Card, Disclaimer } from "@/components/ui";
import { offeredPricing, formatPrice } from "@/payments/pricing";
import { paymentsEnabled } from "@/entitlements/service";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
    const enabled = paymentsEnabled();
    const offer = offeredPricing();
    return (
        <Container className="max-w-4xl">
            <PageHeader title="Pricing" intro="One price per case, not a monthly subscription and not a charge per message. Time limits and urgent warnings are always free." />
            {!enabled && <p className="mb-4 rounded-lg bg-accent-soft px-4 py-3 text-[15px]">Payments are not switched on for this deployment: everything is currently available for free.</p>}
            <div className={`grid gap-4 ${offer.tiers.length >= 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <Card title={offer.free.name}>
                    <p className="mb-3 text-2xl font-semibold">£0</p>
                    <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                        {offer.free.includes.map((i) => (
                            <li key={i}>{i}</li>
                        ))}
                    </ul>
                </Card>
                {offer.tiers.map((tier) => (
                    <Card key={tier.id} title={tier.name}>
                        <p className="mb-1 text-2xl font-semibold">{formatPrice(tier.amountMinor)}</p>
                        <p className="mb-3 text-sm text-ink-muted">{tier.description}</p>
                        <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                            {tier.includes.map((i) => (
                                <li key={i}>{i}</li>
                            ))}
                        </ul>
                        {tier.notYetEnabled.length > 0 && <p className="mt-3 text-sm text-ink-muted">Not yet available on this service: {tier.notYetEnabled.join("; ")}.</p>}
                    </Card>
                ))}
            </div>
            <p className="mt-4 text-sm text-ink-muted">Prices are test prices for an initial experiment and may change. Fair-use limits apply to automated drafting so the service stays affordable; you will never be shown tokens or credits.</p>
            <Disclaimer />
        </Container>
    );
}
