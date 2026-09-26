import { DeleteCase } from "@/components/case/DeleteCase";
import { PageHeader } from "@/components/ui";

export default async function DeleteCasePage({ params }: { params: Promise<{ caseId: string }> }) {
    const { caseId } = await params;
    return (
        <div className="max-w-xl">
            <PageHeader title="Delete this case" intro="This removes the case, its documents and everything generated from it. It cannot be undone. Consider exporting first." />
            <DeleteCase caseId={caseId} />
        </div>
    );
}
