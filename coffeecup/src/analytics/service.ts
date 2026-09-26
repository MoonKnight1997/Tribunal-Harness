/**
 * Privacy-conscious product analytics.
 *
 * Events are stored first-party with a salted hash of the user id and a
 * small allow-list of scalar properties. Case text, names, documents and
 * free text are never recorded. An optional outbound sink can be added later
 * (see ANALYTICS_SINK) but receives the same minimal payload.
 */

import { createHash } from "node:crypto";
import { getDb } from "@/db/client";
import { analyticsEvents } from "@/db/schema";
import { newId } from "@/lib/ids";

export const ANALYTICS_EVENTS = [
    "case_started",
    "timeline_completed",
    "document_uploaded",
    "grievance_produced",
    "disciplinary_prep_produced",
    "appeal_produced",
    "acas_workspace_reached",
    "paid_conversion",
    "claims_identified",
    "et1_pack_created",
    "case_exported",
    "case_abandoned",
    "support_requested",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

const ALLOWED_PROPS = new Set(["stage", "entryRoute", "jurisdiction", "tier", "docType", "count", "provider", "artifactType"]);

export function subjectFor(userId: string | null | undefined): string | null {
    if (!userId) return null;
    const salt = process.env.ANALYTICS_SALT ?? "dev-salt";
    return createHash("sha256").update(`${salt}:${userId}`).digest("hex").slice(0, 24);
}

export async function track(name: AnalyticsEvent, userId: string | null | undefined, props: Record<string, string | number | boolean> = {}): Promise<void> {
    if (process.env.ANALYTICS_DISABLED === "1") return;
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(props)) {
        if (!ALLOWED_PROPS.has(k)) continue;
        clean[k] = typeof v === "string" ? v.slice(0, 60) : v;
    }
    try {
        const db = await getDb();
        await db.insert(analyticsEvents).values({ id: newId(), name, subject: subjectFor(userId), props: clean });
    } catch {
        // Analytics must never break product flows.
    }
}
