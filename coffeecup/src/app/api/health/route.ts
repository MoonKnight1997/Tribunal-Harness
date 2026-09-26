import { NextResponse } from "next/server";
import { getDb, getDbKind } from "@/db/client";
import { configuredProviderName } from "@/ai/routing";
import { allFlags } from "@/flags";

export async function GET() {
    try {
        await getDb();
        return NextResponse.json({ ok: true, database: getDbKind(), llmProvider: configuredProviderName(), flags: allFlags() });
    } catch (err) {
        return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "unavailable" }, { status: 503 });
    }
}
