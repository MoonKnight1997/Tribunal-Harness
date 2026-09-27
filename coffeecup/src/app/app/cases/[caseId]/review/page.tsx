import { requireUser } from "@/auth/current-user";
import { buildReviewQueue } from "@/review/service";
import { PageHeader } from "@/components/ui";
import { EvidenceInbox } from "@/components/case/EvidenceInbox";

export default async function ReviewPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const queue = await buildReviewQueue(actor, caseId);
    return (
        <div>
            <PageHeader
                title="Review"
                intro="Everything read from your documents waits here until you decide. The passage it came from sits beside each item, so you can check it without opening the file. Nothing counts until you confirm it."
            />
            <EvidenceInbox caseId={caseId} initial={queue} />
        </div>
    );
}
