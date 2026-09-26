import { requireUser } from "@/auth/current-user";
import { listProcesses, listAllegations, listAppealGrounds } from "@/processes/service";
import { PageHeader } from "@/components/ui";
import { Processes } from "@/components/case/Processes";
import { statesFor } from "@/processes/machines";

export default async function ProcessPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const procs = (await listProcesses(actor, caseId)).filter((p) => p.type !== "acas_early_conciliation");
    const enriched = [];
    for (const p of procs) {
        enriched.push({
            id: p.id,
            type: p.type,
            state: p.state,
            data: p.data as Record<string, unknown>,
            acasCodeVersion: p.acasCodeVersion,
            closedAt: p.closedAt?.toISOString() ?? null,
            states: statesFor(p.type),
            allegations: p.type === "disciplinary" ? await listAllegations(actor, caseId, p.id) : [],
            grounds: p.type.endsWith("_appeal") ? await listAppealGrounds(actor, caseId, p.id) : [],
        });
    }
    return (
        <div>
            <PageHeader title="Workplace process" intro="Grievances, disciplinaries and appeals, step by step. Each stays in your record permanently." />
            <Processes caseId={caseId} processes={enriched} />
        </div>
    );
}
