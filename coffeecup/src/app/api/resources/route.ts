import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resourcesFor, RESOURCE_CATEGORY_LABELS, type ResourceCategory } from "@/resources/directory";

export function GET(request: NextRequest) {
    const p = request.nextUrl.searchParams;
    const jurisdiction = p.get("jurisdiction") ?? "england_wales";
    const tags = (p.get("tags") ?? "").split(",").filter(Boolean);
    const categories = (p.get("categories") ?? "").split(",").filter(Boolean) as ResourceCategory[];
    return NextResponse.json({ resources: resourcesFor({ jurisdiction, tags, categories: categories.length ? categories : undefined }), categories: RESOURCE_CATEGORY_LABELS });
}
