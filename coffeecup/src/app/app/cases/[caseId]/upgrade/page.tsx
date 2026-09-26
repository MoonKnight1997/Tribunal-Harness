import { requireUser } from "@/auth/current-user";
import { hasEntitlement, paymentsEnabled } from "@/entitlements/service";
import { PRICING, formatPrice } from "@/payments/pricing";
import { isFlagEnabled } from "@/flags";
import { Card, PageHeader, Notice, Pill } from "@/components/ui";
import { Upgrade } from "@/components/case/Upgrade";

export default async function UpgradePage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const enabled = paymentsEnabled();
    const casePass = await hasEntitlement(actor, caseId, "case_pass");
    const claimPack = await hasEntitlement(actor, caseId, "claim_pack");
    return (
        <div className="max-w-3xl">
            <PageHeader title="Options for this case" intro="One payment for this case. Not a subscription, and never a charge per message. Time limits and urgent warnings are always free." />
            {!enabled && <Notice tone="info">Payments are not switched on for this deployment. Everything is available.</Notice>}
            {enabled && (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Card title={PRICING.tiers.case_pass.name} aside={casePass ? <Pill tone="ok">active</Pill> : undefined}>
                        <p className="text-2xl font-semibold">{formatPrice(PRICING.tiers.case_pass.amountMinor)}</p>
                        <ul className="my-3 list-disc pl-5 text-ink-muted">{PRICING.tiers.case_pass.includes.map((i) => <li key={i}>{i}</li>)}</ul>
                        {!casePass && <Upgrade caseId={caseId} tier="case_pass" />}
                    </Card>
                    <Card title={PRICING.tiers.claim_pack.name} aside={claimPack ? <Pill tone="ok">active</Pill> : !isFlagEnabled("ENABLE_PERSONALISED_CLAIM_IDENTIFICATION") ? <Pill tone="warn">claim analysis not yet enabled</Pill> : undefined}>
                        <p className="text-2xl font-semibold">{formatPrice(PRICING.tiers.claim_pack.amountMinor)}</p>
                        <ul className="my-3 list-disc pl-5 text-ink-muted">{PRICING.tiers.claim_pack.includes.map((i) => <li key={i}>{i}</li>)}</ul>
                        {!claimPack && <Upgrade caseId={caseId} tier="claim_pack" />}
                    </Card>
                </div>
            )}
        </div>
    );
}
