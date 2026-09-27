import { notFound } from "next/navigation";
import { requireUser } from "@/auth/current-user";
import { getCase } from "@/cases/service";
import { stageInfo } from "@/cases/stages";
import { countReviewItems } from "@/review/service";
import { NotFoundError } from "@/lib/errors";
import { CaseNav } from "@/components/shell/CaseNav";

export default async function CaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    let c;
    try {
        c = await getCase(actor, caseId);
    } catch (err) {
        if (err instanceof NotFoundError) notFound();
        throw err;
    }
    const review = await countReviewItems(actor, caseId);
    return (
        <div>
            <CaseNav caseId={c.id} sections={stageInfo(c.stage).nav} title={c.title} counts={{ review }} />
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</div>
        </div>
    );
}
