import Link from "next/link";
import { requireUser } from "@/auth/current-user";
import { getCase } from "@/cases/service";
import { isFlagEnabled } from "@/flags";
import { listClaimCandidates, listClaimElements } from "@/claims/service";
import { hasEntitlement, paymentsEnabled } from "@/entitlements/service";
import { PageHeader, Card, Notice, ButtonLink, Disclaimer } from "@/components/ui";
import { Claims } from "@/components/case/Claims";
import { resourcesFor } from "@/resources/directory";

export default async function ClaimsPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const c = await getCase(actor, caseId);
    const enabled = isFlagEnabled("ENABLE_PERSONALISED_CLAIM_IDENTIFICATION");
    const base = `/app/cases/${caseId}`;

    if (!enabled) {
        const help = resourcesFor({ jurisdiction: c.jurisdiction, tags: ["considering_tribunal", "et1_preparation"], categories: ["official", "free_general_advice", "pro_bono_legal"] }).slice(0, 5);
        return (
            <div>
                <PageHeader title="Claims and the tribunal" intro="What to do if you are thinking about an Employment Tribunal claim." />
                <div className="grid gap-5 lg:grid-cols-2">
                    <Card title="Personalised claim identification is not switched on">
                        <p className="mb-3 text-ink-muted">This deployment does not offer automated analysis of which claims you could bring. You can still keep your time limits in view, prepare your Acas stage, build an ET1 readiness pack from your confirmed facts, and get free advice on the type of claim.</p>
                        <div className="flex flex-wrap gap-2">
                            <ButtonLink href={`${base}/dates`} variant="secondary">Time limits</ButtonLink>
                            <ButtonLink href={`${base}/exports`} variant="secondary">ET1 readiness pack</ButtonLink>
                            <ButtonLink href="/help/et1-claim-form" variant="secondary">About the ET1</ButtonLink>
                        </div>
                    </Card>
                    <Card title="Get advice on which claim">
                        <ul className="space-y-1">
                            {help.map((r) => <li key={r.id}><a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a> <span className="text-sm text-ink-muted">— {r.description}</span></li>)}
                        </ul>
                        <p className="mt-3 text-sm"><Link href={`${base}/help`}>More support routes</Link></p>
                    </Card>
                </div>
                <Disclaimer />
            </div>
        );
    }

    const entitled = await hasEntitlement(actor, caseId, "claim_pack");
    const candidates = await listClaimCandidates(actor, caseId);
    const withElements = [];
    for (const cand of candidates) withElements.push({ ...cand, generatedAt: cand.generatedAt.toISOString(), elements: await listClaimElements(actor, caseId, cand.id) });
    return (
        <div>
            <PageHeader title="Claims and the tribunal" intro="Based on the information currently recorded, these are claims you could potentially bring. Possibility is not the same as likely success: each element shows what the confirmed facts do and do not yet cover." />
            {paymentsEnabled() && !entitled ? (
                <Notice tone="info" title="Claim Pack needed">
                    Possible-claim analysis and the ET1 readiness pack are part of the Claim Pack. <Link href={`${base}/upgrade`}>See options</Link>. Time limits remain free on the <Link href={`${base}/dates`}>Important dates</Link> page.
                </Notice>
            ) : (
                <Claims caseId={caseId} candidates={withElements} />
            )}
            <Disclaimer />
        </div>
    );
}
