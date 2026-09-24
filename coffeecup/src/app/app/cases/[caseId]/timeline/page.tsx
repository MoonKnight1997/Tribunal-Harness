import { requireUser } from "@/auth/current-user";
import { listEvents } from "@/timeline/service";
import { listDocuments } from "@/documents/service";
import { listPersons } from "@/cases/service";
import { PageHeader } from "@/components/ui";
import { Timeline } from "@/components/case/Timeline";

export default async function TimelinePage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const [events, docs, people] = await Promise.all([listEvents(actor, caseId), listDocuments(actor, caseId), listPersons(actor, caseId)]);
    return (
        <div>
            <PageHeader title="Timeline" intro="Your chronology, in date order. Events read from documents wait here for you to confirm, correct or reject." />
            <Timeline
                caseId={caseId}
                events={events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() }))}
                documents={docs.map((d) => ({ id: d.id, filename: d.filename }))}
                people={people.map((p) => ({ id: p.id, name: p.name }))}
            />
        </div>
    );
}
