import { requireUser } from "@/auth/current-user";
import { listArtifacts } from "@/artifacts/service";
import { listProcesses } from "@/processes/service";
import { hasEntitlement, paymentsEnabled } from "@/entitlements/service";
import { isFlagEnabled } from "@/flags";
import { PageHeader } from "@/components/ui";
import { Exports } from "@/components/case/Exports";

export default async function ExportsPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const [artifacts, processes] = await Promise.all([listArtifacts(actor, caseId), listProcesses(actor, caseId)]);
    return (
        <div>
            <PageHeader title="Documents you have generated and exports" intro="Everything here is drafted from your confirmed record and stays editable. Editing wording never changes your facts. If your record changes, the document is marked out of date." />
            <Exports
                caseId={caseId}
                artifacts={artifacts.map((a) => ({ id: a.id, type: a.type, title: a.title, content: a.content, version: a.version, status: a.status, stale: a.stale, staleReason: a.staleReason, updatedAt: a.updatedAt.toISOString() }))}
                processes={processes.map((p) => ({ id: p.id, type: p.type, state: p.state }))}
                entitlements={{ paymentsEnabled: paymentsEnabled(), casePass: await hasEntitlement(actor, caseId, "case_pass"), claimPack: await hasEntitlement(actor, caseId, "claim_pack") }}
                claimsEnabled={isFlagEnabled("ENABLE_PERSONALISED_CLAIM_IDENTIFICATION")}
            />
        </div>
    );
}
