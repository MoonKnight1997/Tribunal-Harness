import { requireUser } from "@/auth/current-user";
import { hasEntitlement, paymentsEnabled } from "@/entitlements/service";
import { offeredPricing, formatPrice } from "@/payments/pricing";
import { Card, PageHeader, Notice, Pill } from "@/components/ui";
import { Upgrade } from "@/components/case/Upgrade";

export default async function UpgradePage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const enabled = paymentsEnabled();
    const offer = offeredPricing();
    const active = { case_pass: await hasEntitlement(actor, caseId, "case_pass"), claim_pack: await hasEntitlement(actor, caseId, "claim_pack") };
    return (
        <div className="max-w-3xl">
            <PageHeader title="Options for this case" intro="One payment for this case. Not a subscription, and never a charge per message. Time limits and urgent warnings are always free." />
            {!enabled && <Notice tone="info">Payments are not switched on for this deployment. Everything is available.</Notice>}
            {enabled && (
                <div className={`grid gap-4 ${offer.tiers.length >= 2 ? "sm:grid-cols-2" : ""}`}>
                    {offer.tiers.map((tier) => (
                        <Card key={tier.id} title={tier.name} aside={active[tier.id] ? <Pill tone="ok">active</Pill> : undefined}>
                            <p className="text-2xl font-semibold">{formatPrice(tier.amountMinor)}</p>
                            <ul className="my-3 list-disc pl-5 text-ink-muted">{tier.includes.map((i) => <li key={i}>{i}</li>)}</ul>
                            {tier.notYetEnabled.length > 0 && <p className="mb-3 text-sm text-ink-muted">Not yet available on this service: {tier.notYetEnabled.join("; ")}.</p>}
                            {!active[tier.id] && <Upgrade caseId={caseId} tier={tier.id} />}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
