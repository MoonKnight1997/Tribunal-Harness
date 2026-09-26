import type { NextRequest } from "next/server";
import { handle, readJson, json } from "@/lib/http";
import { requireUser } from "@/auth/current-user";
import { createCase, listCases, type CreateCaseInputType } from "@/cases/service";
import { createCaseFromIntake, type IntakeInputType } from "@/intake/service";
import { track } from "@/analytics/service";

export const GET = handle(async () => {
    const { actor } = await requireUser();
    return json({ cases: await listCases(actor) });
});

export const POST = handle(async (request: NextRequest) => {
    const { actor } = await requireUser();
    const body = await readJson<{ intake?: IntakeInputType } & CreateCaseInputType>(request);
    if (body.intake) {
        const { caseId } = await createCaseFromIntake(actor, body.intake);
        await track("case_started", actor.userId, { entryRoute: body.intake.entryRoute ?? "not_sure", jurisdiction: body.intake.jurisdiction ?? "england_wales" });
        return json({ caseId }, { status: 201 });
    }
    const c = await createCase(actor, body);
    await track("case_started", actor.userId, { entryRoute: c.entryRoute, jurisdiction: c.jurisdiction });
    return json({ caseId: c.id, case: c }, { status: 201 });
});
