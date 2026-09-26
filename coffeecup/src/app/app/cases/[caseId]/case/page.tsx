import { requireUser } from "@/auth/current-user";
import { getCase, getEmployment, listPersons } from "@/cases/service";
import { listIssues } from "@/issues/service";
import { listFacts } from "@/facts/service";
import { PageHeader } from "@/components/ui";
import { CaseDetails } from "@/components/case/CaseDetails";

export default async function CaseDetailsPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const [c, employment, people, issues, facts] = await Promise.all([getCase(actor, caseId), getEmployment(actor, caseId), listPersons(actor, caseId), listIssues(actor, caseId), listFacts(actor, caseId)]);
    return (
        <div>
            <PageHeader title="My case" intro="The details everything else builds on. Change anything here and the things that depend on it will be marked for a refresh." />
            <CaseDetails
                caseId={caseId}
                caseRow={{ title: c.title, jurisdiction: c.jurisdiction }}
                employment={employment}
                people={people}
                issues={issues}
                facts={facts.map((f) => ({ ...f, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() }))}
            />
        </div>
    );
}
