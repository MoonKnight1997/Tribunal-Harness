import { requireUser } from "@/auth/current-user";
import { listDocuments } from "@/documents/service";
import { listProcesses } from "@/processes/service";
import { PageHeader } from "@/components/ui";
import { Documents } from "@/components/case/Documents";

export default async function DocumentsPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const [docs, processes] = await Promise.all([listDocuments(actor, caseId), listProcesses(actor, caseId)]);
    return (
        <div>
            <PageHeader title="Documents" intro="Letters, emails, notes, contracts, payslips. We read them and suggest events for your timeline; the original is always kept as you uploaded it." />
            <Documents
                caseId={caseId}
                documents={docs.map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, docType: d.docType, docTypeConfirmed: d.docTypeConfirmed, docDate: d.docDate, extractionStatus: d.extractionStatus, extractionError: d.extractionError, userDescription: d.userDescription, uploadedAt: d.uploadedAt.toISOString(), hasText: !!d.extractedText }))}
                disciplinaryProcesses={processes.filter((p) => p.type === "disciplinary").map((p) => ({ id: p.id, state: p.state }))}
            />
        </div>
    );
}
