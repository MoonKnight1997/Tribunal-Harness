import { requireUser } from "@/auth/current-user";
import { getAcasProcess } from "@/processes/service";
import { getCase } from "@/cases/service";
import { listDeadlines } from "@/legal/deadlines/case-deadlines";
import { PageHeader } from "@/components/ui";
import { Acas } from "@/components/case/Acas";
import { ACAS_STATES } from "@/processes/machines";
import type { AcasProcessData } from "@/db/schema";

export default async function AcasPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    await getCase(actor, caseId);
    const proc = await getAcasProcess(caseId);
    const deadlines = await listDeadlines(actor, caseId);
    const et = deadlines.filter((d) => d.kind.startsWith("et_time_limit"));
    return (
        <div>
            <PageHeader title="Acas Early Conciliation" intro="Before most tribunal claims you must notify Acas. Recording your Acas dates here updates your time limits automatically." />
            <Acas caseId={caseId} process={proc ? { id: proc.id, state: proc.state, data: proc.data as AcasProcessData } : null} states={ACAS_STATES} timeLimits={et.map((d) => ({ label: d.label, date: d.calculatedDate, status: d.status, acasEffect: d.explanation.acasEffect, missing: d.explanation.missingInformation }))} />
        </div>
    );
}
