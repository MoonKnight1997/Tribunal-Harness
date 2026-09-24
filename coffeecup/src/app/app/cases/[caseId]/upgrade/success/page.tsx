import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";

export default async function UpgradeSuccessPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { caseId } = await params;
    return (
        <div className="max-w-xl">
            <PageHeader title="Thank you" />
            <Card>
                <p className="mb-3">Your payment is being confirmed. This usually takes a few seconds; the features unlock as soon as the payment provider confirms it to us.</p>
                <Link href={`/app/cases/${caseId}`}>Back to your case</Link>
            </Card>
        </div>
    );
}
