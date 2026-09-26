import { requireUser } from "@/auth/current-user";
import { listTasks } from "@/tasks/service";
import { PageHeader } from "@/components/ui";
import { Tasks } from "@/components/case/Tasks";

export default async function TasksPage({ params }: { params: Promise<{ caseId: string }> }) {
    const { actor } = await requireUser();
    const { caseId } = await params;
    const tasks = await listTasks(actor, caseId);
    return (
        <div>
            <PageHeader title="Tasks" intro="Things you may need to do. Some are suggested by the system from your dates; add your own too." />
            <Tasks caseId={caseId} tasks={tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, kind: t.kind, dueDate: t.dueDate, status: t.status, systemKey: t.systemKey }))} />
        </div>
    );
}
